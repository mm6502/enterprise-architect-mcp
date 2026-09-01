#!/usr/bin/env node
// Writes src/version.ts as "<package.json version>+g<short SHA>". Only the release
// workflow runs this; a local `npm run build` no longer touches src/version.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const sha = process.argv[2] ?? process.env.GITHUB_SHA;

if (!sha) {
  console.error(
    "stamp-version: no commit SHA given (pass it as the first argument or set GITHUB_SHA)",
  );
  process.exit(1);
}

const normalizedSha = sha.trim().toLowerCase();

if (!/^[0-9a-f]{7,40}$/.test(normalizedSha)) {
  console.error(
    `stamp-version: commit SHA "${sha}" is not a 7-40 character hex string`,
  );
  process.exit(1);
}

const sha7 = normalizedSha.slice(0, 7);
const { version } = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
const packageVersion = `${version}+g${sha7}`;

writeFileSync(
  join(cwd, "src/version.ts"),
  `export const packageVersion = ${JSON.stringify(packageVersion)};\n`,
);

console.log(`stamp-version: wrote ${packageVersion}`);
