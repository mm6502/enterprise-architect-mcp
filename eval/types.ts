export interface EvalAssertion {
  type: "equals" | "contains" | "gte" | "exists" | "length_gte";
  path: string;
  expected?: unknown;
}

export interface EvalTask {
  id: string;
  tool: string;
  description: string;
  args: Record<string, unknown>;
  assertions: EvalAssertion[];
}

export interface EvalResult {
  id: string;
  tool: string;
  description: string;
  passed: boolean;
  assertions: {
    path: string;
    type: string;
    expected: unknown;
    actual: unknown;
    passed: boolean;
  }[];
  elapsedMs: number;
  error?: string;
}

export interface EvalReport {
  /** The temp path the model was built at — a run artifact, not an input. */
  modelPath: string;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  results: EvalResult[];
}
