/**
 * One-off R19 measurement campaign runner for the multi-term-search plan (U5/U9). Not part of
 * the committed U10 harness surface — it is the batch loop the plan's "Deferred to
 * Implementation" note left open (whether task prompts are extracted from agent-tasks.md or
 * kept machine-readable beside it). Embeds the 11 tasks from eval/agent-tasks.md directly
 * rather than parsing the markdown, since the rubric prose itself is not meant to be parsed.
 *
 * Correctness grading is NOT automated here — KD9 makes that a human judgement. This script
 * only produces tool-call counts and raw transcripts; grading against the REQUIRED/BONUS facts
 * happens afterward, against the recorded transcripts.
 *
 * Usage:
 *   tsx eval/agent-campaign.ts --baseline-build <dist/index.js> --candidate-build <dist/index.js> \
 *     --model-path <eval-model.qea> --models m1,m2,m3 --repeats 3 --out campaign-results.jsonl
 */
import { writeFileSync, appendFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildMcpConfig,
  runAgentTask,
  checkServerScope,
  checkModelInfo,
  countToolCalls,
  totalToolCalls,
  getRunOutcome,
} from "./agent-runner.js";

export interface CampaignTask {
  id: string;
  question: string;
}

/** The 11 tasks from eval/agent-tasks.md, in file order. Grading against their rubric happens separately. */
export const CAMPAIGN_TASKS: CampaignTask[] = [
  { id: "A1", question: "Screen `OBR_OBS_5201: Detail zmluvy` maps its fields onto the `Zmluva` entity. Which entity attribute does the field `poleCisloZmluvy` fill?" },
  { id: "A2", question: "What does step 2 of use case `UC_OBS_4101: Založenie zmluvy` say, and what business rules apply to this use case?" },
  { id: "A5", question: "I need to see the diagram that shows `Zmluva`. I only have the name — find it." },
  { id: "A6", question: "Find every element whose specification mentions `záväzok`." },
  { id: "A9", question: "I need the element named `Dodávateľ` — which one is it?" },
  { id: "A12", question: "Does `t_connector` have any column that stores style information? What columns does it have?" },
  { id: "B1", question: "A step of `UC_OBS_4101` references a rule by code. Find the rule text and explain what it requires." },
  { id: "B2", question: "I heard the model has glossary terms. Can you find them? What table holds them?" },
  { id: "B3", question: "Which model export is the server reading? Where did that path come from?" },
  { id: "B4", question: "We have a defect on screen `OBR_OBS_5201: Detail zmluvy` — the contract status field behaves wrongly. Find the specification: which use cases, attributes, and business rules define this screen's behaviour?" },
  { id: "B5", question: "How many fee items does `Sadzobník poplatkov` define? List them." },
];

interface BuildArm {
  name: "baseline" | "candidate";
  entry: string;
}

interface CampaignRunRecord {
  timestamp: string;
  arm: string;
  model: string;
  taskId: string;
  repeat: number;
  toolCalls: Record<string, number>;
  totalToolCalls: number;
  outcome: { exitCode: number | null; premiumRequests: number | null };
  serverScopeOk: boolean;
  modelInfo: { called: boolean; matchesExpected: boolean; actualFileName?: string };
  finalAnswerExcerpt: string;
  error?: string;
}

function extractFinalAnswer(raw: string): string {
  // The last assistant.message event before `result` carries the final text the agent gave.
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const evt = JSON.parse(lines[i]);
      if (evt.type === "assistant.message" && typeof evt.data?.content === "string") {
        return evt.data.content.slice(0, 4000);
      }
    } catch {
      continue;
    }
  }
  return "";
}

