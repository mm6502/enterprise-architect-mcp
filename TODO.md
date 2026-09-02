# TODO

- Document solution
- Write user documentation
- Think of deployment of the MCP (like ADO compiled /dist, or package and publish?)

## Found 2026-09-02, out of scope for the multi-term-search plan

- Root-caused 2026-09-02 (was: model-specific bug, undiagnosed). On eval task B4, `claude-sonnet-5`
  scores 0/10 in BOTH the Stage-1-only and Stage-1+2 builds, falsely claiming `PRAV_OBS_8501`
  "isn't modeled as an element." Traced via 3 full raw-transcript captures
  (`.campaign-tmp/raw-b4-rep{1,2,3}.jsonl`, since deleted — reproducible with `eval/agent-runner.ts`'s
  `runAgentTask`, whose `raw` return value `agent-campaign.ts` normally discards): in all 3 reps,
  claude correctly calls `ea_get_scenarios({elementId:101})` on the REAL `UC_OBS_4101` and sees the
  step text naming `PRAV_OBS_8501` — but it never once calls `ea_get_element({elementId:101})`,
  the one call that returns that element's `constraints` array where the rule's text actually
  lives. Instead it treats the code as an independently-resolvable entity: `ea_resolve("PRAV_OBS_8501")`,
  `ea_search("PRAV_OBS_8501")`, `ea_search("PRAV_OBS")`, `ea_search("pravidlo")` — all dead ends,
  since constraints aren't independently searchable/resolvable by code, only reachable via
  `ea_get_element` on their owning element. A real, build-independent mental-model gap, not a
  decoy/disambiguation issue (claude does reach the real element 101, just via the wrong tool)
  and not a reasoning-effort issue. Likely the same root cause behind `gpt-5-mini`'s identical
  "supplier registry" fabrication on B1 — same dead-end shape, not separately confirmed.

  **Fixed and verified 2026-09-02.** Added one sentence to `ea_get_scenarios`'s description
  (`src/tools/scenarios.ts`): a step's `uses` may name a rule by code, and that code is not
  independently searchable — look it up via `ea_get_element` on the same elementId instead.
  Rebuilt, reran the same 3 B4 reps for `claude-sonnet-5`: **3/3 now correct** (up from 0/10
  before the fix), all three calling `ea_get_element(101)` and correctly stating the rule text.
  One transcript explicitly credited the new description: *"PRAV_OBS_8501 is a constraint
  embedded in UC_4101, not a separate searchable element (as the tool description warned)."`
  `npm test` still 338/338. Not re-run as a full campaign (n=3 spot-check only, per the same
  noise-floor caveat as U9's own measurement — treat as a strong signal, not a proven rate).

  **Confirmed to generalize, same day.** Reran B1 with `gpt-5-mini` (the model that fabricated
  the "supplier registry" rule earlier) against the fixed build: **3/3 correct**, up from its
  earlier hallucination. Its `ea_resolve("UC_OBS_4101")` still lands on the decoy (id 103) as
  expected, but it now recovers by calling `ea_get_element(101)` afterward instead of fabricating
  from the decoy's alternate-path text. Confirms the root cause and the fix are general, not
  claude-specific.

- Bug: `ea_get_element`'s `attributes[].notes`, `operations[].notes` and
  `operations[].parameters[].notes` return raw, undecoded HTML entities (e.g. literal `&#225;`
  instead of `á`) — `src/tools/elements.ts` builds these from `a.Notes`/`op.Notes`/`p.Notes`
  directly, unlike `constraints[].notes` and the element's own `Note` a few lines below, which
  both call `decodeEntities`. Contradicts the server description's unconditional claim that
  "Character entities... are decoded to characters" (`src/index.ts`). Three call sites to fix.
- Feature idea: no direct "generalization / children of class X" query — an agent reconstructing
  a class hierarchy today has to infer it by walking diagrams.
- Feature idea: no direct "list constraint/enum values for attribute X" query — codelist/enum
  values (e.g. a coded-type family like CP/NP/GR) have to be assembled by hand from notes spread
  across multiple search results.
- Doc gap: `ea_get_diagram_elements`'s description doesn't mention that free-text `Note`/`Text`
  diagram objects (`Object_Type === "Note"`) are already returned and are often where legends
  and abbreviation definitions live — the data comes back correctly, but an agent has no reason
  to look there unless told.

