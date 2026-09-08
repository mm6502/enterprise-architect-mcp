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

