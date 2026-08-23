---
title: "MCP tool design: inline child data with smart truncation signaling"
date: 2026-06-30
category: design-patterns
module: tools
problem_type: design_pattern
component: mcp-tool-design
severity: medium
applies_when:
  - Designing MCP tools that return parent-child data (element + attributes, user + roles)
  - AI agents are the primary consumers and round-trip reduction matters
  - Child data is typically small but can occasionally be large
  - You need to signal data availability without overwhelming responses
tags:
  - mcp
  - tool-design
  - ai-agent-ux
  - truncation
  - round-trips
---

# MCP tool design: inline child data with smart truncation signaling

## Context

When designing MCP tools for AI agent consumption, a key decision is whether to expose parent-child data as separate tools (granular, requires multiple round-trips) or inline in a single tool response (fewer calls, potentially large responses).

In the enterprise-architect-mcp server, the `ea_get_element` tool needed to return element details along with its class attributes and operations. The EA model averages ~1.1 attributes per element, but some classes have 100+ attributes. The primary agent flow is `search → get detail → get connectors` — every additional round-trip adds latency and context consumption.

## Guidance

**Inline child data by default with a hard truncation cap and explicit signaling fields.** This eliminates round-trips for the 95% case while protecting against oversized responses.

Pattern:

```typescript
const MAX_INLINE_ITEMS = 50;

// Fetch all children
const allAttributes = db.prepare(`...`).all(elementId);

// Truncate with signal
const attributesTruncated = allAttributes.length > MAX_INLINE_ITEMS;
const attributes = allAttributes.slice(0, MAX_INLINE_ITEMS).map(/* ... */);

// Return with metadata
return {
  // ...parent fields...
  attributes,
  attributesTruncated,
  attributesTotal: allAttributes.length,
  operations,
  operationsTruncated,
  operationsTotal: allOperations.length,
};
```

Key design principles:

1. **Cap at a fixed limit** (50 items works well) — small enough to fit agent context, large enough for most real data
2. **Always include `*Truncated` boolean** — agents can branch on this to request more detail
3. **Always include `*Total` count** — agents know how much they're missing
4. **Sort by position/importance** before truncating — the most relevant items come first

## Why This Matters

AI agents pay for every round-trip in latency, token consumption, and context window space. A tool that requires 3 calls to assemble one conceptual entity (`get_element` + `get_attributes` + `get_operations`) wastes ~2/3 of those resources when the typical element has <5 children. The truncation signal preserves the ability to paginate in rare cases.

## When to Apply

- Parent-child relationships where children are typically few (<50) but can occasionally be many
- AI agent-facing MCP tools (not human-facing APIs where pagination is standard)
- Read-only data where the full child list is not needed for most decisions

Do NOT apply when:

- Children are always numerous (use pagination tools instead)
- Children are large blobs (return IDs only, let agent request individually)
- The relationship is N:M and context-dependent (use separate filtered tool)

## Examples

Response when under the cap (typical case — zero extra calls needed):

```json
{
  "id": 1961, "name": "Založenie zmluvy", "type": "UseCase",
  "attributes": [{"name": "status", "type": "String"}],
  "attributesTruncated": false,
  "attributesTotal": 1
}
```

Response when over the cap (agent knows to request more if needed):

```json
{
  "id": 5432, "name": "Person", "type": "Class",
  "attributes": [/* first 50 */],
  "attributesTruncated": true,
  "attributesTotal": 127
}
```
