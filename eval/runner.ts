#!/usr/bin/env node
/**
 * Eval runner: builds the eval model, starts the MCP server over stdio, executes the
 * tasks in tasks.json, scores the assertions, and tears the model down.
 * Usage: npx tsx eval/runner.ts [tasks-json]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvalModel } from "./fixture.js";
import type { EvalTask, EvalResult, EvalReport, EvalAssertion } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateAssertion(response: unknown, assertion: EvalAssertion): { passed: boolean; actual: unknown } {
  const actual = getByPath(response, assertion.path);

  switch (assertion.type) {
    case "equals":
      return { passed: JSON.stringify(actual) === JSON.stringify(assertion.expected), actual };
    case "contains":
      if (typeof actual === "string" && typeof assertion.expected === "string") {
        return { passed: actual.includes(assertion.expected), actual };
      }
      return { passed: false, actual };
    case "gte":
      return { passed: typeof actual === "number" && actual >= (assertion.expected as number), actual };
    case "exists":
      return { passed: actual !== null && actual !== undefined, actual: actual !== null && actual !== undefined };
    case "length_gte":
      if (Array.isArray(actual)) {
        return { passed: actual.length >= (assertion.expected as number), actual: actual.length };
      }
      return { passed: false, actual };
    default:
      return { passed: false, actual };
  }
}

async function main() {
  const tasksPath = process.argv[2] || resolve(__dirname, "tasks.json");
  const tasksJson = await readFile(tasksPath, "utf-8");
  const tasks: EvalTask[] = JSON.parse(tasksJson);

  const model = buildEvalModel();
  console.log(`Built eval model at ${model.path}`);
  const serverPath = resolve(__dirname, "..", "dist", "index.js");

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath, model.path],
  });

  const client = new Client({ name: "eval-runner", version: "1.0.0" });
  const results: EvalResult[] = [];

  try {
    await client.connect(transport);
    console.log(`Connected. Running ${tasks.length} eval tasks...\n`);

    for (const task of tasks) {
      const start = performance.now();
      try {
        const response = await client.callTool({ name: task.tool, arguments: task.args });
        const text = (response.content as { text: string }[])[0]?.text;
        const parsed = JSON.parse(text);
        const elapsed = performance.now() - start;

        const assertionResults = task.assertions.map((a) => {
          const { passed, actual } = evaluateAssertion(parsed, a);
          return { path: a.path, type: a.type, expected: a.expected, actual, passed };
        });

        const allPassed = assertionResults.every((a) => a.passed);
        results.push({
          id: task.id,
          tool: task.tool,
          description: task.description,
          passed: allPassed,
          assertions: assertionResults,
          elapsedMs: Math.round(elapsed),
        });

        const mark = allPassed ? "✓" : "✗";
        console.log(`  ${mark} ${task.id}: ${task.description} (${Math.round(elapsed)}ms)`);
        if (!allPassed) {
          for (const a of assertionResults.filter((r) => !r.passed)) {
            console.log(`    FAIL: ${a.path} ${a.type} expected=${JSON.stringify(a.expected)} actual=${JSON.stringify(a.actual)}`);
          }
        }
      } catch (err) {
        const elapsed = performance.now() - start;
        results.push({
          id: task.id,
          tool: task.tool,
          description: task.description,
          passed: false,
          assertions: [],
          elapsedMs: Math.round(elapsed),
          error: err instanceof Error ? err.message : String(err),
        });
        console.log(`  ✗ ${task.id}: ERROR — ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    // The model is a temp directory; a task that throws must not leave it behind.
    await client.close().catch(() => { /* transport may already be gone */ });
    model.cleanup();
  }

  const report: EvalReport = {
    modelPath: model.path,
    timestamp: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
  };

  const outPath = resolve(__dirname, "results.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Total: ${report.total} | Passed: ${report.passed} | Failed: ${report.failed}`);
  console.log(`Results written to ${outPath}`);

  process.exit(report.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
