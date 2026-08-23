import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const APP_DIR = "enterprise-architect-mcp";

/** Where the answer to the path prompt is kept, so it is asked once and not every start. */
export function configFilePath(): string {
  const override = process.env.EA_MCP_CONFIG_DIR;
  if (override) return join(override, "config.json");

  const base =
    process.platform === "win32"
      ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");

  return join(base, APP_DIR, "config.json");
}

export function readRememberedPath(): string | undefined {
  const file = configFilePath();
  if (!existsSync(file)) return undefined;

  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const value = (parsed as { qeaPath?: unknown }).qeaPath;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    // A corrupt config must not stop the server — it just means nothing is remembered.
    return undefined;
  }
}

export function rememberPath(qeaPath: string): void {
  const file = configFilePath();
  mkdirSync(dirname(file), { recursive: true });
  // The file records where one person's model lives, so it is written for that person only.
  writeFileSync(file, `${JSON.stringify({ qeaPath }, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
}

export function forgetPath(): void {
  const file = configFilePath();
  if (existsSync(file)) writeFileSync(file, `${JSON.stringify({}, null, 2)}\n`, "utf-8");
}
