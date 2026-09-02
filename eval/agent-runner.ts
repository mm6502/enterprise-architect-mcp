/**
 * Agent measurement harness library (U10). Turns R19's tool-call count from a manual campaign
 * into a repeatable run: spawns the GitHub Copilot CLI over a built server, reduces its JSONL
 * transcript into per-tool call counts, and validates that the run actually reached the
 * intended server and the intended synthetic model before any count is trusted.
 *
 * The JSONL reduction (parseTranscript and everything built on it) is pure and unit-tested.
 * The spawning path below it depends on an installed, authenticated `copilot` binary and has
 * no automated test — verify it by running one task by hand via agent-runner-cli.ts instead.
 *
 * Event shapes were confirmed against the installed CLI (1.0.82) on 2026-09-01 by spawning a
 * real run over a built server and reading its JSONL output; they are not guessed from
 * documentation. `tool.execution_start`/`tool.execution_complete` carry the fields read below.
 * No `session.mcp_servers_loaded` event was observed in that output, unlike earlier notes on
 * this measurement approach — this harness verifies server and model identity from the actual
 * tool calls and their results instead (see checkServerScope, checkModelInfo).
 */
import { spawn } from "node:child_process";

// ─── Pure transcript reduction ───

export interface ParsedEvent {
  type: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolCallSummary {
  toolCallId: string;
  toolName: string;
  mcpServerName?: string;
  mcpToolName?: string;
  arguments: unknown;
}

export interface ToolResultSummary {
  toolCallId: string;
  success: boolean;
  content?: string;
}

/** The agent's own planning bookkeeping tool — not a retrieval call, excluded from every count. */
const BOOKKEEPING_TOOL_NAME = "report_intent";

/**
 * One JSON object per line; a banner or cursor-control fragment that is not valid JSON is
 * dropped rather than aborting the whole parse — a single stray line must not lose the transcript.
 */
export function parseTranscript(jsonl: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
        events.push(parsed as ParsedEvent);
      }
    } catch {
      // Non-JSON noise (terminal control bytes, banners) is not a transcript event.
    }
  }
  return events;
}

function isReportIntent(data: Record<string, unknown> | undefined): boolean {
  return data?.toolName === BOOKKEEPING_TOOL_NAME || data?.mcpToolName === BOOKKEEPING_TOOL_NAME;
}

/** Every tool call actually issued, excluding the agent's own report_intent bookkeeping. */
export function extractToolCalls(events: ParsedEvent[]): ToolCallSummary[] {
  const calls: ToolCallSummary[] = [];
  for (const e of events) {
    if (e.type !== "tool.execution_start" || !e.data || isReportIntent(e.data)) continue;
    const d = e.data;
    calls.push({
      toolCallId: String(d.toolCallId),
      toolName: String(d.toolName),
      mcpServerName: typeof d.mcpServerName === "string" ? d.mcpServerName : undefined,
      mcpToolName: typeof d.mcpToolName === "string" ? d.mcpToolName : undefined,
      arguments: d.arguments,
    });
  }
  return calls;
}

/** The outcome of each tool call, keyed by the id tool.execution_start assigned it. */
export function extractToolResults(events: ParsedEvent[]): ToolResultSummary[] {
  const results: ToolResultSummary[] = [];
  for (const e of events) {
    if (e.type !== "tool.execution_complete" || !e.data) continue;
    const d = e.data;
    const result = d.result as Record<string, unknown> | undefined;
    results.push({
      toolCallId: String(d.toolCallId),
      success: d.success === true,
      content: typeof result?.content === "string" ? result.content : undefined,
    });
  }
  return results;
}

