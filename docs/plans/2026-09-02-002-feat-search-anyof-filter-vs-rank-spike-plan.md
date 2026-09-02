---
title: Stage 3 Second-List Semantics - Filter vs Rank Measurement Spike - Plan
type: feat
date: 2026-09-02
topic: search-anyof-filter-vs-rank-spike
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Stage 3 Second-List Semantics - Filter vs Rank Measurement Spike - Plan

## Goal Capsule

- **Objective:** Resolve, by measurement rather than argument, the one blocking question standing between [docs/plans/2026-08-30-001-feat-multi-term-search-plan.md](docs/plans/2026-08-30-001-feat-multi-term-search-plan.md) and planning Stage 3: should `ea_search`'s optional second list of alternative terms **filter** (at least one must match) or **rank** (present terms promote, absent terms cost nothing)?
- **Product authority:** This plan owns a temporary, unshipped experimental parameter and its measurement. It does not own Stage 3's real, breaking `query`-as-list contract — that is planned separately, after this spike reports.
- **Execution profile:** One short-lived spike branch (never merged to `main`), one small eval addition, one measurement campaign, one recorded decision. Nothing here ships.
- **Stop conditions:** Do not merge the experimental `anyOf` parameter to `main` under any outcome — it is deleted once the decision is recorded, whatever that decision is. Do not treat agent-strategy divergence between arms as noise to normalize away (see KD3).
- **Open blockers:** None — this plan exists specifically to close the blocker on the origin plan.

---

## Product Contract

### Summary

Build one non-breaking, temporary `anyOf` parameter on `ea_search`, toggle its semantics (filter vs rank) with an environment variable read once at server startup, and measure both arms with the same agent-campaign harness already used for Stages 1 and 2. Record the decision back into the origin plan's Outstanding Questions, then delete the spike branch.

### Problem Frame

The origin plan's Stage 3 (multi-term matching, list-valued `query`) is deliberately unplanned because one design choice cannot be settled by argument: when a caller supplies required terms plus a list of alternatives, should an element that matches every required term but none of the alternatives be **excluded** (filter) or merely **not promoted** (rank)? The origin plan names this as *"Blocking for Stage 3; not blocking for Stages 1 and 2"* and ties it to KD11 ("the tool retrieves and evidences; it does not interpret") and to how much window-crowding survives Stage 2's narrowing.

Two corrections shape this plan, both from direct user feedback on the initial proposal:

1. **The tool description must explain the parameter, not stay silent about it.** An agent cannot use `anyOf` sensibly, in either mode, unless its description says what the parameter does and how the current build's mode behaves. Keeping the description identical across both arms (the original proposal) would leave the agent guessing at semantics it was never told — the description is part of what's being measured, not overhead to hide.
2. **Divergent agent behaviour between arms is signal, not a confound to eliminate.** An agent that guesses an alternative wrong gets back nothing under filter mode and a ranked-but-imperfect list under rank mode — those are different situations, and an agent may reasonably choose a different next step in each (retry with a different guess, fall back to `ea_get_element`, or accept an imperfect result). The measurement must capture *how* the agent recovers in each arm, not just whether the final answer was correct.

### Key Decisions

