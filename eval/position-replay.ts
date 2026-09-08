/**
 * One-off R20 measurement script for the multi-term-search plan (U16). Not a live-agent
 * campaign: it calls `ea_search` / `ea_search_and_any_of` directly against each build via the
 * MCP SDK client, the same no-agent pattern already used to verify Stage 2 on the real export.
 * Costs zero premium requests and needs no live campaign transcript to run.
 *
 * Two input sources for cases:
 *  1. CURATED_CASES below — single-term sanity checks (R3 freeze: position must be identical
 *     across arms, since a one-term `requiredTerms` call must reduce to the old `query` engine)
 *     plus candidate-only multi-term cases that have no baseline equivalent.
 *  2. --from-campaign <file.jsonl> — replays the actual `ea_search`/`ea_search_and_any_of`
 *     argument sets a live campaign recorded (agent-campaign.ts's `searchCalls` field), against
 *     the build the arm used, reporting the position of a caller-supplied expected Object_ID.
 *     Requires --expect <taskId>=<objectId> pairs, since the expected element is a rubric fact,
 *     not something recoverable from the transcript itself.
 *
 * Usage:
 *   tsx eval/position-replay.ts --baseline-build <dist/index.js> --candidate-build <dist/index.js> \
 *     --model-path <eval-model.qea> [--from-campaign results.jsonl --expect A6=123,B1=101]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface CuratedCase {
  label: string;
  baselineArgs: Record<string, unknown> | null;
  candidateArgs: Record<string, unknown>;
  expectedObjectIds: number[];
}

/** Object_IDs taken from eval/fixture.ts's header comment and INSERT statements — see there for provenance. */
const CURATED_CASES: CuratedCase[] = [
  {
    label: "single-term (R3 freeze): zavazok -> UCTOVNA JEDNOTKA",
    baselineArgs: { query: "zavazok" },
    candidateArgs: { requiredTerms: ["zavazok"] },
    expectedObjectIds: [123],
  },
  {
    label: "single-term (R3 freeze): Dodavatel -> two candidates",
    baselineArgs: { query: "Dodavatel" },
    candidateArgs: { requiredTerms: ["Dodavatel"] },
    expectedObjectIds: [121, 122],
  },
  {
    label: "single-term (R3 freeze): Zmluva -> entity",
    baselineArgs: { query: "Zmluva" },
    candidateArgs: { requiredTerms: ["Zmluva"] },
    expectedObjectIds: [120],
  },
  {
    label: "candidate-only conjunction: zmluva + dodavatel (same-field spread) -> IZmluvaService op owner",
    baselineArgs: null,
    candidateArgs: { requiredTerms: ["zmluva", "dodavatel"] },
    expectedObjectIds: [141],
  },
];

interface Connection {
  client: Client;
  close(): Promise<void>;
}

async function connect(serverEntry: string, modelPath: string): Promise<Connection> {
  const transport = new StdioClientTransport({ command: "node", args: [resolve(serverEntry), resolve(modelPath)] });
  const client = new Client({ name: "position-replay", version: "1.0.0" });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

function parsePayload(response: unknown): { Object_ID: number }[] {
  const r = response as { isError?: boolean; content?: { text?: string }[] };
  if (r.isError) throw new Error(`Tool call returned an error: ${JSON.stringify(response)}`);
  const text = r.content?.[0]?.text;
  if (typeof text !== "string") throw new Error(`Malformed tool response, no content[0].text: ${JSON.stringify(response)}`);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.results)) throw new Error(`Response has no results array: ${text}`);
  return parsed.results as { Object_ID: number }[];
}

/** -1 if none of the expected ids appear in the returned window. */
function positionOfAny(results: { Object_ID: number }[], expectedObjectIds: number[]): { index: number; objectId: number | null } {
  for (let i = 0; i < results.length; i++) {
    if (expectedObjectIds.includes(results[i].Object_ID)) return { index: i, objectId: results[i].Object_ID };
  }
  return { index: -1, objectId: null };
}

async function runCurated(baseline: Connection, candidate: Connection) {
  console.log("=== Curated single-term / multi-term position check ===\n");
  for (const c of CURATED_CASES) {
    let baselineLine = "baseline: n/a (candidate-only shape)";
    if (c.baselineArgs) {
      const res = await baseline.client.callTool({ name: "ea_search", arguments: c.baselineArgs });
      const { index, objectId } = positionOfAny(parsePayload(res), c.expectedObjectIds);
      baselineLine = `baseline: position=${index} (Object_ID ${objectId ?? "NOT FOUND"})`;
    }
    const candRes = await candidate.client.callTool({ name: "ea_search", arguments: c.candidateArgs });
    const { index: candIndex, objectId: candObjectId } = positionOfAny(parsePayload(candRes), c.expectedObjectIds);
    console.log(`${c.label}`);
    console.log(`  ${baselineLine}`);
    console.log(`  candidate: position=${candIndex} (Object_ID ${candObjectId ?? "NOT FOUND"})`);
    console.log();
  }
}

interface CampaignRecord {
  arm: "baseline" | "candidate";
  taskId: string;
  searchCalls?: Array<{ tool: string; arguments: Record<string, unknown> }>;
}

async function runFromCampaign(
  campaignPath: string,
  expectMap: Map<string, number>,
  baseline: Connection,
  candidate: Connection
) {
  console.log(`\n=== Replaying recorded search calls from ${campaignPath} ===\n`);
  const lines = readFileSync(campaignPath, "utf-8").split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const record: CampaignRecord = JSON.parse(line);
    const expected = expectMap.get(record.taskId);
    if (expected === undefined || !record.searchCalls?.length) continue;
    const conn = record.arm === "baseline" ? baseline : candidate;
    for (const call of record.searchCalls) {
      const res = await conn.client.callTool({ name: call.tool, arguments: call.arguments });
      const { index, objectId } = positionOfAny(parsePayload(res), [expected]);
      console.log(`[${record.arm}] task=${record.taskId} tool=${call.tool} args=${JSON.stringify(call.arguments)}`);
      console.log(`  position=${index} (Object_ID ${objectId ?? "NOT FOUND"}, expected ${expected})`);
    }
  }
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const baselineBuild = get("--baseline-build");
  const candidateBuild = get("--candidate-build");
  const modelPath = get("--model-path");
  if (!baselineBuild || !candidateBuild || !modelPath) {
    throw new Error(
      "Usage: position-replay --baseline-build <path> --candidate-build <path> --model-path <path> [--from-campaign <file.jsonl> --expect A6=123,B1=101]"
    );
  }
  const fromCampaign = get("--from-campaign");
  const expectArg = get("--expect");
  const expectMap = new Map<string, number>();
  if (expectArg) {
    for (const pair of expectArg.split(",")) {
      const [taskId, id] = pair.split("=");
      expectMap.set(taskId, Number(id));
    }
  }
  return { baselineBuild, candidateBuild, modelPath, fromCampaign, expectMap };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseline = await connect(args.baselineBuild, args.modelPath);
  const candidate = await connect(args.candidateBuild, args.modelPath);
  try {
    await runCurated(baseline, candidate);
    if (args.fromCampaign) await runFromCampaign(args.fromCampaign, args.expectMap, baseline, candidate);
  } finally {
    await baseline.close();
    await candidate.close();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
