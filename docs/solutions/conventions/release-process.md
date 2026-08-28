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

v2.0.0 release (2026-08-13) went through five pushback rounds because the release steps were done ad-hoc. Each round caught something the previous missed: stale dist, wrong version format, missing not-found handling on one tool, unupdated README. A checklist prevented repeating this, but the checklist itself was still hand-run — as of 2026-08 the release is a dispatched GitHub Actions workflow (`.github/workflows/release.yml`) instead.

## Guidance

### Releasing

1. **Decide the version** per the bump criteria below.
2. **Update README** if needed — tool descriptions, usage examples, breaking changes. This is the one content edit a human still makes; commit it to `main` before dispatching.
3. **Dispatch the release workflow** (`Release` in the Actions tab) with that version as input. It bumps `package.json`, both `server.json` fields, and `src/version.ts` from one input, then builds, tests, evals, commits `dist/` and the version file, tags, publishes to npm over OIDC, publishes to the MCP registry, and only then pushes the commit and tag — in that order, so a failure anywhere before the push leaves `main` untouched.
4. **Watch the run.** It reports which gate failed, if any. See Recovery below for what to do when it fails after a publish.

Nothing else is manual. There is no separate rebuild, test, eval, dist-check, commit, push, or publish step — the workflow performs all of them as one dispatch.

### Recovery

A run that fails after the local gates (build, test, eval) pass falls into one of two states, both finished by re-dispatching the same version with `resume_after_npm` set:

- **npm succeeded, the registry publish did not.** The resumed run's guard requires the version to already be on npm (the flag inverts the normal check), skips the npm publish, retries the registry publish, and pushes.
- **Both publishes succeeded, only the push failed** (branch protection, or `main` moved between checkout and push). The resumed run's registry step finds the version already there, skips it, and the run pushes.

Never re-dispatch the same version without the flag — the ordinary guard rejects it, correctly, because the version is already on npm.

If a run fails at or before the local gates, nothing was committed, tagged, or published — just fix the problem and dispatch again with no flag.

### Version format

`package.json` carries the plain semver (`2.1.0`). The release workflow's stamping script (`scripts/stamp-version.mjs`) writes `src/version.ts` as:

```ts
export const packageVersion = "2.1.0+g1a2b3c4";
```

The `+g<sha7>` suffix is the short SHA — supplied by CI from `GITHUB_SHA` — of the commit the release was built from; `git show 1a2b3c4` resolves it. It is deliberately absent from `package.json`'s own `version` field and from what npm publishes, because `npm publish` strips build metadata from the manifest version (`libnpmpublish` runs `semver.clean()` over it).

Between releases, `src/version.ts` on `main` still names the last released commit, not the commit actually checked out — a checkout running at `HEAD` between releases reports a SHA that is real and resolvable, but not its own. Reported in `ea_get_model_info` as `serverVersion`.

### Publishing configuration

**One-time bootstrap, before any of this works.** A trusted-publisher entry lives in an existing package's settings on npmjs.com — it cannot be created for a package that has never been published, so OIDC cannot be the very first publish. Before U5 can be configured: create an npm account, enable 2FA, and run `npm login` + `npm publish --access public` once by hand from `main`. That manual publish creates `enterprise-architect-mcp` in the registry and makes the account its owner; only then does the package's Settings page (and the Trusted Publisher section on it) exist to configure. This is a one-time exception, same shape as `src/version.ts`'s bootstrap in `scripts/stamp-version.mjs` — every release after it goes through the workflow. The MCP registry has no equivalent bootstrap: its OIDC publish is trusted from the first run, because ownership there is proven by the `mcpName` field and the GitHub identity, not by a pre-existing registry entry.

npm publishing uses [trusted publishing over OIDC](https://docs.npmjs.com/trusted-publishers) — no stored secret. On npmjs.com, `enterprise-architect-mcp` has a trusted publisher entry naming this repository and the workflow filename `.github/workflows/release.yml` exactly; npm does not validate the entry until a publish attempts to use it. The release job also declares `environment: release`, a GitHub environment whose deployment-branch rule restricts it to `main` — without that restriction, npm's trusted-publisher entry (which binds to owner, repository, and workflow filename, not to a branch) would let a `workflow_dispatch` from any branch carrying a same-path `release.yml` publish under this package's name.

If OIDC is ever rejected for a dispatch-triggered publish, the fallback is an `NPM_TOKEN` secret on the `release` environment, passed to `npm publish` with `--provenance --access public`. It should be a granular access token scoped to this package, publish-only, with an expiry of at most 90 days. Retry OIDC and revoke the token once it works again; do not let the fallback become the steady state.

The MCP registry publish authenticates the same way (`mcp-publisher login github-oidc`), granted by the OIDC `repository_owner` claim on `io.github.mm6502/*` — this extends to every repository under the account, not only this one. Ownership is proven by the `mcpName` field in `package.json`, which must equal `server.json`'s `name`.

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

**Bad:** dispatch a release → realize the README was stale → dispatch again with a wasted npm publish already live under the previous version's content.

**Good:** update README → decide the version → dispatch → watch the run.

## Related

- [repair-verification-signals-dont-work-around-them.md](repair-verification-signals-dont-work-around-them.md) — why the old checklist's dist-verification step was rewritten rather than left as an unresolvable input and a baked-in workaround; the drift check in `.github/workflows/ci.yml` is that fix's current form.
