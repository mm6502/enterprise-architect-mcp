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

