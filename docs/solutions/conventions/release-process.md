---
title: "Release process for EA MCP Server"
date: 2026-08-13
problem_type: conventions
category: conventions
module: build
tags:
  - release
  - versioning
  - build
  - checklist
track: knowledge
applies_when: "Shipping a new version of the EA MCP server"
---

# Release process for EA MCP Server

## Context

v2.0.0 release (2026-08-13) went through five pushback rounds because the release steps were done ad-hoc. Each round caught something the previous missed: stale dist, wrong version format, missing not-found handling on one tool, unupdated README. A checklist prevents repeating this.

## Guidance

### Pre-release checklist

1. **Bump version** in `package.json` (`"version": "X.Y.Z"`) and in `server.json` — both the top-level `version` and `packages[0].version`. The registry rejects a `server.json` whose package version does not exist on npm, so all three must be the same string.
2. **Rebuild** — `npm run build` (prebuild generates `src/version.ts` with version + UTC build timestamp)
3. **Run tests** — `npm test` (every suite green; no count is recorded here, because a hardcoded number goes stale and then gets ignored)
4. **Run eval** — `npm run eval:run`. It builds a synthetic model from `eval/fixture.ts` into a temp directory, runs the task set against it and cleans up after itself; no export and no arguments are needed, so the step can never be skipped for want of a file. All tasks must pass. Opportunistically, when a real `.qea` export happens to be at hand, compare its schema against `test/helpers/ea-schema.ts` — that is the one thing the synthetic model cannot check for itself.
5. **Verify dist is current** — after the build, `git status --short` must show only `src/version.ts` and `dist/version.*`. `.gitattributes` pins `dist` to LF, so any other entry is a real change that belongs in the commit.
6. **Update README** — tool descriptions, usage examples, breaking changes
7. **Commit** with release notes as message — `git commit -m "feat: EA MCP Server vX.Y.Z — <summary>"`
8. **Push** — `git push origin main` (GitHub is the only remote and the source of truth)
9. **Publish to npm** — `npm publish --access public`. `prepublishOnly` builds and tests first.
10. **Publish to the MCP registry** — `mcp-publisher login github` then `mcp-publisher publish`. Ownership is verified by the `mcpName` field in `package.json`, which must equal `server.json`'s `name` (`io.github.mm6502/enterprise-architect-mcp`). npm must already carry the new version when this runs.

### Version format

`package.json` has the semver (`2.0.0`). The prebuild script generates:

```js
export const packageVersion = "2.0.0+20260813105415";
```

The `+YYYYMMDDHHmmss` suffix is a UTC build timestamp — unique per build, no self-reference problem (commit SHA cannot reference itself). Reported in `ea_get_model_info` as `serverVersion`.

### Breaking change criteria (bump major)

- Response shape changes (wrapping bare arrays, adding required fields)
- Renamed or removed tools
- Changed parameter semantics

### Feature criteria (bump minor)

- New tool, new optional parameter, new response field
- A tool description that changes what a calling model will do. The description is the contract an agent programs against, so naming fields it previously did not know about changes client behaviour even when no field is new
- A new install or configuration route (different package source, different config shape) while the previous one still works
- A newly declared runtime requirement such as `engines`, even when it only states what was already true — under `engine-strict` it can fail an install that used to succeed

### Fix criteria (bump patch)

- Bug fix that leaves every tool, parameter, and response shape as it was
- Error message wording and startup diagnostics
- README, docs, package metadata, license files
- Internal refactor, added or reworked tests

The dividing line between minor and patch is whether a consumer has to notice. A patch says "already fixed, carry on"; a minor says "read this before you upgrade". When the two are arguable, take the minor — an under-bump is discovered by the consumer, an over-bump by nobody.

### When to amend vs new commit

- **Amend** (`git commit --amend`) — fixing something in the same logical release before others depend on it. Force push required.
- **New commit** — after others have pulled or are using the current version.

## Why This Matters

Without a checklist, each release iteration catches one more missed step. Five pushback rounds in one afternoon = five manual verification passes by the consuming agent. A single pass through this checklist catches them all upfront.

## When to Apply

Every time a new version ships — whether a major release, a patch, or a pushback fix that changes the public contract.

## Examples

**Bad:** bump version → push → realize dist is stale → amend → realize README is wrong → amend again → realize one tool was missed → amend again.

**Good:** bump version → build → test → eval → verify dist → update README → commit → push → done.

## Related

- [repair-verification-signals-dont-work-around-them.md](repair-verification-signals-dont-work-around-them.md) — why steps 4 and 5 above were rewritten rather than left as an unresolvable input and a baked-in workaround
