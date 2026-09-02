---
title: Fix Known Tool Bugs and Discoverability Gaps - Plan
type: fix
date: 2026-09-02
topic: known-bugs-and-gaps
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Fix Known Tool Bugs and Discoverability Gaps - Plan

## Goal Capsule

- **Objective:** Close the four items recorded in [TODO.md](TODO.md) under "Found 2026-09-02, out of scope for the multi-term-search plan" — two are real, fixable bugs; two are discoverability/feature gaps of very different maturity.
- **Product authority:** This plan owns `ea_get_element`'s notes-decoding, `ea_get_diagram_elements`'s and `ea_get_connectors`' descriptions, and the investigation of enum/codelist representation. It does not touch `ea_search`, whose behaviour is owned by [docs/plans/2026-08-30-001-feat-multi-term-search-plan.md](docs/plans/2026-08-30-001-feat-multi-term-search-plan.md).
- **Execution profile:** Four independent units. U1 and U2 are direct code/doc fixes with no open design question. U3 follows the same "fix behaviour via description" pattern already validated this session on `ea_get_scenarios`, plus one small response addition. U4 is split into a discovery spike (U4a) and a conditionally-scoped follow-up (U4b) — its shape cannot be designed responsibly without first confirming how the real model represents enumerations, which is not yet known.
- **Stop conditions:** Do not design U4b's tool shape before U4a's spike reports a finding. Any spike step that touches the real production export follows the same confidentiality rule already established this session: only aggregate/structural findings (table names, stereotype values, counts) may reach committed artifacts — never real element names, note text, or business content, and never the client's identity.
- **Open blockers:** None for U1–U3. U4b is blocked on U4a's outcome by design, not an oversight.

---

## Product Contract

### Summary

Four small, independent fixes. `ea_get_element`'s attribute/operation/parameter notes are decoded like every other notes field already is (U1). `ea_get_diagram_elements`'s description is corrected to say what it already returns (U2). `ea_get_connectors`' description and response gain enough to answer "what are the children/parent of class X" without walking diagrams, mirroring the connector data that already exists (U3). Whether a dedicated enum/codelist lookup tool is buildable at all is investigated before it is designed (U4).

### Problem Frame

Four items surfaced during the multi-term-search work and measurement campaign, recorded in [TODO.md](TODO.md) but explicitly out of that plan's scope:

