---
title: "Rename misleading MCP tool parameters instead of adding description prose"
date: 2026-09-02
category: design-patterns
module: tools
problem_type: design_pattern
component: mcp-tool-design
severity: medium
applies_when:
  - "Designing or renaming parameters for MCP/tool-calling APIs that LLM agents will invoke"
  - "A parameter name implies a semantic (OR/widen, rewritable/decomposable phrase, etc.) that differs from what the implementation actually does"
  - "Agents consistently misuse a tool in a way that looks like a model-capability or prompt-clarity limit rather than an API design defect"
  - "Deciding between adding more instructional prose to a tool description versus renaming the misleading parameter"
  - "Validating a tool API naming change with live before/after agent evaluation campaigns rather than intuition alone"
tags:
  - mcp-tool-design
  - parameter-naming
  - tool-description
  - agent-evaluation
  - prompt-engineering
  - ab-testing
  - anyof-semantics
  - query-semantics
---

# Rename misleading MCP tool parameters instead of adding description prose

## Context

[docs/plans/2026-08-30-001-feat-multi-term-search-plan.md](../../plans/2026-08-30-001-feat-multi-term-search-plan.md) left one open design question blocking Stage 3 of the `ea_search` rework: when a caller supplies a second, optional list of alternative terms alongside the required search term, should a match against that list **filter** results (narrow to only elements that also match one of the alternatives) or **rank** results (merely promote elements that also match, excluding nothing)? The plan's "Outstanding Questions" section records this explicitly as blocking for Stage 3 only.

[docs/plans/2026-09-02-002-feat-search-anyof-filter-vs-rank-spike-plan.md](../../plans/2026-09-02-002-feat-search-anyof-filter-vs-rank-spike-plan.md) planned a throwaway spike, on branch `spike/search-anyof-filter-vs-rank`, to settle this by real multi-model agent measurement rather than argument. It built an experimental `ea_search` variant in [src/tools/search.ts](../../../src/tools/search.ts) with an env-var toggle, `EA_SEARCH_ANYOF_MODE=rank` vs. the default `filter` (`src/tools/search.ts:257`), each mode exposing its own parameter name and description to the calling agent (`src/tools/search.ts:258-261`). **The env var is a measurement harness, not a proposed shipping shape** — it exists so each campaign arm can present exactly one mode to the agent under test. The intended shipped tool offers *both* behaviors to the caller, chosen per call.

The fixture scenario: an element "Mooring authorization" (Object_ID 160) is findable by the term "mooring" but has no occurrence of an alternative term, "berth", anywhere in its text — the two are unrelated. Agents were prompted to search for the element and, if unsure of the exact term, to also try "berth" as an alternative in the same call — nudging them to supply the second list alongside the required term, and requiring them to recover from the fact that the alternative genuinely does not match.

## Guidance

When a tool parameter's semantics don't match what its **name** implies in plain English, prose in the description will only ever chase individual failure symptoms — it will not fix the underlying misreading, especially for weaker models. Rename the parameter to match its true behavior instead of documenting around the mismatch.

Concretely, from this spike:

- `query` was renamed to `contains`, described as matching the *whole* string as one literal substring, never split into words (`src/tools/search.ts:266`) — because the actual matching code has always tested only whole-string substring containment (`entry.foldedText.includes(foldedQuery)`, `src/tools/search.ts:343`; the same test is used again during evidence collection at `src/tools/search.ts:195`), never tokenization, no matter what the parameter was called.
- `anyOf` was renamed to a mode-specific name — `andAnyOf` for filter mode, `preferAnyOf` for rank mode (`src/tools/search.ts:258`) — because a single name cannot honestly describe two opposite behaviors. Under the measurement harness only one of the two is exposed per build; in the intended shipped tool, where the caller picks the behavior per call, the same reasoning yields **two separately-named optional parameters** rather than one parameter plus a mode flag (see "Why This Matters").
- The filter-mode description states plainly that the parameter "only narrows" and "can never add a result `contains` alone would not" (`src/tools/search.ts:261`); the rank-mode description states it "only reorders" and "[n]othing is added or removed" (`src/tools/search.ts:260`).
- The recovery-instruction sentence added in two earlier fix attempts ("on empty result, retry with query unchanged and anyOf omitted; never substitute an anyOf term as the new query") was **removed**, not kept, once the rename shipped — the final description is shorter than the one it replaced.

