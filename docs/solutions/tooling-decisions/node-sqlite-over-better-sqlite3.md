---
title: "node:sqlite built-in module over better-sqlite3 on Node 22.5+"
date: 2026-06-30
category: tooling-decisions
module: database
problem_type: tooling_decision
component: sqlite-driver
severity: high
applies_when:
  - Building TypeScript MCP servers or CLI tools that need synchronous SQLite access
  - Targeting Node.js 22.5+ (especially 26.x where native V8 API changes break addons)
  - Wanting zero native compilation dependencies for deployment simplicity
  - Read-only workloads where advanced better-sqlite3 features are unnecessary
tags:
  - sqlite
  - node-sqlite
  - better-sqlite3
  - native-modules
  - node-26
  - mcp
---

# node:sqlite built-in module over better-sqlite3 on Node 22.5+

## Context

The enterprise-architect-mcp server needed synchronous read-only SQLite access to open multi-hundred-megabyte `.qea` files (Sparx EA exports). The initial plan specified `better-sqlite3` — the de facto standard for synchronous SQLite in Node.js — but native compilation failed on Node 26.4.0 due to V8 API breaking changes in the N-API/addon layer.

This is not a one-off issue. Every major Node.js version bump risks breaking native addons until maintainers catch up with V8 API changes. For MCP servers that need simple read-only database access, this compilation friction is unnecessary overhead.

## Guidance

Use the Node.js built-in `node:sqlite` module (`DatabaseSync` class) instead of `better-sqlite3` when:

- You need synchronous read-only access (no write transactions, no custom functions)
- You're on Node 22.5+ (the module is stable from Node 22.5)
- You want zero native compilation dependencies
- You don't need `better-sqlite3`-specific features (virtual tables, custom aggregates, backup API)

```typescript
import { DatabaseSync } from "node:sqlite";

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec("PRAGMA cache_size = -64000"); // 64MB cache for large files
  return db;
}
```

Key differences from `better-sqlite3`:

| Feature | `node:sqlite` | `better-sqlite3` |
| ------- | ------------- | ---------------- |
| Installation | Zero — built into Node | Native compilation required |
| Node 26.x | Works | Fails (V8 breaking changes) |
| API | `DatabaseSync` class | `Database` class |
| Read-only open | `{ readOnly: true }` | `{ readonly: true, fileMustExist: true }` |
| Prepared statements | `.prepare(sql).get(...params)` | `.prepare(sql).get(...params)` |
| Custom functions | Not supported | Supported |
| Virtual tables | Not supported | Supported |

## Why This Matters

Native module compilation is the single biggest source of deployment friction in Node.js projects. It requires platform-specific build tools (Visual Studio on Windows, Xcode on macOS, gcc on Linux), adds minutes to CI, and breaks unpredictably on Node.js major version bumps. For read-only workloads — which is the vast majority of MCP server database access — the built-in module eliminates this entire category of problems.

## When to Apply

- **Use `node:sqlite`** for: MCP servers, CLI tools, read-only analytics, any synchronous SQLite access where you control the Node.js version (22.5+)
- **Still use `better-sqlite3`** for: write-heavy workloads needing custom SQL functions, virtual table support, or when targeting Node < 22.5

## Examples

Before (fails on Node 26.4.0):

```typescript
import Database from "better-sqlite3";
const db = new Database(path, { readonly: true, fileMustExist: true });
```

After (works on any Node 22.5+):

```typescript
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(path, { readOnly: true });
```

The API surface is nearly identical for read operations — prepared statements, `.get()`, `.all()`, parameterized queries all work the same way. The migration is a one-line import change plus constructor option rename.
