---
title: "Verify a concept's structural representation before building a lookup tool for it"
date: 2026-09-02
category: tooling-decisions
module: tools (feature scoping)
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "A feature idea proposes a dedicated query/lookup tool for \"all instances of concept X\" (e.g. an enum, a codelist, a category)"
  - "X has no confirmed single structural home in the data (not clearly one table, one stereotype, or one recurring pattern)"
  - "Building the tool would otherwise require guessing a free-text heuristic to recognise instances of X"
tags: [feasibility-check, enum, codelist, tooling-scoping, real-data-verification, no-go-decision]
---

# Verify a concept's structural representation before building a lookup tool for it

## Context

Planning a small batch of tool fixes (docs/plans/2026-09-02-001-fix-known-tool-bugs-plan.md) carried forward an open TODO item: no dedicated tool exists to "list enum/codelist values for attribute X" — a friction observed because codelist values (a coded-type family such as ALPHA/BETA/GAMMA) had to be assembled by hand from notes scattered across several search results. Before designing that tool's response shape, a feasibility check asked a prior question: does the concept ("enumeration"/"codelist") actually have one consistent structural representation in a real, production-scale model to key a general tool on?

## Guidance

Before committing to build a feature that answers "list all X", verify — against real data, not the synthetic test fixture — that X has a consistent structural shape to query. Run the cheapest possible check first: a direct, non-agentic client connection (no LLM call, no premium-request cost) executing a handful of candidate queries by hand, reporting only aggregate counts and type/stereotype breakdowns. If the concept turns out to be scattered across many unrelated structural shapes with no unifying pattern, that scattering *is* the answer — it means the tool cannot be built without guessing a heuristic, and no further design time should be spent until a narrower, confirmed pattern is found.

The concrete finding this run produced: searching for the classic modelling convention's own name matched only a handful of elements, and none of them were actually typed or carried that convention's stereotype — the convention was effectively absent, not merely rare. A separate search for the domain's generic local-language term for the concept matched thousands of elements spread across many unrelated object types (ordinary business classes, architecture data objects, events, and more). There was no single structural anchor to build against.

## Why This Matters

A lookup tool built on a guessed free-text heuristic (for example, "a short all-caps token followed by a dash in a notes field") would work on the handful of examples that inspired the idea and then silently misidentify or miss instances everywhere else in a production model with tens of thousands of elements — a worse outcome than having no tool at all, because it fails without an obvious signal. A short, code-free feasibility check catches this before any implementation time is spent. A negative result is just as valuable a business outcome as a positive one here: it closes the idea with reasoning attached, so it is not silently re-proposed and re-investigated from scratch by someone who doesn't know it was already checked.

## When to Apply

- A feature or tool idea is scoped around "list/find all X" for some domain concept, and X's representation in the underlying data has not been confirmed.
- Real production-scale data — not the synthetic test fixture — is available, even briefly, to check against.
- The cost of guessing wrong (building the wrong abstraction, or one that quietly misidentifies instances at scale) is higher than the cost of a short verification pass.

## Examples

**Before:** a TODO item recorded "no direct list constraint/enum values for attribute X query" as an open feature idea, with no confirmation that such values are stored in any one recognisable shape.

**After:** a direct MCP client connection (no AI agent involved) ran two searches against the real production export — one for the structural convention's own name, one for the domain's generic term for the concept — and reported only counts and type/stereotype breakdowns, never real element names or note text (per the aggregate-only rule for real client data). Result: no consistent shape found, so the tool idea was closed as no-go rather than built on a guess, with the reasoning recorded so the question is not reopened without new evidence.

## Related

- docs/plans/2026-09-02-001-fix-known-tool-bugs-plan.md (U4a/U4b — the plan-level record of this same finding)
- docs/solutions/architecture-patterns/ea-model-reading-coverage.md (same discipline applied elsewhere: settle a design question by counting rows in a real export rather than by reasoning about EA in general)
