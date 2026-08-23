---
title: "code --add-mcp needs JSON-escaped quotes on Windows, not shell quoting"
date: 2026-08-23
category: integration-issues
module: installation
problem_type: integration_issue
component: install-documentation
severity: medium
symptoms:
  - "`code --add-mcp` prints an Invalid JSON complaint and writes nothing"
  - "No server appears in the MCP list, and `%APPDATA%\\Code\\User\\mcp.json` is not created"
  - "The same command copied from a README works on bash but not in PowerShell"
root_cause: inadequate_documentation
resolution_type: documentation_update
tags:
  - vscode
  - mcp
  - powershell
  - windows
  - cli-quoting
  - readme
---

# code --add-mcp needs JSON-escaped quotes on Windows, not shell quoting

## Problem

The README offered a one-line install using `code --add-mcp '<json>'` inside a ```powershell fence, but the snippet used bash-style quoting. On Windows the command silently registers nothing.

## Symptoms

- `code --add-mcp '{"name":"enterprise-architect",...}'` complains about invalid JSON.
- `%APPDATA%\Code\User\mcp.json` is not created, and no server shows up in the MCP list.
- Nothing indicates that quoting is the cause, so the natural next guess is that the JSON payload itself is malformed.

## What Didn't Work

Every form below was run and verified by inspecting `%APPDATA%\Code\User\mcp.json` afterwards, not by reading the console output:

| Form | Argument as received | Result |
|------|----------------------|--------|
| `'{"name":…}'` (bash style) | `{name:…}` | not written |
| ``"{`"name`":…}"`` (PowerShell backtick) | `{name:…}` | not written |
| `--% {"name":…}` (stop-parsing) | `{name:…}` | not written |
| `'{\"name\":…,\"C:\\\\EA\\\\…\"}'` | path `C:\\EA\\…` | written, but doubled path separators |

The backtick attempt is the informative failure. PowerShell's own escape works exactly as documented — and the command still fails, identically to the naive form. That rules out PowerShell escaping as the fix and points at a second consumer.

## Solution

Single-quote the whole payload so PowerShell leaves it alone, escape the inner quotes for the shim with `\"`, and keep a single `\\` per path separator because that is JSON's own escape:

```powershell
code --add-mcp '{\"name\":\"enterprise-architect\",\"command\":\"npx\",\"args\":[\"-y\",\"enterprise-architect-mcp\",\"C:\\EA\\exports\\model.qea\"]}'
```

On bash or zsh the plain form is the correct one, so document both:

```bash
code --add-mcp '{"name":"enterprise-architect","command":"npx","args":["-y","enterprise-architect-mcp","/home/me/exports/model.qea"]}'
```

## Why This Works

There are two parsing layers, not one. PowerShell builds the string and hands it to `code.cmd`, which **re-parses** the argument before passing it on. Anything PowerShell resolves — backtick escapes, `--%` — is already spent by the time the shim looks at the string, so the quotes arrive stripped. The shim wants to see literal `\"` characters in the text it receives; single quotes are what guarantee PowerShell delivers them untouched.

The `\\` is a separate concern: it is JSON escaping a backslash, so one `\\` per separator yields one `\` in the parsed path. Doubling it to `\\\\` produces `C:\\EA\\exports`, which is why that variant writes a config with a visibly wrong path.

## Prevention

Treat any documented command that pipes JSON into a `.cmd`/`.bat` shim as unverified until it has been run on Windows **and the resulting config file has been read back**. The failure mode here is silent: exit status and console output were not sufficient evidence, only the absence of `mcp.json` was.

Two smaller habits fall out of this:

- Label a fence with the shell it was actually tested in, and give the other shell its own block. A ```powershell fence containing bash quoting is worse than no fence, because it looks authoritative.
- When a correct-by-the-book escape fails the same way as a naive one, stop escaping harder and go looking for a second parser.