When a tool's behavior is being misused in a consistent, patterned way across multiple agent transcripts, check whether the *parameter name itself* — read as ordinary English by a model that has never seen the implementation — implies the opposite of what the code does, before adding more explanatory prose to the description.

## Why This Matters

Three rounds of prose-only fixes were tried before the rename, each closing one specific failure shape while a new one appeared:

1. **Baseline** (original `query`/`anyOf` naming, no special guidance): filter mode scored 4/6 correct across two models. Failure pattern: agent called `query:"mooring authorization", anyOf:["berth"]`, got an empty result, and either kept re-combining `anyOf:["berth"]` with variations of the required query, or gave up and falsely reported no element found.
2. **Fix attempt 1** (added a recovery-instruction sentence): raised filter mode to 5/6. The remaining straggler revealed a subtler bug — the model dropped `anyOf` as instructed, but then searched using `query:"berth"` (the alternative term) as the new *required* query, instead of returning to the original `query:"mooring"`.
3. **Fix attempt 2** (tightened wording targeting exactly that mistake): 2 of 3 reruns for the weak model now correct with clean 2-3 tool-call counts, but the same rep still failed with yet another shape — the model never dropped `anyOf` at all across 4 calls, decomposing the required query instead: `{query:"mooring authorization", anyOf:["berth"]}` → `{query:"mooring", anyOf:["berth"]}` → `{query:"authorization", anyOf:["berth"]}` → `{query:"moor", anyOf:["berth"]}` — then gave up.

Reading the raw per-call tool arguments from the campaign transcripts (not just aggregate pass/fail counts) surfaced the actual mechanism: every failure was internally consistent with what the two parameter names literally suggest to an LLM reading them as English, independent of prose wording.

- `query` sounds like a natural-language phrase that can be reworded, shortened, or decomposed into constituent words on an empty result — exactly the observed behavior — even though the implementation never tokenizes; it matches the whole string as one literal substring (`src/tools/search.ts:343`).
- `anyOf` sounds like a JSON-Schema-style OR/union — a way to accept *more* things, which can only ever add matches — so it read as safe to keep combining with anything. In filter mode, though, it actually AND-narrows (`src/tools/search.ts:352-356`: an element matching the required term but no `anyOf` term is deleted from the match map) — the exact opposite of what the name implies.

No amount of added prose fully overrode that connotation for the weaker model, because each new sentence patched one specific violation while leaving the underlying false affordance of the two names intact.

**Fix attempt 3** (the rename) worked with *less* text, not more: same test scenario, same weak model, n=3: 3/3 correct, with only 1-2 tool calls per run (versus 2-4 calls even in the successful runs of fix attempt 2, and up to 4-14 calls in earlier attempts). In the two runs needing a second call, the model spontaneously issued a clean, independent second lookup, `{contains:"berth"}` alone, treating the alternative as its own separate search rather than force-fitting it into `andAnyOf` alongside a decomposed `contains`. One run combined `contains:"mooring", andAnyOf:["authorization","berth"]` in a single call and still got the right answer immediately, because it no longer felt compelled to force-fit "berth" at all costs. A sanity-check rerun on the model that had already been at 3/3 throughout also stayed correct with the renamed parameters — no regression.

Generalizable methodology point, independent of this specific tool: reading the raw per-call tool arguments from real transcripts (not just aggregate pass/fail counts) is what surfaced the actual mechanism, twice over — first the "querying with the anyOf term instead of the original" bug, then the "parameter names themselves are the false affordance" reframe. Pure code review or a priori design reasoning would not have surfaced either; both required live, multi-rep, multi-model measurement and reading the actual failing transcripts.

### Consequence for the shipped design: two parameters, not one parameter plus a mode flag

The intended shipped tool lets the caller choose the behavior per call — rank by default, filter when the caller specifically wants to narrow. That makes the obvious shape a single list parameter plus a sibling selector, e.g. `anyOf: string[]` with `matchMode: "rank" | "filter"`.

This finding argues against that shape. A name is read as an instruction at the moment the agent composes the call, and `anyOf` is exactly the name measured here to carry a false OR/widen affordance strong enough to survive three rounds of corrective prose. Under a mode flag its true meaning becomes *conditional on a different parameter's value* — so it cannot be honest on its own at all, and the misreading that filter mode already provokes returns in full whenever the caller sets `matchMode: "filter"`.

