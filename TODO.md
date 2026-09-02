# TODO

- Document solution
- Write user documentation
- Think of deployment of the MCP (like ADO compiled /dist, or package and publish?)

## Found 2026-09-01, out of scope for the multi-term-search plan

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

## Found 2026-09-02, out of scope for the multi-term-search plan

- Model-specific bug (`claude-sonnet-5`), not caused by this plan: on eval task B4, all 10/10
  reps in BOTH the Stage-1-only and Stage-1+2 builds falsely claim the constraint `PRAV_OBS_8501`
  "isn't modeled as an element" — it is, retrievable via `ea_get_element`'s `constraints` array
  on `UC_OBS_4101`. Same failure mode drives most of `claude-sonnet-5`'s B1 failures too (4/10
  correct in both arms), where it infers a fabricated "supplier registry" rule instead. Present
  identically regardless of build, so it's not something Stage 1/2 introduced or can fix.
  `gemini-3.7-flash` never makes this mistake (10/10 on both tasks in the candidate arm).
  Root cause undiagnosed — the current harness (`eval/agent-campaign.ts`) only keeps the final
  answer text and tool-call counts, not the full raw JSONL transcript, so it's not visible
  whether claude calls `ea_get_element` on the wrong target, calls it correctly but ignores the
  `constraints` array, or something else. Needs a repro run capturing full raw output
  (`runAgentTask`'s `raw` return value, currently discarded after parsing) before it can be
  diagnosed further.

