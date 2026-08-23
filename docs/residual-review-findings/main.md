# Residual Review Findings — `main`

Source: `ce-code-review` pass over the uncommitted diff implementing
[docs/plans/2026-08-23-001-feat-result-ordering-and-pagination-plan.md](../plans/2026-08-23-001-feat-result-ordering-and-pagination-plan.md),
run 2026-08-23 against head `d1785ff`. Six of eight findings were applied in the same change.
No tracker sink is configured for this repository and the run was local-only, so the two
deferred findings are recorded verbatim here — this file is their durable record.

## Deferred

- **low** — `src/tools/search.ts` (the `IN (?, ?, …)` fan-out in `ea_search`) — **a broad query can
  exceed SQLite's bound-parameter ceiling.** The matched object IDs are bound one placeholder each,
  and `SQLITE_MAX_VARIABLE_NUMBER` is 32,766. The working export holds ~72,500 objects, so a very
  common substring can match more IDs than SQLite will accept and the tool returns `isError` from
  its catch block rather than a result. This is pre-existing behaviour, unchanged by this work, but
  the new `breakdown` actively invites the broad queries that reach it. *Suggested fix:* chunk the
  ID list into batches of ~10,000 and concatenate, or scan `t_object` once and filter in JS when the
  ID list is large. *Deferred because:* the plan's Scope Boundaries exclude changing the search
  matching mechanism, and this is not a regression introduced here.

- **low** — `src/tools/diagrams.ts` (`ea_list_diagrams`) — **every page re-reads the whole
  `t_diagram` table.** The `ORDER BY Diagram_ID` is correct, but the window is applied in JS because
  `nameContains` folds text, so walking ~10,000 diagrams at `limit: 50` means 200 full scans — plus
  200 rounds of folding over every name when `nameContains` is set. KD2 now declares full traversal
  a supported use, which makes that the endorsed workflow rather than an edge case. *Suggested fix:*
  push `LIMIT ?/OFFSET ?` into SQL on the `nameContains`-absent path, keeping the JS window only
  when folding is required. *Deferred because:* it is a performance concern with no correctness
  impact, and the split-path SQL deserves its own measurement rather than being bolted on here.

## Applied in the same change

Recorded so the review is legible later, not as outstanding work.

1. **high** — `limit` was unvalidated, so `limit: 0` produced a self-referential `continuation` that
   never terminated, and `limit: -1` made SQLite's `LIMIT -1` return every row. Fixed with a shared
   `limitParam` (`.int().min(1)`) and covered by tests at both unit and tool level. This one is the
   reason the review was worth running: the full suite was green when the defect was present.
2. **medium** — `ea_search`'s empty-query branch did not echo `offset`, contradicting the contract
   the server instructions now advertise.
3. **medium** — `breakdown` entered `CONTRACT_FIELDS` with no sample call producing one, so the
   description-contract suite never inspected the new branch. Low-limit sample calls added for all
   three enumeration tools.
4. **medium** — a breakdown axis reports `totalMatched` for its list of distinct values, not for
   rows, which collides with that field's meaning everywhere else. Documented in `src/index.ts`.
5. **low** — the boundary test proving paging stayed out of the whole-set tools covered 3 of 8
   tools; moved into `test/response-contract.test.ts` and driven off `validCalls`.
6. **low** — the unit-level termination walk re-derived the window arithmetic it was testing and so
   could not fail independently; now driven from a real array.

## Note carried forward, not actionable

KTD6 justifies inline per-axis metadata by precedent from `ea_get_diagram_elements`, but that tool
puts collection metadata under `_meta`, not inline. Both shapes are defensible; the plan's stated
rationale simply does not match what shipped.
