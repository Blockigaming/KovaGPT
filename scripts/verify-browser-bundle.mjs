import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const SUPABASE_HOST = /https:\/\/([a-z0-9]{20})\.supabase\.co/giu;
const FORBIDDEN_SECRETS = [
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]+/giu],
  ["OpenAI API key", /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/gu],
  ["database connection string", /postgres(?:ql)?:\/\/[^\s"'`]+/giu],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu],
];

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : statSync(path).isFile() ? [path] : [];
  });
}

export function verifyBrowserBundle({
  directory = "dist/client",
  expectedProjectRef = process.env.EXPECTED_SUPABASE_PROJECT_REF,
} = {}) {
  if (!/^[a-z0-9]{20}$/u.test(expectedProjectRef ?? "")) {
    throw new Error("EXPECTED_SUPABASE_PROJECT_REF must be a 20-character project ref.");
  }

  const findings = [];
  for (const file of filesBelow(directory)) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(SUPABASE_HOST)) {
      findings.push({ file: relative(directory, file), ref: match[1] });
    }
    for (const [name, pattern] of FORBIDDEN_SECRETS) {
      if (pattern.test(content)) throw new Error(`Browser bundle contains a ${name} in ${file}.`);
      pattern.lastIndex = 0;
    }
  }

  const refs = [...new Set(findings.map(({ ref }) => ref))].sort();
  if (findings.length !== 1 || refs.length !== 1 || refs[0] !== expectedProjectRef) {
    throw new Error(
      `Expected exactly one Supabase URL for ${expectedProjectRef}; found ${findings.length} URL(s) with ref(s): ${refs.join(", ") || "none"}.`,
    );
  }

  return { refs, urlCount: findings.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyBrowserBundle();
    process.stdout.write(
      `Browser bundle provenance passed: ${result.urlCount} Supabase URL, ref ${result.refs[0]}; no forbidden secret patterns.\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
