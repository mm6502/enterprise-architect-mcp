/**
 * Pure reduction over the harness's JSONL transcript shape — confirmed against a real
 * `copilot --output-format json` run over a built server on 2026-09-01 (see agent-runner.ts).
 * The CLI-spawning path itself is not covered here: it depends on an installed, authenticated
 * `copilot` binary and is verified by running one task by hand instead.
 */
import {
  parseTranscript,
  extractToolCalls,
  extractToolResults,
  countToolCalls,
  totalToolCalls,
  getRunOutcome,
  checkServerScope,
  checkModelInfo,
  buildMcpConfig,
} from "../eval/agent-runner.js";

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

function toolStart(toolCallId: string, toolName: string, mcpServerName: string, mcpToolName: string, args: unknown = {}) {
  return line({ type: "tool.execution_start", data: { toolCallId, toolName, mcpServerName, mcpToolName, arguments: args } });
}

function toolComplete(toolCallId: string, success: boolean, content?: string) {
  return line({ type: "tool.execution_complete", data: { toolCallId, success, result: content !== undefined ? { content } : undefined } });
}

function resultEvent(exitCode: number, premiumRequests: number) {
  return line({ type: "result", exitCode, usage: { premiumRequests } });
}

describe("parseTranscript", () => {
  it("parses one JSON object per line", () => {
    const jsonl = [toolStart("c1", "mcp-server-ea-ea_search", "mcp-server-ea", "ea_search"), resultEvent(0, 1)].join("\n");
    const events = parseTranscript(jsonl);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("tool.execution_start");
    expect(events[1].type).toBe("result");
  });

  it("drops non-JSON noise instead of aborting the whole parse", () => {
    const jsonl = ["❯ some terminal control fragment", toolStart("c1", "mcp-server-ea-ea_search", "mcp-server-ea", "ea_search"), ""].join("\n");
    const events = parseTranscript(jsonl);
    expect(events).toHaveLength(1);
  });
});

describe("countToolCalls / totalToolCalls", () => {
  it("yields the expected per-tool counts from a recorded transcript", () => {
    const jsonl = [
      toolStart("c1", "mcp-server-ea-ea_search", "mcp-server-ea", "ea_search"),
      toolStart("c2", "mcp-server-ea-ea_search", "mcp-server-ea", "ea_search"),
      toolStart("c3", "mcp-server-ea-ea_get_element", "mcp-server-ea", "ea_get_element"),
    ].join("\n");
    const events = parseTranscript(jsonl);
    const counts = countToolCalls(events);
    expect(counts.get("ea_search")).toBe(2);
    expect(counts.get("ea_get_element")).toBe(1);
    expect(totalToolCalls(events)).toBe(3);
  });

  it("excludes report_intent, the agent's own bookkeeping tool", () => {
    const jsonl = [
      toolStart("c1", "report_intent", "mcp-server-ea", "report_intent"),
      toolStart("c2", "mcp-server-ea-ea_search", "mcp-server-ea", "ea_search"),
    ].join("\n");
    const events = parseTranscript(jsonl);
    expect(countToolCalls(events).has("report_intent")).toBe(false);
    expect(totalToolCalls(events)).toBe(1);
  });
});

describe("getRunOutcome", () => {
  it("reads exit code and premium requests off the closing result event", () => {
    const events = parseTranscript(resultEvent(0, 3));
    expect(getRunOutcome(events)).toEqual({ exitCode: 0, premiumRequests: 3 });
  });

  it("reports nulls when the transcript never closed", () => {
    const events = parseTranscript(toolStart("c1", "mcp-server-ea-ea_search", "mcp-server-ea", "ea_search"));
    expect(getRunOutcome(events)).toEqual({ exitCode: null, premiumRequests: null });
  });
});

describe("checkServerScope", () => {
  it("passes when every call names the expected server", () => {
    const events = parseTranscript(toolStart("c1", "mcp-server-ea-ea_search", "mcp-server-ea", "ea_search"));
    expect(checkServerScope(events, "mcp-server-ea")).toEqual({ ok: true, unexpectedServers: [] });
  });

  it("rejects a transcript whose server list shows the wrong server rather than counting it", () => {
    const events = parseTranscript(toolStart("c1", "github-mcp-server-list_issues", "github-mcp-server", "list_issues"));
    const check = checkServerScope(events, "mcp-server-ea");
    expect(check.ok).toBe(false);
    expect(check.unexpectedServers).toEqual(["github-mcp-server"]);
  });
});

describe("checkModelInfo", () => {
  const modelInfoResult = (fileName: string, sourceId: string) =>
    JSON.stringify({ fileName, configuration: { sourceId } });

  it("confirms the run opened the intended synthetic model", () => {
    const jsonl = [
      toolStart("c1", "mcp-server-ea-ea_get_model_info", "mcp-server-ea", "ea_get_model_info"),
      toolComplete("c1", true, modelInfoResult("eval-model.qea", "argument")),
    ].join("\n");
    const events = parseTranscript(jsonl);
    const check = checkModelInfo(events, "eval-model.qea");
    expect(check).toEqual({ called: true, matchesExpected: true, actualFileName: "eval-model.qea" });
  });

  it("rejects a transcript whose model-info reply names a file other than the synthetic model", () => {
    const jsonl = [
      toolStart("c1", "mcp-server-ea-ea_get_model_info", "mcp-server-ea", "ea_get_model_info"),
      toolComplete("c1", true, modelInfoResult("real-customer-export.qea", "environment")),
    ].join("\n");
    const events = parseTranscript(jsonl);
    const check = checkModelInfo(events, "eval-model.qea");
    expect(check.matchesExpected).toBe(false);
    expect(check.actualFileName).toBe("real-customer-export.qea");
  });

  it("reports the model was never confirmed when the run never called ea_get_model_info", () => {
    const events = parseTranscript(toolStart("c1", "mcp-server-ea-ea_search", "mcp-server-ea", "ea_search"));
    expect(checkModelInfo(events, "eval-model.qea")).toEqual({ called: false, matchesExpected: false });
  });
});

describe("extractToolCalls / extractToolResults", () => {
  it("pairs a call with its result by toolCallId", () => {
    const jsonl = [
      toolStart("c1", "mcp-server-ea-ea_search", "mcp-server-ea", "ea_search", { query: "zmluva" }),
      toolComplete("c1", true, "{}"),
    ].join("\n");
    const events = parseTranscript(jsonl);
    const calls = extractToolCalls(events);
    const results = extractToolResults(events);
    expect(calls).toHaveLength(1);
    expect(calls[0].arguments).toEqual({ query: "zmluva" });
    expect(results[0].toolCallId).toBe(calls[0].toolCallId);
    expect(results[0].success).toBe(true);
  });
});

describe("buildMcpConfig", () => {
  it("binds one server name to one build's entry point and model path", () => {
    const config = JSON.parse(buildMcpConfig({ serverName: "mcp-server-ea", serverEntry: "/build/dist/index.js", modelPath: "/tmp/model.qea" }));
    expect(config.mcpServers["mcp-server-ea"]).toEqual({
      type: "local",
      command: "node",
      args: ["/build/dist/index.js", "/tmp/model.qea"],
      tools: ["*"],
    });
  });
});
