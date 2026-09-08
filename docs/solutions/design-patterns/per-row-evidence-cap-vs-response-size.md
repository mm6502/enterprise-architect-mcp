---
title: "Per-result evidence caps bound a row, not the response — limit still scales response size"
date: 2026-09-08
category: design-patterns
module: tools
problem_type: design_pattern
component: mcp-tool-design
severity: medium
applies_when:
  - Designing a windowed/paginated MCP tool where each row can itself carry a bounded evidence bundle (snippets, matches, previews)
  - Tuning a per-row truncation cap and assuming it caps the whole response
  - A caller can pass a large `limit` on a tool searching a large corpus
tags:
  - mcp
  - tool-design
  - windowing
  - response-size
  - ai-agent-ux
---

# Per-result evidence caps bound a row, not the response — limit still scales response size

## Context

`ea_search` caps the evidence carried by each matched element (a small, strongest-first set of
snippets per row) so no single result balloons the response. That cap is necessary but not
sufficient: the response is a **window of rows**, and its total size is (roughly) `limit` times the
per-row bundle size, not a fixed constant. On a small synthetic eval model this never mattered —
few rows ever exist to fill a large `limit`. On a real, production-scale export it does: a real
agent session issued `ea_search` with a generic multi-word conjunction and `limit: 30` against a
large model and got two ~25 KB responses back, large enough that the MCP client itself redirected
them to a temp file and returned only a short inline preview — the agent then had to read the file
back and locally grep the part it actually needed. No response-shape rule was violated; the
per-result evidence budget worked exactly as designed. The size came from `limit` alone.

## Guidance

**A per-row truncation cap and a response-size concern are two different budgets — tune and test
them separately, and test the second one at production scale, not only on a small fixture.**

- The per-row cap (evidence count, snippet width) bounds worst-case row size. It does not bound
  worst-case *response* size, which is approximately `min(limit, totalMatched) × per-row size`.
- A small synthetic eval model under-tests this by construction: if there are only a handful of
  rows that could ever match, no `limit` value can make the response large, regardless of what the
  real-world corpus would do. This is the same instrument gap already recorded for narrowing
  (`packageScope`) and for the conjunction tool-call win itself — a fixture too small to exhibit
  the scale the feature (or the risk) targets.
- The client-side symptom (large tool output silently redirected to a file, only a short preview
  returned inline) is not a server bug and not visible in the server's own response shape — it is
  the calling client's own large-output handling. It still costs the agent a real round-trip (read
  the file back, or grep it locally) that the per-result cap was specifically meant to avoid paying.
- Confirm any change here (a lower default `limit`, a response-size-aware truncation, a warning
  field) against a production-scale corpus, the same way the narrowing feature's own benefit was
  only confirmed once measured directly against a real export rather than the small fixture.

## When to Apply

- Any windowed/paginated tool whose rows carry their own bounded-but-nonzero evidence bundle
  (snippets, previews, nested truncated collections).
- Before trusting a "the response can't be that large, evidence is capped" argument — check what
  `limit` actually multiplies that cap by, and check it against a corpus at real scale.

Do NOT treat this as a reason to shrink the per-row evidence cap — that cap already trades against
follow-up calls per its own measurement (see the match-evidence budget sweep). The two budgets are
independent knobs; conflating them risks under-tuning one to compensate for the other.