function parseArgs(argv: string[]) {
  const get = (flag: string, fallback?: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : fallback;
  };
  const baselineBuild = get("--baseline-build");
  const candidateBuild = get("--candidate-build");
  const modelPath = get("--model-path");
  const modelsArg = get("--models");
  if (!baselineBuild || !candidateBuild || !modelPath || !modelsArg) {
    throw new Error(
      "Usage: agent-campaign --baseline-build <path> --candidate-build <path> --model-path <path> --models m1,m2,m3 [--repeats 3] [--effort low] [--out file.jsonl] [--task-ids A1,A2] [--run-id id]"
    );
  }
  const taskIdsArg = get("--task-ids");
  return {
    baselineBuild,
    candidateBuild,
    modelPath,
    models: modelsArg.split(",").map((s) => s.trim()).filter(Boolean),
    repeats: Number(get("--repeats", "1")),
    effort: get("--effort", "low")!,
    out: get("--out", "campaign-results.jsonl")!,
    taskIds: taskIdsArg ? new Set(taskIdsArg.split(",").map((s) => s.trim())) : undefined,
    // Unique per invocation by default so concurrent campaigns never share an mcp-config path.
    runId: get("--run-id", Math.random().toString(36).slice(2, 8))!,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tasks = args.taskIds ? CAMPAIGN_TASKS.filter((t) => args.taskIds!.has(t.id)) : CAMPAIGN_TASKS;
  const arms: BuildArm[] = [
    { name: "baseline", entry: resolve(args.baselineBuild) },
    { name: "candidate", entry: resolve(args.candidateBuild) },
  ];
  const modelPath = resolve(args.modelPath);
  const outPath = resolve(args.out);
  if (!existsSync(outPath)) writeFileSync(outPath, "");

  const total = arms.length * args.models.length * tasks.length * args.repeats;
  let done = 0;
  console.log(`Campaign: ${arms.length} arms x ${args.models.length} models x ${tasks.length} tasks x ${args.repeats} repeats = ${total} runs`);

  for (const arm of arms) {
    const configPath = resolve(process.cwd(), `.campaign-tmp/mcp-config-${arm.name}-${args.runId}.json`);
    writeFileSync(configPath, buildMcpConfig({ serverName: "mcp-server-ea", serverEntry: arm.entry, modelPath }));

    for (const model of args.models) {
      for (const task of tasks) {
        for (let rep = 1; rep <= args.repeats; rep++) {
          done++;
          const label = `[${done}/${total}] arm=${arm.name} model=${model} task=${task.id} rep=${rep}`;
          console.log(label);
          let record: CampaignRunRecord;
          try {
            const { events, raw } = await runAgentTask(task.question, {
              copilotBin: "copilot",
              mcpConfigPath: configPath,
              model,
              effort: args.effort,
            });
            const scope = checkServerScope(events, "mcp-server-ea");
            const modelInfo = checkModelInfo(events, "eval-model.qea");
            record = {
              timestamp: new Date().toISOString(),
              arm: arm.name,
              model,
              taskId: task.id,
              repeat: rep,
              toolCalls: Object.fromEntries(countToolCalls(events)),
              totalToolCalls: totalToolCalls(events),
              outcome: getRunOutcome(events),
              serverScopeOk: scope.ok,
              modelInfo,
              finalAnswerExcerpt: extractFinalAnswer(raw),
            };
            if (!scope.ok) console.error(`  ! unexpected servers: ${scope.unexpectedServers.join(", ")}`);
          } catch (err) {
            record = {
              timestamp: new Date().toISOString(),
              arm: arm.name,
              model,
              taskId: task.id,
              repeat: rep,
              toolCalls: {},
              totalToolCalls: 0,
              outcome: { exitCode: null, premiumRequests: null },
              serverScopeOk: false,
              modelInfo: { called: false, matchesExpected: false },
              finalAnswerExcerpt: "",
              error: err instanceof Error ? err.message : String(err),
            };
            console.error(`  ! error: ${record.error}`);
          }
          appendFileSync(outPath, JSON.stringify(record) + "\n");
        }
      }
    }
  }

  console.log(`Done. Results appended to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