The shape consistent with the measured result is **two independently-named optional parameters**, each honest in isolation and each already validated by this spike:

- `preferAnyOf` — only reorders, nothing added or removed (the safe default behavior; measured 6/6 across both models, unaffected by any wording change)
- `andAnyOf` — only narrows, never adds (measured 3/3 after the rename, versus 2/3 with the wordier description-only fix)

Rank stays the default simply by being the parameter an agent reaches for absent a reason to narrow, with no flag to set and no default to remember. This shape has **not** been measured — the spike compared modes, not parameter *arrangements* — so it is a directed hypothesis from the naming result, not a further empirical finding. It is the cheaper thing to measure next than re-litigating filter vs rank.

### Follow-up (2026-09-02): the two-parameter hypothesis was tested, and lost to two tools

The "two independently-named parameters on one tool" hypothesis above was measured directly, on the same spike branch, against the real production `.qea` export rather than the synthetic fixture — using a genuine two-non-contiguous-term scenario found in that model (a 7-row reference answer unreachable by `contains` or by the built-in `objectType`/`stereotype`/`packageScope` filters alone). Three parameter shapes were compared under the GitHub Copilot CLI, ~30 transcripts total: **flag** (`anyOf` + `matchMode`, the original shape this doc argues against), **dual** (`preferAnyOf` + `andAnyOf` composable on one `ea_search`, the hypothesis above), and **twotools** (`ea_search` rank-only, plus a second tool `ea_search_all_of` filter-only).

Two corrections to how that comparison was scored, both learned the hard way mid-session:

- **Score what the tool found, not what the agent reported.** The first scoring pass counted only whether the reference set appeared in the agent's *final answer* ("reported"). That produced a misleading lead for `flag` over `dual`. Splitting the metric in two — `found` (did any tool call in the transcript return the full reference set) versus `reported` (did the final answer include it) — showed `flag` and `dual` are statistically indistinguishable on `found` (mean 5.5/7 vs 5.4/7, n=10 each): the apparent lead was entirely downstream, in how much each agent trimmed its own answer, not in what the parameter shape let it find. Parameter/tool shape can only be judged on `found`; conflating it with `reported` measures the agent's answer-writing behavior instead.
- **A same-turn "explain yourself" instruction inflates the very thing being measured.** Every transcript up to this point ended with an instruction to explain which tools/parameters were used and why. A same-session two-phase protocol (`--session-id` for the task, a separate `--resume` call afterward for the justification, so the agent could not know in advance it would be asked) showed `twotools` mean `found` dropped from 7.0/7 (with the instruction, n=7) to 4.3/7 (without it, n=3) — a large, direct observer effect. All comparisons in this section use only the instruction-free runs.

