---
title: "Environment fallback chain for developer-local path configuration"
date: 2026-06-30
category: design-patterns
module: qea-path-resolution
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - MCP servers or CLI tools need developer-local configuration without hardcoding paths
  - Configuration must be committable to version control without per-developer edits
  - Teams have heterogeneous file paths across development machines
  - Multiple configuration sources should be supported in priority order
tags:
  - mcp
  - environment-variables
  - configuration
  - fallback-chain
  - path-resolution
  - dotenv
---

# Environment fallback chain for developer-local path configuration

## Context

CLI tools and MCP servers that take file paths as configuration face a tension: the path needs to be specific to each developer's machine, but the server configuration (e.g., `mcp.json`) should be committable to the project repo so the whole team gets it without setup.

The enterprise-architect-mcp server initially used a required CLI argument (`<qea-file>`) coupled with an `mcp.json` input prompt (`${input:qea_path}`), which worked but required manual input on every launch. Developers couldn't commit a fixed `.qea` path to their project repos because each machine has a different filesystem layout.

The gap: no way to say "use this CLI argument if provided, fall back to an env var, and if that's not set, check a `.env` file" — and allow the value to be either a file or a directory.

## Guidance

Implement a **path resolution chain with three fallback levels** and optional **directory scanning**. Create a dedicated resolution function that:

1. Accepts a CLI argument as the highest-priority source
2. Falls back to an environment variable (e.g., `EA_QEA_PATH`)
3. Reads from a `.env` file in the current working directory
4. Supports both file and directory targets — if a directory is provided, scan for the newest matching file
5. Reports a clear failure naming every configuration method

Step 3 rests on an assumption worth stating: the process must be launched *from* the workspace. Verified for VS Code — it starts a stdio MCP server with the working directory set to the workspace root, so a `.env` there is found. Clients that launch from elsewhere (Claude Desktop) never reach a useful step 3, which is why they get an `env` block instead.

**This repo later outgrew step 5.** Once the server could ask the client for the value over MCP elicitation, failing fast became the wrong ending — a dead process cannot prompt. The chain gained two levels below the three here, a remembered answer and then the prompt itself, and a source naming a path that cannot be opened became skippable rather than fatal, so a stale high-priority setting cannot outrank the answer the user just gave. Skipping stays fatal in the two cases where no answer is coming to replace what was skipped: an explicit CLI argument, and any client that cannot prompt. See [Where each VS Code MCP install surface asks for configuration](../tooling-decisions/vscode-mcp-install-surfaces-configuration.md). The three sources below are unchanged; what changed is what happens when they come up empty.

### Resolution function

The resolver reports only what went wrong; the guidance on how to supply the value belongs to the caller, which knows how it was invoked.

```typescript
export function resolveQeaPath(cliArg?: string): string {
  const target = cliArg || process.env.EA_QEA_PATH || loadFromDotEnv();

  if (!target) {
    throw new Error("No .qea path provided.");
  }

  const resolved = resolve(target);

  if (!existsSync(resolved)) {
    throw new Error(`Path not found: "${resolved}"`);
  }

  if (statSync(resolved).isDirectory()) {
    return findNewestQea(resolved);
  }

  return resolved;
}
```

### Directory scanning

Once a chain can skip a source, this single function has to split in two: one half that lists what is
configured (cheap, filesystem-free beyond `.env`) and one half that resolves a single value (the half
that can fail). The caller then walks the list and decides what a failure means, which is a decision
only it can make. Keep the resolution logic below identical across the split — only its entry points change.

When the resolved path is a directory, find the newest `.qea` file by modification time:

```typescript
function findNewestQea(dir: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".qea"))
    .map((f) => {
      const fullPath = join(dir, f);
      return { path: fullPath, mtime: statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    throw new Error(`No .qea files found in directory: ${dir}`);
  }

  return files[0].path;
}
```

### Minimal `.env` parser

Read only the variable you need — no external dependency required:

```typescript
function loadFromDotEnv(): string | undefined {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return undefined;

  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed) continue;
    const match = trimmed.match(/^EA_QEA_PATH\s*=\s*(.+)$/);
    if (match) {
      return match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}
```

### CLI integration

Make the positional argument optional and delegate to the resolver:

```typescript
const argv = yargs(hideBin(process.argv))
  .command("$0 [qea-path]", "Enterprise Architect MCP Server", (y) => {
    y.positional("qea-path", {
      describe: "Path to .qea file or directory. Falls back to EA_QEA_PATH env var or .env.",
      type: "string",
    });
  })
  .parseSync();

// Hand the argument to the chain rather than resolving here, so the resolution
// point stays in one place when later steps need to be asynchronous.
const session = new ModelSession(server, argv["qea-path"] as string | undefined);
```

### Simplified `mcp.json` (committable)

```json
{
  "servers": {
    "enterprise-architect": {
      "type": "stdio",
      "command": "mcp-server-ea",
      "args": []
    }
  }
}
```

## Why This Matters

**Enables shared config in version control.** The `mcp.json` with no path arguments can be committed and every developer gets the server configured automatically — they only need a gitignored `.env` with their local path.

**Supports automation.** CI pipelines and scripts can set `EA_QEA_PATH` once without modifying config files.

**Directory scanning removes bookkeeping.** When `.qea` exports are regularly regenerated in a known folder, the tool automatically picks the latest version — no manual path updates needed.

**Clear error messages reduce support burden.** Users learn all three configuration methods from a single error message instead of guessing why the tool won't start.

## When to Apply

- CLI tool or MCP server config is committed to a shared repo
- Users have environment-specific file paths that shouldn't be version-controlled
- You want CLI arguments, env vars, and `.env` files as configuration sources with clear priority
- Directory scanning is useful (e.g., "use the latest export" is a reasonable default)

Not suitable when:

- The file path is truly fixed and identical for all users
- You need secrets management features (use a dedicated secrets manager)

## Examples

### Developer with a fixed file (`.env`)

```ini
# .env (gitignored)
EA_QEA_PATH=C:\EA\exports\model.qea
```

The server then needs no arguments:

```powershell
mcp-server-ea
```

### Directory scanning for latest export

```ini
# .env (gitignored)
EA_QEA_PATH=C:\EA\exports\
```

The newest `.qea` file in that directory wins, by modification time.

### CLI override for one-off use

The CLI argument takes priority over both the environment variable and `.env`:

```powershell
mcp-server-ea C:\tmp\debug-snapshot.qea
```

### Project setup for the team

Commit a template so each developer knows what to fill in:

```ini
# .env.example
EA_QEA_PATH=<path-to-your-qea-file-or-directory>
```

Keep the real file out of the repo:

```gitignore
.env
```

## Related

- [src/resolve-qea-path.ts](../../src/resolve-qea-path.ts) — implementation
- [test/resolve-qea-path.test.ts](../../test/resolve-qea-path.test.ts) — 9 tests covering all fallback paths
