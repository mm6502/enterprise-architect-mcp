# Agent Eval Tasks

Structured analytical tasks for manual subagent dispatch. Each task simulates either a real
analyst question or a server- and schema-introspection question an analyst asks about the tooling
itself. Every required fact below is verifiable through the `ea_*` tools against the synthetic
eval model — no private export is involved.

## Standing the model up

The eval model is built from `eval/fixture.ts` into a temporary directory. Nothing is ever
generated from a real `.qea`: `fixture.ts` creates a SQLite file, applies the `EA_SCHEMA` DDL
from `test/helpers/ea-schema.ts` — the same schema the unit fixture uses, so the two can only
differ in data — and inserts every row by hand. Its file header explains which shape each row
group exists to probe. To dispatch these tasks by hand:

```powershell
npm run build
npm run eval:model
```

`eval:model` prints the path of the built `.qea`. Unlike `npm run eval:run`, it does **not**
clean up after itself — the agent needs the file to stay put while the tasks run.

Then point an MCP client at that path and give the agent the `ea_*` tools:

- **Any MCP client:** run the server as `node dist/index.js <printed-path>`. A path given on the
  command line outranks `EA_QEA_PATH` in `.env`, so a configured private export is shadowed, not
  a conflict.
- **This repo in VS Code:** `.vscode/mcp.json` starts the server with no path argument, which
  makes it open whatever `.env` points at — a real export, not the eval model. Add the printed
  path as a second entry in `args`:

  ```jsonc
  "args": ["${workspaceFolder}/dist/index.js", "C:\\...\\ea-eval-XXXXXX\\eval-model.qea"]
  ```

  Saving the file restarts the server on its own; the `mcp.restartServer` command is not needed
  and fails when called directly.

**Confirm which model is open before scoring anything.** Call `ea_get_model_info`: `fileName`
must be `eval-model.qea` and `configuration.sourceId` must be `argument`. Every task below is
scored against fixture data, so a run against a real export scores noise.

When finished, revert the `args` edit (otherwise the server stays pinned to a temp path that is
about to disappear) and delete the temp directory that contains the printed `.qea` file.

The model is a small Slovak-language contract-administration model: use cases, screens, domain
classes, an application layer, and a code-list package. It deliberately contains duplicate names
across packages, entity-encoded notes, feature-linked connectors, an over-long attribute list,
and a scenario step that cites a rule whose text lives only in the element's constraints — the
shapes these tasks probe.

Score against the rubric on each task. Scoring requires the agent's full tool-call transcript,
not just its final answer: many facts below score which tools were selected, in what order, and
whether the agent noticed a truncation or shadowing flag.

`eval/tasks.json` and this file cover different ground. The automated suite owns single-call
assertions about tool output — given these arguments, this response. This rubric owns what the
automated suite cannot assert: which tool the agent reaches for, how it chains calls when one
response does not hold the answer, and whether it reports its findings honestly. A new task
belongs here only if it needs more than one call, if it scores which tool the agent reaches for,
or if it scores the agent's reporting rather than the server's response.

Task ids are stable identifiers retained from a larger draft set. The gaps in the A series are
deliberate, and the ids do not correspond to the case names in `eval/tasks.json`. A tasks ask a
single targeted question, even when answering it takes more than one call; B tasks either run a
multi-step investigation or score how honestly the agent reports a partial, empty, or provenance
result.

---

## Task A1 — Attribute-level mapping through feature links

**Question:** "Screen `OBR_OBS_5201: Detail zmluvy` maps its fields onto the `Zmluva` entity.
Which entity attribute does the field `poleCisloZmluvy` fill?"

**Expected key facts:**

- [REQUIRED] The target attribute is `cisloZmluvy` on `Zmluva`
- [REQUIRED] The answer identifies the carrying connector by its `id` — these mapping connectors
  are unnamed and three Realisations join the same two elements, so neither the type nor the
  endpoints single one out
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

- [REQUIRED] Agent reports the matching element and cites `matchedIn` to show the hit came from
  the note rather than the name
- [REQUIRED] Agent reports `totalMatched` and `truncated` instead of presenting the returned rows
  as self-evidently the whole set
- [BONUS] Agent checks the diacritics-folded form `zavazok` and reports that it resolves to the
  same element

**Scoring:** Required = 1pt each. Bonus = 0.5. Max: 2.5.

---

## Task A9 — Disambiguation

**Question:** "I need the element named `Dodávateľ` — which one is it?"

**Expected key facts:**

- [REQUIRED] Agent reports that two elements carry this name
- [REQUIRED] Agent asks which one was meant instead of silently picking one
- [BONUS] Agent used `ea_resolve`, reported `totalMatched` of 2, and distinguished the candidates
  by package path — `Doménový model` versus `Aplikačná architektúra`

**Scoring:** Required = 1pt each. Bonus = 0.5. Max: 2.5.

---

## Task A12 — Discover an unknown column

**Question:** "Does `t_connector` have any column that stores style information? What columns
does it have?"

This is a schema-introspection task, not an analyst question — it scores whether the agent
discovers an unfamiliar column instead of assuming the tool surface is the whole model.

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

- [REQUIRED] Agent lands on `UC_OBS_4101: Založenie zmluvy` (Object_ID 101), not the decoy
  element named exactly `UC_OBS_4101` (Object_ID 103) that `ea_resolve` returns alone under
  exact-beats-prefix
- [REQUIRED] If the first lookup yields no scenarios and no constraints, the agent treats that as
  an unresolved reference and widens with `ea_search` — never as the answer
- [REQUIRED] Agent finds the step whose `uses` attribute is `PRAV_OBS_8501`
- [REQUIRED] Agent retrieves the constraint of that name via `ea_get_element` on the use case

**Scoring:** Required = 1pt each. Max: 4.

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

This is a server-introspection task, not an analyst question. Note that the scorer has already
called `ea_get_model_info` during setup, so the facts are known-true going in — what is scored is
whether the agent reads the `configuration` block instead of stopping at the file name.

**Expected key facts:**

- [REQUIRED] Agent uses `ea_get_model_info`
- [REQUIRED] Reports the file name, size, and modification time
- [BONUS] Reports `configuration.sourceId` as `argument`, and reports the `shadowed` candidates if
  any — a correctly reported empty `shadowed` earns the point too, since it is populated only when
  `.env` or `EA_QEA_PATH` also names a path

**Scoring:** Required = 1pt each. Bonus = 0.5. Max: 2.5.

---

## Task B4 — End-to-end investigation

**Question:** "We have a defect on screen `OBR_OBS_5201: Detail zmluvy` — the contract status
field behaves wrongly. Find the specification: which use cases, attributes, and business rules
define this screen's behaviour?"

**Expected key facts:**

- [REQUIRED] Agent finds the screen and its connectors
- [REQUIRED] Agent follows the feature link from `poleStavZmluvy` to `stavZmluvy` on `Zmluva`
- [REQUIRED] Agent reaches `UC_OBS_4101: Založenie zmluvy` through the association on `Zmluva`
  and reports its constraints, including `PRAV_OBS_8501`
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
