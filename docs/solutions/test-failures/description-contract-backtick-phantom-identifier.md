---
title: "Description-contract test treats every backticked token as a claimed identifier"
date: 2026-09-02
category: test-failures
module: tools (MCP tool descriptions)
problem_type: test_failure
component: testing_framework
symptoms:
  - "`npm test` fails in test/description-contract.test.ts with \"promises no identifier that is neither a response field nor a parameter\""
  - "The failure lists backticked words from a tool description that are not real field or parameter names (a literal value, a quoted string, or a full code-snippet phrase)"
  - "A newly added, correctly implemented response field is also reported as phantom, even though the code returns it"
root_cause: logic_error
resolution_type: documentation_update
severity: low
tags: [description-contract, mcp-tool-description, backtick, sample-calls, test-contract]
---

# Description-contract test treats every backticked token as a claimed identifier

## Problem

`test/description-contract.test.ts` parses every backtick-quoted span in a tool's description as a claim that an identifier of that exact name exists — either as a response field, a declared parameter, `_meta.sourceTables` value, or another tool's name (`documentedNames` at test/description-contract.test.ts:123, consumed by the phantom check at test/description-contract.test.ts:182-193). Writing a description the way normal prose-with-code-formatting reads — backticking a value, an enum literal, or a short code snippet for readability — makes the test fail, even when the description is accurate and the code behaves exactly as described.

## Symptoms

- `npm test` fails with `● tool descriptions are bound to behaviour › <tool> › promises no identifier that is neither a response field nor a parameter`.
- The reported array names things that are not field/parameter identifiers at all: a connector-type value (`Generalization`), a quoted string literal (`"child"`), or a full example phrase (`direction: "incoming"`).
- Separately, a real, currently-implemented field name (`role`) can appear in the same failure — not because it doesn't exist, but because no `SAMPLE_CALLS` entry in the test happens to trigger the conditional branch that produces it.

## What Didn't Work

The first draft of `ea_get_connectors`'s updated description (adding the Generalization child/parent convention introduced in `src/tools/connectors.ts:149-150`) wrote the convention the way a person would naturally format it for a reader: backticking the connector-type value and the two literal role strings, and backticking a worked example as a code phrase — `` `Generalization` ``, `` `"child"`/`"parent"` ``, `` `connectorType: "Generalization"` ``, `` `direction: "incoming"` ``. Each of those is prose-with-formatting, not an identifier, but the test cannot tell the difference — it only sees backticks.

## Solution

Two independent fixes were needed:

1. **Only backtick real identifiers in the description.** Field and parameter names (`` `source` ``, `` `dest` ``, `` `role` ``, `` `connectorType` ``, `` `direction` ``) stay backticked; connector-type values, string literals, and worked examples are written as plain prose instead (`src/tools/connectors.ts:74`).
2. **Add a `SAMPLE_CALLS` entry that actually exercises the conditional branch.** A description is allowed to promise a field that only appears in some responses, but the test can only confirm that promise against a response it has actually seen. `test/description-contract.test.ts:58` adds `["ea_get_connectors", { elementId: 5, connectorType: "Generalization" }]` alongside the existing `elementId: 1` call, so a real Generalization connector's `role` field lands in the collected response keys the phantom check compares against.

## Why This Works

`documentedNames` (test/description-contract.test.ts:123) extracts every `` `...` `` span from a description with one regex, with no way to distinguish "this names a field" from "this is formatted example text" — that distinction has to be enforced by how the description is written, not by the parser. The phantom check (test/description-contract.test.ts:182-193) then requires every extracted name to appear either in the union of all `SAMPLE_CALLS` responses' keys, in the tool's declared parameters, in `_meta.sourceTables`, or in `CONTRACT_FIELDS`/another tool's name (test/description-contract.test.ts:30, 46) — so a real field that no sample call ever triggers is indistinguishable, to the test, from a field that doesn't exist.

## Prevention

- When writing or editing a tool description, backtick only names that are response fields, parameters, or table names — never a value, an enum literal, or an example phrase. Write those in plain prose or in double quotes without backticks.
- When a description documents a field that only appears in some responses (a conditional branch, a specific type/stereotype, a truncated-window case), add a `SAMPLE_CALLS` entry whose arguments actually produce that branch. Without it, both the "names every field" and the "no phantom identifier" checks fail for reasons that look identical from the error message alone.
- If the failure message lists something that plainly isn't a field or parameter name, the fix is almost always to remove the backticks from the description — not to add the name anywhere in code.

## Related Issues

None on file yet — first occurrence of this pattern (docs/plans/2026-09-02-001-fix-known-tool-bugs-plan.md, U3).