/** Per-tool call counts — the harness's core metric for R19. */
export function countToolCalls(events: ParsedEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const call of extractToolCalls(events)) {
    const key = call.mcpToolName ?? call.toolName;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function totalToolCalls(events: ParsedEvent[]): number {
  return extractToolCalls(events).length;
}

export interface RunOutcome {
  exitCode: number | null;
  premiumRequests: number | null;
}

/** The closing `result` event's exit code and cost, or nulls when the run never produced one. */
export function getRunOutcome(events: ParsedEvent[]): RunOutcome {
  const resultEvent = events.find((e) => e.type === "result");
  if (!resultEvent) return { exitCode: null, premiumRequests: null };
  const usage = resultEvent.usage as Record<string, unknown> | undefined;
  return {
    exitCode: typeof resultEvent.exitCode === "number" ? resultEvent.exitCode : null,
    premiumRequests: typeof usage?.premiumRequests === "number" ? usage.premiumRequests : null,
  };
}

export interface ServerScopeCheck {
  ok: boolean;
  unexpectedServers: string[];
}

/**
 * Confirms every tool call was scoped to the intended MCP server. A call with no
 * `mcpServerName` is a built-in (non-MCP) tool, which `--disable-builtin-mcps` should have
 * emptied out for anything but the agent's own bookkeeping — already excluded above.
 */
export function checkServerScope(events: ParsedEvent[], expectedServerName: string): ServerScopeCheck {
  const servers = new Set<string>();
  for (const call of extractToolCalls(events)) {
    servers.add(call.mcpServerName ?? "(non-mcp)");
  }
  const unexpected = [...servers].filter((s) => s !== expectedServerName);
  return { ok: unexpected.length === 0, unexpectedServers: unexpected };
}

export interface ModelInfoCheck {
  called: boolean;
  matchesExpected: boolean;
  actualFileName?: string;
}

/**
 * Confirms the run actually opened the intended synthetic model rather than falling through
 * to a real export via the environment (resolve-qea-path.ts treats an unopenable path argument
 * as absent) — replays no request, only reads the `ea_get_model_info` call the run already made.
 */
export function checkModelInfo(events: ParsedEvent[], expectedFileName: string, expectedSourceId = "argument"): ModelInfoCheck {
  const calls = extractToolCalls(events).filter((c) => c.mcpToolName === "ea_get_model_info");
  if (calls.length === 0) return { called: false, matchesExpected: false };

  const results = extractToolResults(events);
  let actualFileName: string | undefined;
  for (const call of calls) {
    const result = results.find((r) => r.toolCallId === call.toolCallId && r.success && r.content);
    if (!result?.content) continue;
    try {
      const parsed = JSON.parse(result.content);
      actualFileName = parsed.fileName;
      if (parsed.fileName === expectedFileName && parsed.configuration?.sourceId === expectedSourceId) {
        return { called: true, matchesExpected: true, actualFileName };
      }
    } catch {
      continue;
    }
  }
  return { called: true, matchesExpected: false, actualFileName };
}

// ─── Config generation and spawning (untested: needs an installed, authenticated CLI) ───

export interface McpConfigOptions {
  serverName: string;
  serverEntry: string;
  modelPath: string;
}

/** One config file binds one run to one build of the server — never a global setting edited between measurements. */
export function buildMcpConfig({ serverName, serverEntry, modelPath }: McpConfigOptions): string {
  return JSON.stringify(
    {
      mcpServers: {
        [serverName]: {
          type: "local",
          command: "node",
          args: [serverEntry, modelPath],
          tools: ["*"],
        },
      },
    },
    null,
    2
  );
}

export interface AgentRunConfig {
  copilotBin: string;
  mcpConfigPath: string;
  model: string;
  effort: string;
}

/**
 * Every `ea_*` tool the server exposes. Passed to `--available-tools` so the agent under
 * measurement can reach only the server being measured — not the CLI's own native file/shell
 * tools. Their absence here is a real defect this harness shipped with, not a hypothetical one:
 * a first campaign run left this unset, and one transcript (mai-code-1.1-flash, task B2) used
 * the CLI's own `view` tool to read this repo's eval/agent-tasks.md rubric directly and quoted
 * "I checked the repo's eval task for this exact question" in its final answer — a measurement
 * contamination, not merely an unscoped-permission risk. 20 of 198 runs in that campaign used a
 * native tool (`view`, `grep`, `glob`, or `powershell`) at least once; those runs' tool-call
 * counts were excluded from the R19 comparison, and their correctness cannot be trusted either.
 */
// Prefixed with the configured MCP server name — the CLI's allowlist rejects bare tool
// names as "Unknown tool name", which silently drops every tool (not just the intended
// native ones), leaving the model with nothing to call at all.
const EA_TOOL_NAMES = [
  "ea_search", "ea_get_element", "ea_list_elements", "ea_get_connectors",
  "ea_get_package_tree", "ea_get_diagram_elements", "ea_get_scenarios",
  "ea_resolve", "ea_list_diagrams", "ea_get_schema", "ea_get_model_info",
].map((name) => `mcp-server-ea-${name}`);

/**
 * Spawning a Windows .cmd/.ps1 shim needs a shell, but `spawn(bin, args, { shell: true })`
 * hands Node's own re-quoting a job it gets wrong for multi-word arguments — Node's DEP0190
 * warns exactly about this combination (an args array under shell:true is only concatenated,
 * not escaped), and it was observed directly: a prompt containing spaces arrived at the CLI
 * split into separate arguments. Folding everything into one pre-quoted command string, with
 * zero-length args passed to spawn, keeps escaping in our hands and avoids the warning (it
 * triggers only when shell is true *and* the args list is non-empty). Non-Windows needs
 * neither a shell nor this escaping.
 */
function quoteArg(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function spawnCli(bin: string, args: string[]) {
  if (process.platform !== "win32") return spawn(bin, args);
  const commandLine = [bin, ...args].map(quoteArg).join(" ");
  return spawn(commandLine, [], { shell: true });
}

/** Spawns one non-interactive Copilot CLI run and returns its parsed JSONL transcript. */
export function runAgentTask(prompt: string, config: AgentRunConfig): Promise<{ events: ParsedEvent[]; raw: string }> {
  return new Promise((resolvePromise, reject) => {
    const args = [
      "-p", prompt,
      "--output-format", "json",
      "--additional-mcp-config", `@${config.mcpConfigPath}`,
      "--disable-builtin-mcps",
      "--no-custom-instructions",
      "--no-ask-user",
      "--allow-all-tools",
      "--available-tools", EA_TOOL_NAMES.join(","),
      "--model", config.model,
      "--effort", config.effort,
    ];
    const child = spawnCli(config.copilotBin, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", () => {
      resolvePromise({ events: parseTranscript(stdout), raw: stdout || stderr });
    });
  });
}

// ─── CLI entrypoint: one task, one model, one build — a smoke run, not the R19 campaign ───

