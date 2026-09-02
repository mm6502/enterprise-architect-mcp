# TODO

- Document solution
- Write user documentation
- Think of deployment of the MCP (like ADO compiled /dist, or package and publish?)

## Found 2026-09-02, out of scope for the multi-term-search plan

- Model-specific bug (`claude-sonnet-5`), not caused by this plan: on eval task B4, all 10/10
  reps in BOTH the Stage-1-only and Stage-1+2 builds falsely claim the constraint `PRAV_OBS_8501`
  "isn't modeled as an element" — it is, retrievable via `ea_get_element`'s `constraints` array
  on `UC_OBS_4101`. Same failure mode drives most of `claude-sonnet-5`'s B1 failures too (4/10
  correct in both arms), where it infers a fabricated "supplier registry" rule instead. Present
  identically regardless of build, so it's not something Stage 1/2 introduced or can fix.
  `gemini-3.7-flash` never makes this mistake (10/10 on both tasks in the candidate arm).
  `gpt-5-mini` was separately seen making the same "supplier registry" fabrication on B1 (see
  the 2026-09-01 correctness grading in repo memory), so this may not be strictly claude-only —
  worth checking during the investigation below.

  **Investigation plan (cheap, staged, no full campaign needed):**
  1. Capture the FULL raw JSONL transcript (not just tool-call counts — `runAgentTask`'s `raw`
     return value, currently discarded by `agent-campaign.ts` after parsing) for 2-3 repro runs
     of `claude-sonnet-5` on B4. Reuse the `eval/debug-one-run.ts` pattern from 2026-09-01
     (built, used, then deleted — recreate it) to run one task directly and dump the raw output.
  2. From that raw transcript, check the actual `ea_get_element` tool call: what element id was
     it called with (the real `UC_OBS_4101` id 101, or the decoy id 103?), and what did the
     `constraints` array in the tool's *result* actually contain — was `PRAV_OBS_8501` present
     and claude ignored/misread it, or was it genuinely absent because the wrong element was
     queried?
  3. Branch on what's found:
     - **Wrong element queried** (decoy id 103, or `Zmluva` instead of the use case): this is a
       disambiguation/discoverability problem, same family as A9's duplicate-name issue — a
       tool description tweak (e.g. warning about duplicate names) might help, worth a quick
       description wording test.
     - **Right element queried, constraint present in the result, but claude's final answer
       still denies it**: a pure model reasoning failure, unrelated to tool descriptions. Cheap
       follow-up: rerun the same task with `--effort medium`/`high` for claude only (2-3 reps,
       the harness pins `low` for measurement validity per KTD7) — if higher effort fixes it,
       it's an effort artifact of this measurement setup, not a real-usage-blocking bug; if not,
       it's a genuine model limitation to just document, not something this server can fix.
     - **Never called `ea_get_element` on the use case at all**: means it stopped before
       reaching the fact — check what it *did* call instead and why it stopped there.
  4. Report back which branch explains it before deciding whether any server-side change
     (description wording, disambiguation hint) is worth making.

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

