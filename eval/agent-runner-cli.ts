#!/usr/bin/env node
/**
 * Thin CLI entry for the agent measurement harness — mirrors runner.ts/fixture.ts: the library
 * (agent-runner.ts) holds the pure, unit-tested logic; this script only wires it to argv and
 * spawns the real `copilot` process. Kept separate so agent-runner.ts stays import.meta-free and
 * importable from ts-jest, which compiles tests to CommonJS.
 *
 * Runs exactly one task against one model, one effort level, and one server build — a smoke run
 * to verify the harness, not the R19 campaign across the full model matrix (see U5/U9 in the
 * plan). Usage:
 *   tsx eval/agent-runner-cli.ts --build <dist/index.js> --model-path <eval-model.qea> \
 *     --task "<prompt>" [--model <id>] [--effort <level>] [--server-name <name>]
 */
import { writeFileSync } from "node:fs";
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

interface CliArgs {
  build: string;
  model: string;
  effort: string;
  task: string;
  modelPath: string;
  serverName: string;
  copilotBin: string;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string, fallback?: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : fallback;
  };
  const build = get("--build");
  const modelPath = get("--model-path");
  const task = get("--task");
  if (!build || !modelPath || !task) {
    throw new Error(
      "Usage: agent-runner-cli --build <dist/index.js> --model-path <eval-model.qea> --task <prompt> [--model <id>] [--effort <level>] [--server-name <name>] [--copilot-bin <path>]"
    );
  }
  return {
    build,
    modelPath,
    task,
    model: get("--model", "gpt-5-mini")!,
    effort: get("--effort", "low")!,
    serverName: get("--server-name", "mcp-server-ea")!,
    copilotBin: get("--copilot-bin", "copilot")!,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = resolve(process.cwd(), ".agent-runner-mcp-config.json");
  writeFileSync(
    configPath,
    buildMcpConfig({ serverName: args.serverName, serverEntry: resolve(args.build), modelPath: resolve(args.modelPath) })
  );

  console.log(`Running task against model=${args.model} effort=${args.effort} build=${args.build}`);
  const { events, raw } = await runAgentTask(args.task, {
    copilotBin: args.copilotBin,
    mcpConfigPath: configPath,
    model: args.model,
    effort: args.effort,
  });

  if (events.length === 0) {
    console.error("No transcript events parsed. Raw output follows:");
    console.error(raw.slice(0, 2000));
    process.exit(2);
  }

  const scope = checkServerScope(events, args.serverName);
  if (!scope.ok) {
    console.error(`Aborting: unexpected servers in transcript: ${scope.unexpectedServers.join(", ")}`);
    process.exit(2);
  }

  const modelInfoFileName = args.modelPath.split(/[/\\]/).pop()!;
  const modelInfo = checkModelInfo(events, modelInfoFileName);
  if (!modelInfo.called) {
    console.warn("Warning: the run never called ea_get_model_info — model identity was not confirmed.");
  } else if (!modelInfo.matchesExpected) {
    console.error(`Aborting: model identity mismatch. Expected fileName=${modelInfoFileName}, got ${modelInfo.actualFileName}`);
    process.exit(2);
  }

  const counts = countToolCalls(events);
  const outcome = getRunOutcome(events);

  console.log("Tool calls:");
  for (const [tool, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tool}: ${count}`);
  }
  console.log(`Total tool calls: ${totalToolCalls(events)}`);
  console.log(`Exit code: ${outcome.exitCode}, premium requests: ${outcome.premiumRequests}`);

  const reportPath = resolve(process.cwd(), "eval", "agent-results.json");
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        model: args.model,
        effort: args.effort,
        task: args.task,
        toolCalls: Object.fromEntries(counts),
        totalToolCalls: totalToolCalls(events),
        outcome,
        modelInfo,
      },
      null,
      2
    )
  );
  console.log(`Report written to ${reportPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
