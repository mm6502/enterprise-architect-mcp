---
title: "Where each VS Code MCP install surface asks for configuration"
date: 2026-08-23
category: tooling-decisions
module: installation
problem_type: tooling_decision
component: mcp-client-integration
severity: medium
applies_when:
  - "Shipping an MCP server that cannot start without a user-specific value (a file path, a token)"
  - "Deciding whether an install badge, `server.json`, or the README should carry that value"
  - "Choosing between `inputs` prompts, an `env` block, a `.env` file, and MCP elicitation for the same setting"
tags:
  - vscode
  - mcp
  - install-badge
  - server-json
  - mcp-registry
  - configuration
  - elicitation
---

# Where each VS Code MCP install surface asks for configuration

## Context

`enterprise-architect-mcp` cannot do anything without a `.qea` path, and VS Code offers at least five ways to install an MCP server. Which of them ask the user for that path — and *when* they ask — was argued from source reading and reversed twice before being settled by running each surface and watching what happened. The reasoning was wrong in both directions, so the record here is the observed behaviour, not the inferred one.

## Guidance

### What each surface does

| Surface | Asks for the value? | When |
|---------|---------------------|------|
| `code --add-mcp` with the value inline | no, it is already in the command | — |
| Install badge (`vscode:mcp/install?…`) **without** `inputs` | never | the server starts with nothing; whether that is fatal is the server's own choice |
| Install badge **with** `inputs` | yes | during installation, and again at first `Start Server` |
| `.vscode/mcp.json` with `inputs` | yes, once | at first server start; the answer is remembered |
| Gallery / registry install | from the manifest | driven by `server.json` |
| "Add Server…" → NPM Package | **no** | model synthesises config from the package README |

Three consequences worth keeping:

**Do not put `inputs` in the install badge — ask from the server instead.** The original conclusion here was the opposite, and it was wrong for a reason the table cannot show: VS Code's Agent Host excludes servers that require interactive input, `${input:…}` among them, so `inputs` buys a prompt on one surface and costs the server a whole runtime. `inputs` also only ever helped the two surfaces that read `mcp.json`; the gallery and the model-assisted flow never see it. A server that asks for the value itself, over MCP elicitation, covers every surface at once and leaves the badge payload with nothing to fill in.

**A remembered `inputs` answer is editable, but only in the editor.** The `mcp.json` editor decorates the value inline (`${input:qea_path = C:\…}`) with an `Edit | Clear | Clear All` CodeLens, reachable through **Show Configuration**. The server's own action menu offers no reset. This does not hold for `"password": true` inputs, where the decoration shows no value.

**Keep `packageArguments` in `server.json`; keep `environmentVariables` out.** The gallery's `MANIFEST` tab renders a `Packages` section with labelled rows — `Package Arguments`, `Environment Variables`, `Runtime Arguments` — so `packageArguments` is what documents the required value to a browsing user. An earlier double-prompt was traced to `environmentVariables`, not to `packageArguments`.

### Elicitation collapses the surface problem, at a price

Asking from the server only works if the server is alive to ask, so the value can no longer be validated at startup: the process must boot without it and resolve the path on first use. Observed in VS Code 1.134.0:

- The request renders as an inline form in the chat thread — `message` as the header, the schema's `title` as a bold label, `description` as hint text — with Submit (or Ctrl+Enter) and an X to dismiss. No modal, no separate trust dialog.
- A required field **cannot be submitted empty**; the form re-validates and stays open. `${input:promptString}` had no such guard and happily passed an empty string through.
- Three outcomes reach the server: `accept` with content, `cancel` (rendered as "Skipped question"), and `McpError -32001 Request timed out` after the SDK's 60 s default. Anything that waits on a human needs a longer explicit timeout.
- Capability is advertised, so the server can tell a client that cannot prompt and say so plainly instead of hanging.

The price is paid elsewhere: a configured value that cannot be opened must now be **skipped rather than fatal**, because a broken high-priority source would otherwise outrank every answer the user could give and no amount of answering would help. Silently ignoring a deliberate setting is a classic support ticket, so it has to be surfaced — in the log at startup and in whatever tool reports the server's own state.

Skipping is only defensible where a prompt can replace what was skipped, and that is narrower than it first looks. Two cases must stay fatal, or the leniency turns into a silent wrong answer:

- **An explicit command-line argument.** It states this run's intent; falling back past it substitutes a default the caller deliberately overrode.
- **Any client that does not advertise `elicitation`.** With no prompt coming, skipping does not buy a second chance — it just walks down the chain and opens whatever the previous session remembered, under a different model's name. A headless harness passing an explicit path is the realistic victim.

### The model-assisted npm flow copies README examples verbatim

"Add Server…" labels its sources: `Command (stdio)` is `Manual Install`, `NPM Package` is `Model-Assisted`. The model-assisted path never asks for required values. Run against `@modelcontextprotocol/server-filesystem`, it asked only for consent, a server id, and Global vs Workspace, then wrote that project's README placeholders into the config as if they were real:

```json
"args": ["-y", "@modelcontextprotocol/server-filesystem",
         "/Users/username/Desktop", "/path/to/other/allowed/dir"]
```

The server lands in `Error`. Any README placeholder path is a candidate for this treatment — which is the argument for a README whose configuration examples contain no path at all.

It is tempting to respond by leading the README with the `inputs` variant so the model lifts that instead. Resist it: a model that copies the server entry without the sibling top-level `inputs` array produces `Variable input:qea_path can not be resolved`, which is a worse failure than a wrong path. This flow is also only the fallback for packages absent from the MCP registry — publishing there replaces it with the manifest path. The durable fix is to leave no placeholder in the README to copy: a configuration with no path in it is safe to lift verbatim.

### The gallery gives no signal that configuration is needed

Browsing shows name, publisher, stars and a one-line description. Nothing marks a server as needing a token or a path; that is visible only after opening the entry and switching to `MANIFEST`. The `DETAILS` tab is the README, which VS Code downloads and caches alongside the manifest under `%APPDATA%\Code\User\mcp\<id>-<version>\`. So the README is the client-side product description, not just a GitHub page.

## Why This Matters

The default assumption — "the client will ask the user for anything required" — is false on three of these six surfaces. A server that only fails at runtime pushes the recovery onto a user who has no reason to suspect a configuration file they never opened. Choosing where the value is collected is therefore a shipping decision, not a detail, and it has to be made per surface.

## When to Apply

When any required setting is user-specific and cannot ship with a default. If the server has a sensible default, most of this collapses — the surfaces that never prompt simply work.

## Examples

Badge payload once the server asks for its own configuration (the same JSON for both schemes; encode as
`https://insiders.vscode.dev/redirect?url=` + `encodeURIComponent("vscode:mcp/install?" + encodeURIComponent(json))`, double-encoded because GitHub strips bare `vscode:` links):

```json
{
  "name": "enterprise-architect",
  "command": "npx",
  "args": ["-y", "enterprise-architect-mcp"]
}
```

The superseded variant carried a sibling `inputs` array and `"${input:qea_path}"` in `args`. Its input `id` was never shown to the user — the prompt renders only `description` — so it had to be named for the config file, not for the prompt.

Two incidental facts that cost time while building the harness for this:

- `npx -y <tarball>.tgz` runs nothing and exits `0`, silently; npx cannot derive a command name from a tarball filename. Use `npx -y --package <tgz> -- <bin>`.
- Deleting `mcp.json` while VS Code is running resets nothing — the installed list is held in memory and re-materialised. Uninstall from the UI, or close every window first. Configuration is also per profile: `User\mcp.json` is only the default profile, others live under `User\profiles\<hash>\`.