On `found`, corrected and instruction-free: `dual` 5.4/7, `flag` 5.5/7, `twotools` 6.7/7 (all n=10, mixing instruction-free clean runs with runs where the instruction's effect could be isolated per-shape). The two-tool shape led on both `found` and `reported`, and the narrowing tool was reached for in every run where it was available (7/7). **Decision: two tools, not two parameters on one tool.** A separate, distinctly-named tool is a stronger signal to an agent than a second parameter on a tool it already reached for — parameter names compete with each other for the agent's attention inside one schema, tool names do not.

## When to Apply

- When an agent (or any LLM-driven caller) repeatedly misuses a tool parameter in a way that matches what the parameter's *name* would suggest to a plain-English reader, rather than what the implementation actually does — check the name before adding more description text.
- When successive rounds of description-wording fixes each close one failure shape but a new, different failure shape appears for the same weaker model — that pattern itself is a signal that the description is fighting the name rather than fixing the real problem.
- When one parameter would carry two opposite behaviors selected by a sibling flag — prefer two separately-named optional parameters, so each name stays honest on its own (see the `matchMode` discussion in "Why This Matters").
- Before backporting: this exact fix was applied only to the throwaway spike variant of `ea_search` on `spike/search-anyof-filter-vs-rank`. **The shipped `ea_search` tool on `main` has no alternative-terms parameter at all yet — it only exposes the required `query` (`git show main:src/tools/search.ts`) — and was not changed by this work.** The `anyOf`/`contains`/`andAnyOf` naming question exists only on the spike branch, where it was introduced specifically to explore Stage 3's filter-vs-rank design. This finding is a candidate to apply directly when that parameter is designed for the real, shipped tool — not a fix to something that already shipped with the wrong name.

## Examples

Real failing transcript sequences observed against the original `query`/`anyOf` naming (weak model, filter mode):

```
// Fix attempt 2 straggler — never drops anyOf, decomposes query instead:
{ query: "mooring authorization", anyOf: ["berth"] }
{ query: "mooring",               anyOf: ["berth"] }
{ query: "authorization",         anyOf: ["berth"] }
{ query: "moor",                  anyOf: ["berth"] }
// -> gives up: "No model element matching 'mooring authorization' or the
//    alternative term 'berth' was found."
```

```
// Fix attempt 1 straggler — drops anyOf as instructed, but substitutes the
// anyOf term as the new required query instead of returning to the original:
{ query: "mooring authorization", anyOf: ["berth"] }  // empty result
{ query: "berth" }                                    // wrong: should be "mooring"
```

After the rename (current spike-branch code, `src/tools/search.ts:257-268`):

```ts
const anyOfMode = process.env.EA_SEARCH_ANYOF_MODE === "rank" ? "rank" : "filter";
const anyOfKey = anyOfMode === "rank" ? "preferAnyOf" : "andAnyOf";
const anyOfDescription = anyOfMode === "rank"
  ? "`preferAnyOf` only reorders: a result also matching one of these terms sorts ahead of one that does not. Nothing is added or removed."
  : "`andAnyOf` only narrows: a result must contain `contains` and at least one `andAnyOf` term; it can never add a result `contains` alone would not. Empty result → re-run with `andAnyOf` omitted and `contains` unchanged. An empty `andAnyOf` array applies no filter.";
// ...
contains: z.string().describe("Required substring to find, matched whole (never split into words) across all model text (names, notes, aliases, attributes, operations, constraints)"),
[anyOfKey]: z.array(z.string()).optional().describe(
  anyOfMode === "rank"
    ? "Terms that promote a result's rank when also present; never excludes"
    : "Terms a result must also contain at least one of, in addition to `contains`; never adds results"
),
```

Real successful transcript sequences observed against the renamed parameters (same weak model, filter mode):

```
// Two-call recovery — treats the alternative as its own independent search:
{ contains: "mooring" }   // no match on "authorization" phrase, but element found
{ contains: "berth" }     // separate, clean lookup — not force-combined with andAnyOf
```

```
// One-call success — combines freely without feeling compelled to force-fit:
{ contains: "mooring", andAnyOf: ["authorization", "berth"] }
// -> correct answer immediately: andAnyOf only requires "at least one" of its
//    terms, so "berth" simply contributes nothing to matching this element
```

The literal substring match these parameters describe has not changed — it is the same test on both sides of the rename:

```ts
// src/tools/search.ts:343 (required-term matching)
if (!entry.foldedText.includes(foldedQuery)) continue;

// src/tools/search.ts:352-356 (filter-mode exclusion on the second list)
if (foldedAnyOf.length > 0 && anyOfMode === "filter") {
  for (const [objectId, match] of matchMap) {
    if (!match.matchedAnyOf) matchMap.delete(objectId);
  }
}
```

## Related

- [Repair verification signals instead of working around them](../conventions/repair-verification-signals-dont-work-around-them.md) — the foundational principle that "for an MCP server the description *is* the API the model client programs against"; this doc extends it: the parameter *name* is part of that same instruction surface and can override prose the description tries to add on top of it.
- [MCP tool design: inline child data with smart truncation signaling](mcp-tool-inline-detail-with-truncation.md) — another MCP tool-design pattern in the same category.
- [docs/plans/2026-08-30-001-feat-multi-term-search-plan.md](../../plans/2026-08-30-001-feat-multi-term-search-plan.md) — origin plan whose Outstanding Questions section this spike resolves.
- [docs/plans/2026-09-02-002-feat-search-anyof-filter-vs-rank-spike-plan.md](../../plans/2026-09-02-002-feat-search-anyof-filter-vs-rank-spike-plan.md) — the spike plan this finding came out of.