1. **Entity-decoding bug.** `ea_get_element`'s `attributes[].notes`, `operations[].notes`, and `operations[].parameters[].notes` return raw HTML entities (`&#225;` instead of `á`). The element's own `Note` and its `constraints[].notes` already call `decodeEntities` a few lines away in the same file — these three call sites were simply missed. The server's own instructions (`src/index.ts`) claim unconditionally that "Character entities... are decoded to characters," so this is a broken promise, not an undocumented gap.
2. **Diagram doc gap.** `ea_get_diagram_elements` already returns `Object_Type === "Note"` diagram objects (free-text `Note`/`Text` boxes) inside `elements` — the data is correct. Its description never says so, and free-text notes are often exactly where a diagram's legend or abbreviation definitions live. An agent has no reason to look there unless told.
3. **Generalization/hierarchy discoverability.** Finding the subclasses ("children") or superclasses ("parent") of a class today requires knowing to call `ea_get_connectors` with `connectorType: "Generalization"` and reasoning correctly about which end (`source`/`dest`) is the specific type and which is the general one. Nothing states that convention, so the TODO records agents falling back to walking diagrams by hand — the data has always been retrievable via the existing connector table; only the direction contract is undocumented.
4. **Enum/codelist value lookup.** The TODO records that codelist/enum values (e.g. a coded-type family like ALPHA/BETA/GAMMA) have to be assembled by hand from notes spread across multiple search results. Unlike (1)–(3), there is no confirmed answer yet for *how* EA represents such a value set in this project's models — UML's own convention (a `Class` stereotyped `enumeration` with attributes as literals) is one candidate, but a free-text note convention (a coded-type family documented as prose inside one attribute's `Notes`) is equally plausible and was the shape implied by the original observation. Designing a lookup tool before confirming which shape is real risks building the wrong abstraction.

### Key Decisions

- KD1. **Fix the entity-decoding bug in place — wrap the three missed call sites with the existing `decodeEntities`, no broader refactor.** The element's own `Note` and `constraints[].notes` already establish the pattern a few lines away; the fix is symmetry, not new design.
- KD2. **Prefer a description/response fix over a new tool when the underlying data is already retrievable through an existing tool and filter.** This is the same "one sentence" pattern that fixed the `ea_get_scenarios` rule-lookup bug this session (0/10 → 3/3 on the affected eval task, confirmed to generalize across two models) — applied here to `ea_get_connectors`' Generalization direction. Governs U3.
- KD3. **Do not design or build the enum/codelist tool before confirming the underlying representation.** Confirm it the same confidentiality-safe way Stage 2's narrowing benefit was confirmed against a real production export: a direct MCP SDK client connection (no AI agent, zero premium-request cost), reporting only aggregate/structural findings. If no single consistent representation is found, that is itself the answer for this pass — the tool is deferred, not guessed at. Governs U4a/U4b.

### Requirements

- R1. `ea_get_element`'s `attributes[].notes`, `operations[].notes`, and `operations[].parameters[].notes` return entity-decoded text, matching the element's own `Note` and `constraints[].notes`.
- R2. `ea_get_diagram_elements`'s description states that `Note`/`Text` diagram objects are included in `elements` and commonly carry legends or abbreviation definitions.
- R3. `ea_get_connectors`' description states, for `Connector_Type: "Generalization"`, which end (`source`/`dest`) is the specific (child) type and which is the general (parent) type, and how to combine `connectorType`/`direction` to list an element's direct children or direct parent(s) without a diagram. A `Generalization` connector's response entry names this role directly (not only through the description), so an agent reading one result already has the answer.
- R4. Before any enum/codelist tool is designed, confirm — via a non-agent, direct-DB spike against a real production export — whether enumerations/codelists follow a single identifiable representation (e.g. a stereotyped `Class`, a recurring `Notes` prose pattern, or something else) prevalent enough to build a general tool against. Only aggregate/structural findings (table/column names, stereotype value, counts) may reach any committed artifact.

### Outstanding Questions

- U4b's tool shape (or the decision not to build it) is not resolved by this plan — it is explicitly deferred to U4a's finding, per KD3.

---

## Implementation Units

| Unit | Title | Key files | Depends on |
|---|---|---|---|
| U1 | Decode entities in element notes | [src/tools/elements.ts](src/tools/elements.ts), [test/tools.test.ts](test/tools.test.ts) | — |
| U2 | Document diagram Note/Text objects | [src/tools/diagrams.ts](src/tools/diagrams.ts), [README.md](README.md) | — |
| U3 | Generalization direction discoverability | [src/tools/connectors.ts](src/tools/connectors.ts), [README.md](README.md), [test/tools.test.ts](test/tools.test.ts) | — |
| U4a | Enum/codelist representation spike | none committed except findings | — |
| U4b | Enum/codelist lookup tool (conditional) | TBD, decided by U4a | U4a |

U1–U3 are independent of each other and can be implemented and merged in any order or together. U4a is a research step, not a code change; U4b does not exist as a scoped unit until U4a reports.

### U1. Decode entities in element notes

- **Goal.** Close the broken promise that all EA text fields are entity-decoded.
- **Requirements.** R1.
- **Files.** [src/tools/elements.ts](src/tools/elements.ts), [test/tools.test.ts](test/tools.test.ts), [test/helpers/test-db.ts](test/helpers/test-db.ts) (fixture rows carrying an entity, if none already do).
- **Approach.** In `ea_get_element`, wrap `a.Notes` (attribute), `op.Notes` (operation), and `p.Notes` (operation parameter) with `decodeEntities` at the three `map()` call sites that build `attributes`, `operations`, and each operation's `parameters` — the same call already used for `element.Note` and `constraints[].notes` a few lines above and below.
- **Test scenarios.** An attribute with an entity in `Notes` returns the decoded character. An operation with an entity in `Notes` returns the decoded character. An operation parameter with an entity in `Notes` returns the decoded character. A `null` notes value still returns `null` (no crash on the added call).
- **Verification.** `npm test`.

### U2. Document diagram Note/Text objects

- **Goal.** An agent knows to look at diagram `Note`/`Text` objects for legends and abbreviations, since the data is already there.
- **Requirements.** R2.
- **Files.** [src/tools/diagrams.ts](src/tools/diagrams.ts), [README.md](README.md).
- **Approach.** Add one sentence to `ea_get_diagram_elements`'s description stating that `elements` includes free-text `Note`/`Text` diagram objects (`Object_Type === "Note"`), which often carry legends or abbreviation definitions. Update the corresponding README row to match.
- **Test scenarios.** Covered by the existing description-contract test ([test/description-contract.test.ts](test/description-contract.test.ts)) — no new test needed since no response field changes, only the description text.
- **Verification.** `npm test`.

### U3. Generalization direction discoverability

- **Goal.** An agent can list an element's direct children or parent(s) from a single `ea_get_connectors` call, without inferring the `source`/`dest` convention or walking diagrams.
- **Requirements.** R3.
- **Files.** [src/tools/connectors.ts](src/tools/connectors.ts), [README.md](README.md), [test/tools.test.ts](test/tools.test.ts).
- **Approach.**
  1. In `ea_get_connectors`'s response mapping, when `type === "Generalization"`, add a `role` field to `source` and `dest` (`"child"` on `source`, `"parent"` on `dest`) — `Start_Object_ID` is always the specific type and `End_Object_ID` the general one in EA's `t_connector` convention. Leave every other connector type's entries unchanged (no `role` field).
  2. Update the tool description to state the convention explicitly and name the recipe: filter `connectorType: "Generalization"` with `direction: "incoming"` on a class to list its direct children; `direction: "outgoing"` to find its direct parent(s).
  3. Update the README row for `ea_get_connectors` to mention the Generalization convention briefly.
- **Test scenarios.** A `Generalization` connector where the element is the general (parent) end, queried with `direction: "incoming"`, returns entries whose `source.role` is `"child"` and `dest.role` is `"parent"`. The same connector queried with `direction: "outgoing"` from the child's perspective returns the same roles (role is a property of the connector's ends, not of query direction). A non-Generalization connector carries no `role` field. The description-contract test (already covering `ea_get_connectors` via its existing sample call) enforces that `role` is named in the description once a fixture connector of type Generalization exists — add one to [test/helpers/test-db.ts](test/helpers/test-db.ts) if the current fixture has none, so the contract test actually exercises this field.
- **Verification.** `npm test`.

