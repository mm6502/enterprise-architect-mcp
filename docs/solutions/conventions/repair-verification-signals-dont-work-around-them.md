---
title: "Repair verification signals instead of working around them"
date: 2026-08-23
category: conventions
module: build
problem_type: convention
component: development_workflow
severity: high
applies_when:
  - "A checklist step needs an input that does not live in the repo"
  - "A routine command reports changes that are not real changes"
  - "Behaviour changes but the text describing it to callers does not"
  - "A claim about what the code used to do rests on memory"
tags:
  - verification
  - release
  - eval
  - git
  - mcp-contract
---

# Repair verification signals instead of working around them

## Context

The 2.0.2 work began as a three-point contract fix and turned up three further defects that had all survived two releases. They looked unrelated — a broken eval, unreadable `git status`, a stale tool description. They were one failure repeated:

**something that should have said "you are wrong" had gone quiet, and each time the response had been to route around the silence rather than restore it.**

The three, with the evidence that identified each:

1. **A gate that had never run.** `eval/generate-tasks.ts` shipped with the v2.0 eval harness asserting `candidateCount` on `ea_resolve` responses. No version of the server ever returned that field — `git log --all -S "candidateCount" -- src` finds zero commits. Three of sixteen tasks therefore failed against any export, from the day the harness was written. It stayed invisible because release checklist step 4 needed a multi-hundred-megabyte `.qea` that lives outside the repo and whose path was recorded nowhere. The step said "all tasks must pass"; it could not pass, and nobody found out, because nobody could run it.

2. **A signal drowned in noise.** `core.autocrlf=true` expects CRLF in the working tree; `tsc` writes `dist/` with LF. Every build left 26 of the 30 tracked `dist/` files flagged as modified while `git diff` reported no content change at all. The response had been to write the workaround *into the checklist* as step 5 — `git diff --ignore-cr-at-eol` — which made the noise permanent and `git status` permanently useless for reviewing what a release touched.

3. **A contract with nothing watching it.** The change that added the prefix fallback and the `match` field to `ea_resolve` did so in 39 new lines and left the tool description untouched. Nothing failed, because no test bound the description to the behaviour. For an MCP server the description *is* the API the model client programs against, and it is read once at load — so callers went on reading inexact prefix hits as confirmed identities.

A fourth instance appeared inside the session itself: a claim about what a tool description used to say was argued from memory, confidently, and was wrong. `git log -S "contrastively" -- src/tools/elements.ts` settled it in one command and named the single commit that introduced the sentence.

## Guidance

### A verification step whose input is not resolvable from the repo does not exist

If a step needs a fixture, an export, or a credential, the repo must say where to get it — a documented path, an env var with a fallback chain, or a script. Better still, remove the dependency: this repo's eval now builds its own model from committed code, so the step has no input to be missing. Absent either, the step is decorative: it will be skipped under time pressure and its own defects will never surface. Prefer a step that **fails loudly when its input is missing** over one that is quietly not run.

### Watch an assertion fail before trusting it

An assertion that has only ever been written, never executed, is not a check — it is a hypothesis about the response shape. Write it, run it, confirm it fails for the reason you expect, then make it pass. `candidateCount` would have been caught in the first minute of a single run.

### "Ignore the noise" in a checklist is a bug report

The moment you write down a filter — ignore these warnings, skip these files, use this flag to hide that — you have documented a broken signal and made the breakage permanent. Ask first whether the signal can be fixed at the source. Two committed lines in `.gitattributes` retired a workaround that had been embedded in the release process.

### When behaviour changes, the prose describing it to callers changes with it

For an MCP server the tool description is contract, not documentation, and it is consumed once at load by a client that cannot re-read the source. Bind it to behaviour with a test — the MCP `Client` over `InMemoryTransport` exposes `client.listTools()`, so a description can be asserted like any other output.

### Questions about history are answered by git, not memory

"That was already there" / "we changed that last week" are empirical claims with a cheap oracle. `git log -S "<string>" -- <path>` names the commit that introduced or removed any string. Reach for it before arguing from recollection — including when the recollection is your own and feels certain.

## Why This Matters

Every one of these defects was individually small and individually invisible. What made them costly is that they compounded: the eval could not run, so the eval's own bug survived; `git status` was noise, so a stale `dist/` or an unintended file could ride along unnoticed; no test watched the description, so the contract drifted silently for a release. Broken verification does not announce itself — that is the definition of the failure — so it accumulates until something external forces a look.

The workaround is the dangerous part. A defect you have not noticed gets fixed the moment you notice it. A defect you have written a documented workaround for is now a *convention*, and conventions are defended.

## When to Apply

- Before marking any checklist step done — ask whether it actually executed, or was skipped for want of an input
- When adding assertions to any test or eval harness — run them red first
- When you catch yourself adding a flag to a command to hide part of its output
- When changing behaviour behind any described interface — tool descriptions, CLI help, API docs, schema comments
- Whenever an argument turns on what the code used to do

## Examples

**A gate that cannot fail is not a gate.**

```
# checklist step 4, as written: "all tasks must pass"
npm run eval:run -- <path-to-a-private-export>
# ...with that path documented nowhere. Result: never run for two releases,
# while 3 of 16 tasks asserted on a field the server never returned.
```

The fix was two-part: correct the assertions to the shape the tool actually returns (`totalMatched`), and remove the input entirely — the harness now builds a synthetic model from `eval/fixture.ts`, so `npm run eval:run` takes no arguments and cannot be blocked. The phantom name had also spread to `eval/agent-tasks.md` as a bonus criterion for human scorers; an unrun check lets a wrong name propagate to a second file before anyone reads it.

**Fix the signal, don't filter it.**

```gitattributes
# before: 26 dist files "modified" after every build, zero content difference,
# worked around by `git diff --ignore-cr-at-eol` in the release checklist.
dist/** text eol=lf
```

`git add --renormalize dist` staged nothing afterwards — the stored blobs had been LF all along. The mismatch was only ever between what git expected in the working tree and what the compiler wrote there.

Note where the fix belongs. `core.autocrlf` was set in the user's global config, not in the repo, so the noise was invisible to anyone without that setting — which is precisely why the repair is a committed `.gitattributes` rather than a personal config change. A signal repaired only in one developer's environment is not repaired.

**Bind description to behaviour.**

```ts
const { tools } = await client.listTools();
const resolve = tools.find((t) => t.name === "ea_resolve")!;
expect(resolve.description).toMatch(/prefix/i);
for (const kind of ["exact", "prefix", "guid"]) {
  expect(resolve.description).toContain(kind);
}
```

The test is trivial. Its absence let a behaviour change ship with prose describing the previous behaviour.

**Ask git, not memory.**

```
git log --all -S "candidateCount" -- src   # zero commits -> the field never existed
git log -S "contrastively" -- src/tools/elements.ts   # names the introducing commit
```

## Related

- [release-process.md](release-process.md) — the checklist whose step 4 could not pass and whose step 5 encoded the CRLF workaround; both have since been revised against this learning
