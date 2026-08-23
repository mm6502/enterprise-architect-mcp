---
title: "LIKE + CASE relevance ranking as pragmatic alternative to FTS5"
date: 2026-06-30
category: design-patterns
module: tools/search
problem_type: design_pattern
component: search
severity: medium
applies_when:
  - Building search over SQLite datasets of 10K-100K rows
  - Users search by name or description rather than full-text content
  - You want zero indexing infrastructure and instant deployment
  - Relevance ordering matters but does not need to be sophisticated
tags:
  - sqlite
  - search
  - fts5
  - like
  - relevance-ranking
  - pragmatic-patterns
---

# LIKE + CASE relevance ranking as pragmatic alternative to FTS5

## Context

The enterprise-architect-mcp server needed to provide full-text search across tens of thousands of model elements (names, aliases, notes) stored in a multi-hundred-megabyte SQLite database. The options were:

1. **FTS5** — SQLite's full-text search extension with sophisticated ranking (BM25), but requires creating and maintaining a virtual table, syncing content, and understanding tokenizer behavior
2. **Simple LIKE** — zero infrastructure, but unordered results make it hard for agents to find the most relevant match

The insight: for agent workflows, search is primarily by entity name ("find the use case about prisoner release"). Name matches should always rank above note matches. This is a simple priority ordering, not statistical relevance.

## Guidance

Use **LIKE with a CASE-based relevance ORDER BY** when your search targets a small number of well-structured fields with natural priority:

```sql
SELECT o.Object_ID, o.Object_Type, o.Name, o.Alias, o.Stereotype,
       o.Package_ID, p.Name as PackageName, substr(o.Note, 1, 200) as NotePreview
FROM t_object o
LEFT JOIN t_package p ON o.Package_ID = p.Package_ID
WHERE (o.Name LIKE ? OR o.Alias LIKE ? OR o.Note LIKE ?)
ORDER BY
  CASE
    WHEN o.Name LIKE ? THEN 0
    WHEN o.Alias LIKE ? THEN 1
    ELSE 2
  END,
  o.Name
LIMIT ?
```

Parameters: pass `%query%` for each `?` placeholder (6 total for the LIKE + ORDER BY).

Key properties:

1. **Zero infrastructure** — no FTS5 virtual table, no content sync, no re-indexing
2. **Instant deployment** — works on any SQLite file without modification
3. **Deterministic ranking** — name > alias > note, alphabetical within each tier
4. **Parameterized queries** — safe against SQL injection by construction
5. **Case-insensitive** — SQLite LIKE is case-insensitive for ASCII by default

## Why This Matters

FTS5 is powerful but adds complexity: you need to create the virtual table, handle content synchronization, understand tokenizer behavior for non-English text (Slovak diacritics, compound words), and deal with FTS5's rank function quirks. For a read-only MCP server where the database is an external export (you don't control its creation), adding FTS5 means a preprocessing step that transforms the file.

LIKE on 72K rows with modern hardware takes <100ms — fast enough for interactive tool responses. The relevance CASE expression ensures agents see the most useful results first without needing BM25's statistical scoring.

## When to Apply

- Datasets of 10K–100K rows where name/title fields are the primary search target
- Read-only databases where you cannot or prefer not to modify the schema
- Agent-facing tools where "find by name" covers 90%+ of queries
- Non-English content where FTS5 tokenizer behavior may be unpredictable

**Upgrade to FTS5 when:**

- Queries regularly take >2s (scale problem)
- You need phrase matching, proximity, or boolean operators
- You need statistical relevance (BM25) across large text fields
- You control the database creation and can build the FTS5 table at export time

## Examples

Agent searches for "zmluva" (contract) in an analysis model:

```plaintext
Rank 0 (Name match):  "Založenie zmluvy" (UseCase)
Rank 0 (Name match):  "Detail zmluvy" (Screen)
Rank 1 (Alias match): "ContractDetail" alias contains "zmluva"
Rank 2 (Note match):  Various elements mentioning contracts in descriptions
```

The agent immediately sees the most relevant use cases and screens without wading through 200+ note mentions.