- KD1. **One build, one env-var toggle — not two dist trees.** `EA_SEARCH_ANYOF_MODE=filter|rank` (default `filter`) is read once when the tool is configured; no worktree or branch split is needed for the two arms, since the change is small and never reaches `main`. (session-settled: user-approved — chosen over building two separate dist trees per arm: cheaper and the change is small enough not to need commit isolation.) Governs U1, U3.
- KD2. **The description text is mode-specific, not generic.** Each mode's description must state its own real behaviour — filter mode: "an element matching every required term but none of `anyOf` is excluded"; rank mode: "elements matching an `anyOf` term rank higher; matching none does not exclude a result, only leaves it unpromoted." Verified against the description-contract test's backtick rule ([docs/solutions/test-failures/description-contract-backtick-phantom-identifier.md](docs/solutions/test-failures/description-contract-backtick-phantom-identifier.md)) — only real field/parameter names get backticked, not example values. (session-settled: user-directed — chosen over keeping the description identical across both arms: an agent cannot use `anyOf` sensibly in either mode without being told the active mode's real semantics.) Governs U1.
- KD3. **Agent-strategy divergence between arms is a graded outcome, not noise.** Beyond the existing KD9 discipline (correctness as gate, call count as result), the campaign records a third signal: for the same wrong-guessed-alternative scenario, did the agent recover sensibly from filter mode's empty result, and did rank mode's imperfect-but-present result mislead it into accepting a wrong answer too readily? (session-settled: user-directed — chosen over treating cross-arm behavioural differences as a confound to control away: a wrong guess produces a genuinely different situation in each mode, and the agent's recovery from each is itself part of what the decision must weigh.) Governs U3.
- KD4. **`anyOf` is additive to `query: string` and ships nowhere.** No version bump, no release, no change to `main`'s public contract. The experiment lives on a short-lived branch, deleted once the decision is recorded. (session-settled: user-approved — chosen over shipping the experimental parameter provisionally: the real Stage 3 contract is a breaking change, so a temporary additive parameter must not linger as a second, unofficial shape.) Governs U1, U4.

### Requirements

- R1. `ea_search` accepts an optional `anyOf: string[]` alongside the existing required `query`, on the spike branch only.
- R2. `EA_SEARCH_ANYOF_MODE` (`filter` | `rank`, default `filter`) controls whether an element matching every required term but no `anyOf` term is excluded (filter) or merely not promoted (rank).
- R3. The tool description accurately states the active mode's real behaviour — not a mode-agnostic summary — per KD2.
- R4. The eval fixture/tasks gain at least one scenario where the correct answer matches the required term but the natural alternative an agent would guess does *not* match it, and one exercising window crowding (enough decoys that an unpromoted correct match risks falling outside the response window), using vocabulary disjoint from existing eval assertions.
- R5. The campaign records, per KD3, whether and how the agent's subsequent tool-call strategy diverges between the filter arm's empty result and the rank arm's non-empty result for the same wrong-guess scenario.
- R6. The decision (filter, rank, or a hybrid) is recorded in [docs/plans/2026-08-30-001-feat-multi-term-search-plan.md](docs/plans/2026-08-30-001-feat-multi-term-search-plan.md)'s Outstanding Questions, closing that blocker. The spike branch is deleted once recorded, per KD4.

---

## Implementation Units

| Unit | Title | Key files | Depends on |
|---|---|---|---|
| U1 | `anyOf` parameter with filter/rank toggle | [src/tools/search.ts](src/tools/search.ts), [test/tools.test.ts](test/tools.test.ts) | — |
| U2 | Eval scenarios for wrong-guess and window-crowding | [eval/fixture.ts](eval/fixture.ts), [eval/tasks.json](eval/tasks.json), [test/eval-fixture.test.ts](test/eval-fixture.test.ts) | U1 |
| U3 | Measurement campaign, both arms | none committed except the recorded finding | U1, U2 |
| U4 | Record decision, delete spike branch | [docs/plans/2026-08-30-001-feat-multi-term-search-plan.md](docs/plans/2026-08-30-001-feat-multi-term-search-plan.md) | U3 |

### U1. `anyOf` parameter with filter/rank toggle

- **Goal.** A minimal, working implementation of both candidate semantics, cheap enough to build once and toggle.
- **Requirements.** R1, R2, R3.
- **Files.** [src/tools/search.ts](src/tools/search.ts), [test/tools.test.ts](test/tools.test.ts).
- **Approach.**
  1. Read `EA_SEARCH_ANYOF_MODE` once where `configureSearchTools` runs, defaulting to `"filter"` for any unrecognised or unset value.
  2. Accept `anyOf: z.array(z.string()).optional()`. When supplied, an object already matching required `query` is additionally checked against the corpus for each `anyOf` term (same substring/fold matching `scoreMatch`'s corpus already uses).
  3. **Filter mode:** exclude an object matching `query` but none of `anyOf`. An empty `anyOf` array (`[]`) behaves exactly as if `anyOf` were not supplied at all — no filtering.
  4. **Rank mode:** never exclude on `anyOf`. Give the matchMap entry an additional `matchedAnyOf: boolean` field; sort by the existing `rank`, then by `matchedAnyOf` (true before false), then by the existing `coverage` tiebreak — when `anyOf` is absent every entry's `matchedAnyOf` is `false`, so the tiebreak is a no-op and today's ranking for a plain `query`-only call is unchanged. An empty `anyOf` array behaves as if not supplied (never `matchedAnyOf: true`).
  5. Build the tool description string from a small per-mode template at configuration time, per KD2 — one sentence stating the active mode's actual behaviour, not both modes' behaviour hedged together.
- **Test scenarios.**
  - Filter mode: an object matching `query` but no `anyOf` term is excluded from `results`.
  - Filter mode: an object matching `query` and at least one `anyOf` term is included.
  - Filter mode: `anyOf: []` behaves identically to `anyOf` not supplied (no exclusion).
  - Rank mode: an object matching `query` but no `anyOf` term is still included, unpromoted (`matchedAnyOf: false`).
  - Rank mode: an object matching both `query` and an `anyOf` term ranks above an otherwise-equal object matching only `query` (`matchedAnyOf: true` sorts first within the same rank tier).
  - Rank mode: `anyOf: []` behaves identically to `anyOf` not supplied (`matchedAnyOf` always `false`).
  - Unset/unrecognised `EA_SEARCH_ANYOF_MODE` behaves as filter mode (the documented default).
  - The tool description differs between the two modes and, in each mode, only backticks real field/parameter names (bound by a direct read of the built description string under each mode, not by re-running the full description-contract suite, since this parameter never reaches `main`).
- **Verification.** `npm test` on the spike branch.

### U2. Eval scenarios for wrong-guess and window-crowding

- **Goal.** Give the campaign something that actually exercises the filter/rank difference, not just today's single-term tasks.
- **Requirements.** R4.
- **Files.** [eval/fixture.ts](eval/fixture.ts), [eval/tasks.json](eval/tasks.json), [test/eval-fixture.test.ts](test/eval-fixture.test.ts).
- **Approach.**
  1. Add one fixture scenario where the natural alternative term an agent would guess for a disjunctive query does *not* match the correct element, but a required term still does.
  2. Add one fixture scenario with enough decoy elements sharing the required term that an unpromoted correct match risks landing outside the default response window — `ea_search`'s default `limit` is 25, so this scenario needs at least ~30 decoy elements sharing the required term, so rank's promotion (or filter's narrowing) has room to matter.
  3. Use vocabulary disjoint from existing eval assertions, per the origin plan's own R18 discipline.
- **Test scenarios.** `test/eval-fixture.test.ts` confirms the new fixture rows exist in the shape the new tasks assume.
- **Verification.** `npm run build` then `npm run eval:run`.

### U3. Measurement campaign, both arms

- **Goal.** Decide with evidence, not argument, following the origin plan's own KD9/KTD8 discipline.
- **Requirements.** R5.
- **Files.** [eval/agent-runner.ts](eval/agent-runner.ts) (the `McpConfigOptions.env` addition below is a prerequisite to running the campaign; nothing else is committed except the recorded finding).
- **Approach.** Run `eval/agent-campaign.ts` against the same built dist, once per env value, on the U2 tasks (plus any existing task that already exercises disjunctive reasoning, if one does). Start with `claude-sonnet-5` only (single-column start, widening only on disagreement — the same discipline the origin plan calls KTD8), n=3 to start, not n=10. The origin plan's own U9 measurement needed n=10 because it was chasing a *small* tool-call-count delta comparable to the noise floor (n=3 there was ambiguous and even flipped sign on repeat). This spike's primary signal is different in kind — a qualitative recovery classification (Correct/Suboptimal/Misled, below) on the same scenario across both arms, closer to the `ea_get_scenarios` rule-lookup fix's verification (0/3 → 3/3, a large enough margin that n=3 alone was conclusive). **Escalate to n=10 only if any of these hold:** the recovery classification is not unanimous across the 3 reps within one arm (e.g., 2 Correct + 1 Suboptimal); the paired-correctness count disagrees across reps within one arm; or the tool-call-count median reverses sign on a repeat run of the same arm. Grade with the existing paired-correctness discipline (KD9) *and* the new divergence signal from KD3: for the wrong-guess scenario specifically, read the raw transcript on both arms and classify the agent's recovery as **Correct** (retries with a different term, or falls back to `ea_get_element`), **Suboptimal** (accepts an imperfect result despite thin evidence), or **Misled** (commits to a wrong answer with unwarranted confidence).

  **Harness gap to close first:** `eval/agent-runner.ts`'s `buildMcpConfig`/`McpConfigOptions` (as of this plan's writing) has no `env` field — it cannot set `EA_SEARCH_ANYOF_MODE` per arm today. Extend `McpConfigOptions` with an optional `env?: Record<string, string>` and pass it through to the generated `mcpServers` entry before running the campaign; this keeps KD1's one-build-one-toggle design intact rather than reverting to two dist trees. Before the full campaign, run one throwaway task against each arm and confirm (via a direct tool call, or by reading the response for a value that differs by mode) that the server actually read the intended `EA_SEARCH_ANYOF_MODE` — the Copilot CLI's handling of an `env` block in `--additional-mcp-config` has not been exercised by this harness before and is worth a cheap sanity check before spending the real campaign budget on it.
- **Test scenarios.** Not a code unit — output is a recorded comparison.
- **Verification.** The recorded finding names, per arm: correctness, tool-call count, and the qualitative recovery behaviour on the wrong-guess scenario.

### U4. Record decision, delete spike branch

- **Goal.** Unblock Stage 3 planning and leave `main` untouched by the experiment.
- **Requirements.** R6.
- **Files.** [docs/plans/2026-08-30-001-feat-multi-term-search-plan.md](docs/plans/2026-08-30-001-feat-multi-term-search-plan.md).
- **Approach.** Replace the origin plan's blocking bullet ("Whether the second list filters or ranks") with the measured decision and a one-paragraph rationale citing U3's finding. Delete the spike branch — the experimental `anyOf` parameter and its env toggle never reach `main`; Stage 3, once planned, implements the decided semantics directly in the real, breaking `query`-as-list shape. Note, for whoever plans Stage 3, that a caller-facing `matchMode` parameter (default = this spike's winning mode, with the other mode available as an explicit opt-in) was considered and deliberately not measured here: it answers a different, cheaper question — can an explicitly-instructed agent invoke an optional parameter correctly — not the autonomous-choice question a third campaign arm would have tested, and not something this spike needs resolved to pick Stage 3's default.
- **Verification.** The origin plan's Stage 3 stop condition ("planning Stage 3... depends on an open question") is cleared, and Stage 3 can be planned as its own `ce-plan` run.

---

## Verification Summary

U1's test scenarios exist as tests and fail without the change; `npm test` on the spike branch covers it. U2 is covered by `test/eval-fixture.test.ts` plus `npm run eval:run`. U3's output is a recorded comparison, not a test suite. U4's output is an edit to the origin plan.

No release is implied anywhere in this plan — the spike branch is deleted after U4, and Stage 3's own eventual release is planned and released separately.
