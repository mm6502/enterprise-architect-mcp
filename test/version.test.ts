import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT_PATH = join(__dirname, "..", "scripts", "stamp-version.mjs");

/** Sets up a scratch directory shaped like the repo root, minus GITHUB_SHA in the environment. */
function makeFixtureDir(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), "stamp-version-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version }));
  mkdirSync(join(dir, "src"));
  return dir;
}

function runStampVersion(dir: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return execFileSync("node", [SCRIPT_PATH, ...args], {
    cwd: dir,
    env: { ...process.env, GITHUB_SHA: "", ...env },
    encoding: "utf8",
  });
}

describe("stamp-version.mjs", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("writes X.Y.Z+g followed by the first 7 characters of a 40-character SHA", () => {
    dir = makeFixtureDir("2.2.0");
    runStampVersion(dir!, ["a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"]);
    expect(readFileSync(join(dir!, "src/version.ts"), "utf8")).toBe(
      'export const packageVersion = "2.2.0+ga1b2c3d";\n',
    );
  });

  it("reads the SHA from GITHUB_SHA when no argument is given", () => {
    dir = makeFixtureDir("2.2.0");
    runStampVersion(dir!, [], { GITHUB_SHA: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678" });
    expect(readFileSync(join(dir!, "src/version.ts"), "utf8")).toBe(
      'export const packageVersion = "2.2.0+ga1b2c3d";\n',
    );
  });

  it("exits non-zero and writes nothing given no SHA argument and no GITHUB_SHA", () => {
    dir = makeFixtureDir("2.2.0");
    expect(() => runStampVersion(dir!, [])).toThrow();
    expect(existsSync(join(dir!, "src/version.ts"))).toBe(false);
  });

  it("fails rather than emitting a truncated identifier for a SHA shorter than 7 characters", () => {
    dir = makeFixtureDir("2.2.0");
    expect(() => runStampVersion(dir!, ["abc123"])).toThrow();
    expect(existsSync(join(dir!, "src/version.ts"))).toBe(false);
  });

  it("fails rather than emitting a build identity from a non-hex SHA", () => {
    dir = makeFixtureDir("2.2.0");
    expect(() => runStampVersion(dir!, ["not-a-real-sha-value"])).toThrow();
    expect(existsSync(join(dir!, "src/version.ts"))).toBe(false);
  });
});

describe("the committed src/version.ts", () => {
  it("parses as <package.json version>+g<7 hex chars>", () => {
    const { version } = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    const versionTs = readFileSync(join(__dirname, "..", "src", "version.ts"), "utf8");
    const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(versionTs).toMatch(new RegExp(`^export const packageVersion = "${escapedVersion}\\+g[0-9a-f]{7}";\\n$`));
  });
});