### U4a. Enum/codelist representation spike

- **Goal.** Determine whether enumerations/codelists follow one identifiable representation in real EA models, before any tool is designed against a guess.
- **Requirements.** R4.
- **Files.** None committed — a throwaway script using the direct MCP SDK `Client` + `StdioClientTransport` pattern already established this session (`node dist/index.js <real-export-path>`, same shape as [test/tools.test.ts](test/tools.test.ts)'s in-memory client but pointed at the real `.qea`), run manually and deleted after.
- **Approach.**
  1. Query `t_object` for `Object_Type = 'Enumeration'` or `Stereotype` containing `enumeration`/`codelist`/similar, and check whether such elements exist and whether their attributes read as literal values.
  2. Independently, sample a handful of attributes/classes whose `Notes` contain a recognisable coded-family pattern (e.g. a short all-caps token followed by a dash and prose, repeated across lines) to see whether that convention is common enough to key a tool on.
  3. Record only the aggregate/structural finding — which representation(s) exist, roughly how common each is (counts, not examples), and whether a single tool could plausibly cover it — never the real values, names, or note text themselves, per KD3 and the existing confidentiality rule in `/memories/confidentiality.md`.
- **Test scenarios.** None — this is a research spike, not a code change.
- **Verification.** A written finding (in this plan's revision or in [TODO.md](TODO.md)) that names the representation(s) found and a go/no-go recommendation for U4b.

**Finding, 2026-09-02 (direct MCP client against a real production export, no AI agent, aggregate-only).** Searching the literal word "enumeration" returned 5 elements total, none of them actually typed or stereotyped `Enumeration` — the classic UML "Class stereotyped Enumeration with literal attributes" convention is effectively absent, not just rare. Searching the generic local-language term for "codelist" returned 3229 matches spread across many unrelated object types (ordinary business classes, ArchiMate data objects, events, and more), confirming the TODO's original suspicion: codelist/enum values are not anchored to any single structural EA construct — they live as free-text mentions scattered across whatever element happens to reference them. **Recommendation: no-go on U4b as a general tool.** There is no consistent shape to key a dedicated lookup tool on; building one now would mean guessing a text-parsing heuristic over prose, which risks false positives at real-model scale and is a materially different (larger, riskier) unit than originally scoped. Closing this pass without U4b; revisit only if a future, differently-scoped observation identifies a narrower, tool-worthy pattern.

### U4b. Enum/codelist lookup tool — closed, no-go (2026-09-02)

- **Goal.** If U4a finds a consistent, tool-worthy representation, build a lookup for it.
- **Outcome.** U4a found no consistent representation (see finding above). Per KD3, this unit is closed as no-go rather than built on a guess. Left here for record; not implemented.
- **Requirements.** R4 (continued).
- **Dependencies.** U4a.

---

## Verification Summary

Per unit: U1–U3's test scenarios exist as tests and fail without the change; `npm test` covers all three. U4a's output is a written finding, not a test suite. U4b is unscoped until U4a reports.

No release is implied by this plan on its own — bundle U1–U3 into the next natural release per [docs/solutions/conventions/release-process.md](docs/solutions/conventions/release-process.md) (patch version: all three are bug/doc fixes, no parameter or contract removal).
