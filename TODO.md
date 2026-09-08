# TODO

- Document solution
- Write user documentation
- Candidate for investigation: `ea_search` response size scales with `limit` even though per-result
  evidence is capped — a large `limit` against a production-scale corpus can produce responses large
  enough to trip an MCP client's own large-output redirect (real session, ~25 KB at `limit: 30`),
  costing the agent a read-back round-trip. Not reproducible on the small eval fixture. See
  docs/solutions/design-patterns/per-row-evidence-cap-vs-response-size.md for the finding and the
  budget distinction. Possible directions: a response-size-aware effective limit, a warning field,
  or a lower documented default — needs measuring against a real export, not the eval fixture.
- Candidate for investigation: support for non-MCP agent harnesses. This server is stdio-MCP-only
  (per its own architecture), which every MCP-compliant client (VS Code, Claude Desktop, `copilot`
  CLI) can reach directly, but at least one harness tried during manual testing (`pi`,
  `@earendil-works/pi-coding-agent`) has no MCP client at all — it uses its own in-process
  TypeScript "extension" mechanism (`pi.registerTool()`) instead. Confirmed by searching its full
  docs/ and examples/ trees for "MCP" — zero matches. Reaching such a harness would need a
  per-harness bridge/adapter (an extension that opens our MCP server as a subprocess and re-exposes
  each tool in the harness's own native registration API), not a server-side change — this repo
  stays a plain MCP server either way. Worth revisiting if other non-MCP harnesses (mentioned:
  Hermes, Mistral's coding-agent CLI) turn out common enough to justify maintaining bridges;
  unconfirmed whether they lack MCP support too — not yet checked.

