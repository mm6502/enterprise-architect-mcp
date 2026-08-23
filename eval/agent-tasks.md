# Agent Eval Tasks

Structured analytical tasks for manual subagent dispatch. Each task simulates a real analyst
question. Every required fact below is verifiable through the `ea_*` tools against the synthetic
eval model — no private export is involved.

## Standing the model up

The eval model is built from `eval/fixture.ts` into a temporary directory. To dispatch these
tasks by hand:

```powershell
npm run build
npm run eval:model
```

Point the server at the printed path (`node dist/index.js <path>`) and give the subagent the
`ea_*` tools. The directory is a temp artifact — delete it when finished.

The model is a small Slovak-language contract-administration model: use cases, screens, domain
classes, an application layer, and a code-list package. It deliberately contains duplicate names
across packages, entity-encoded notes, feature-linked connectors, an over-long attribute list,
and two diagrams that share a name — the shapes these tasks probe.

Score against the rubric on each task.

---

## Task A1 — Attribute-level mapping through feature links

**Question:** "Screen `OBR_OBS_5201: Detail zmluvy` maps its fields onto the `Zmluva` entity.
Which entity attribute does the field `poleCisloZmluvy` fill?"

**Expected key facts:**

- [REQUIRED] The target attribute is `cisloZmluvy` on `Zmluva`
- [REQUIRED] The answer names the connector that carries the mapping, not just the two elements
- [BONUS] The mapping is visible only via connector feature links (`StyleEx` LFSP/LFEP)
- [BONUS] Agent used `ea_search` or `ea_resolve` to find the screen, then `ea_get_connectors`

**Scoring:** Required facts = 1 point each. Bonus = 0.5 each. Max: 3.

---

## Task A2 — Use case step with constraint

**Question:** "What does step 2 of use case `UC_OBS_4101: Založenie zmluvy` say, and what
business rules apply to this use case?"

**Expected key facts:**

- [REQUIRED] Step 2 states that the system verifies rule `PRAV_OBS_8501`
- [REQUIRED] The Process constraint `PRAV_OBS_8501` is returned, with its text about the
  effective date not preceding the creation date
- [REQUIRED] The Pre-condition `Používateľ má rolu Správca zmlúv` is returned
- [BONUS] Agent used `ea_get_scenarios` for the step and `ea_get_element` for the constraints —
  the two live in different tools

**Scoring:** Required = 1pt each. Bonus = 0.5. Max: 3.5.

---

## Task A5 — Discovery without a GUID

**Question:** "I need to see the diagram that shows `Zmluva`. I only have the name — find it."

**Expected key facts:**

- [REQUIRED] Agent identifies `DG_OBS_7402: Doménový model zmluvy` as the diagram
- [REQUIRED] Agent retrieves the diagram contents — elements and connectors
- [BONUS] Agent used `ea_search` → `ea_get_element` (whose `diagrams` array carries the answer)
  → `ea_get_diagram_elements`, rather than guessing a diagram id
- [BONUS] Agent notices the association to `Dodávateľ` is present even though no explicit link
  row places it on the diagram

**Scoring:** Required = 1pt each. Bonus = 0.5. Max: 3.

---

## Task A6 — Search across encodings

**Question:** "Find every element whose specification mentions `záväzok`."

**Expected key facts:**

- [REQUIRED] Search returns `ÚČTOVNÁ JEDNOTKA`, whose note stores the term entity-encoded
- [REQUIRED] Agent reports the match came from the note, not the name
- [BONUS] Searching `zavazok` without diacritics returns the same element

**Scoring:** Required = 1pt each. Bonus = 0.5. Max: 2.5.

---

## Task A9 — Disambiguation

**Question:** "I need the element named `Dodávateľ` — which one is it?"

**Expected key facts:**

- [REQUIRED] Agent reports that two elements carry this name
- [REQUIRED] Each candidate is distinguished by its package path — `Doménový model` versus
  `Aplikačná architektúra`
- [BONUS] Agent used `ea_resolve`, reported `totalMatched` of 2, and asked which one was meant
  instead of silently picking one

**Scoring:** Required = 1pt each. Bonus = 0.5. Max: 2.5.

---

## Task A12 — Discover an unknown column

**Question:** "Does `t_connector` have any column that stores style information? What columns
does it have?"

**Expected key facts:**

- [REQUIRED] Agent uses `ea_get_schema` with the table name to list the columns
- [REQUIRED] `StyleEx` is identified
- [BONUS] Agent explains that `StyleEx` carries the feature link data (LFSP/LFEP) behind
  `sourceFeature` and `targetFeature`

**Scoring:** Required = 1pt each. Bonus = 0.5. Max: 2.5.

---

## Task B1 — Cross-reference from step to constraint

**Question:** "A step of `UC_OBS_4101` references a rule by code. Find the rule text and explain
what it requires."

**Expected key facts:**

- [REQUIRED] Agent finds the step whose `uses` attribute is `PRAV_OBS_8501`
- [REQUIRED] Agent retrieves the constraint of that name via `ea_get_element` on the use case
- [REQUIRED] The constraint text comes back decoded, with no raw `&#NNN;` entities

**Scoring:** Required = 1pt each. Max: 3.

---

## Task B2 — Schema exploration for data that may not exist

**Question:** "I heard the model has glossary terms. Can you find them? What table holds them?"

**Expected key facts:**

- [REQUIRED] Agent uses `ea_get_schema` with no arguments to see what tables exist
- [REQUIRED] Agent reports that no glossary table is present, rather than inventing one or
  reading an empty result as an answer
- [BONUS] Agent cites the table list it based the conclusion on

**Scoring:** Required = 1pt each. Bonus = 0.5. Max: 2.5.

---

## Task B3 — Model provenance

**Question:** "Which model export is the server reading? Where did that path come from?"

**Expected key facts:**

- [REQUIRED] Agent uses `ea_get_model_info`
- [REQUIRED] Reports the file name, size, and modification time
- [BONUS] Reports that the path came from the command line, and that any other configured
  candidates were shadowed — the `configuration` block, not just the file name

**Scoring:** Required = 1pt each. Bonus = 0.5. Max: 2.5.

---

## Task B4 — End-to-end investigation

**Question:** "We have a defect on screen `OBR_OBS_5201: Detail zmluvy` — the contract status
field behaves wrongly. Find the specification: which use cases, attributes, and business rules
define this screen's behaviour?"

**Expected key facts:**

- [REQUIRED] Agent finds the screen and its connectors
- [REQUIRED] Agent follows the feature link from `poleStavZmluvy` to `stavZmluvy` on `Zmluva`
- [REQUIRED] Agent reaches `UC_OBS_4101` through the association on `Zmluva` and reports its
  constraints, including `PRAV_OBS_8501`
- [BONUS] Agent notes that `stavZmluvy` defaults to `Návrh` and that a code list
  (`Číselník stavov zmluvy`) governs its values
- [BONUS] Agent presents a coherent chain — screen field → entity attribute → use case →
  rule — rather than a flat list of tool outputs

**Scoring:** Required = 1pt each. Bonus = 0.5. Max: 4.

---

## Task B5 — Reading a truncated list honestly

**Question:** "How many fee items does `Sadzobník poplatkov` define? List them."

**Expected key facts:**

- [REQUIRED] Agent reports 60 items, taken from `attributesTotal`
- [REQUIRED] Agent notices `attributesTruncated` and does not present the 50 returned as the
  whole set
- [BONUS] Agent says explicitly which items it has not seen, instead of implying full coverage

**Scoring:** Required = 1pt each. Bonus = 0.5. Max: 2.5.
