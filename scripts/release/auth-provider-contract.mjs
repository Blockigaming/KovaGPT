import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const strictLock = process.argv.includes("--strict-lock");
const readable = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx", ".json", ".yml", ".yaml"]);
const forbiddenCredentialPattern = /\b(?:VITE_)?CLERK_[A-Z0-9_]+\b/iu;
const forbiddenImportPattern = /(?:from\s+|import\s*\()\s*["']@clerk\//u;

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .filter((path) => existsSync(join(root, path)));
  } catch {
    const files = [];
    const walk = (directory) => {
      for (const name of readdirSync(directory)) {
        if ([".git", "node_modules", "dist"].includes(name)) continue;
        const path = join(directory, name);
        if (statSync(path).isDirectory()) walk(path);
        else files.push(relative(root, path).replaceAll("\\", "/"));
      }
    };
    walk(root);
    return files;
  }
}

export function inspectAuthProviderContract({
  files = trackedFiles(),
  requireCleanLock = false,
} = {}) {
  const errors = [];
  const warnings = [];
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const group of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const name of Object.keys(pkg[group] ?? {})) {
      if (name.startsWith("@clerk/")) errors.push(`package.json:${group}:${name}`);
    }
  }

  const lockPath = join(root, "package-lock.json");
  if (!existsSync(lockPath)) {
    if (requireCleanLock) errors.push("package-lock.json:missing");
  } else {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const stale = Object.keys(lock.packages?.[""]?.dependencies ?? {}).filter((name) =>
      name.startsWith("@clerk/"),
    );
    for (const name of stale) {
      const finding = `package-lock.json:root:${name}`;
      if (requireCleanLock) errors.push(finding);
      else warnings.push(`${finding}:regenerate package-lock.json before final candidate`);
    }
  }

  for (const path of files) {
    if (path.startsWith("docs/") || path.startsWith("tests/") || path === "package-lock.json")
      continue;
    if (!readable.has(extname(path)) && !["Dockerfile", ".env.example"].includes(path)) continue;
    const source = readFileSync(join(root, path), "utf8");
    if (forbiddenImportPattern.test(source)) errors.push(`${path}:Clerk runtime import`);
    if (forbiddenCredentialPattern.test(source)) errors.push(`${path}:Clerk credential variable`);
  }

  const shim = readFileSync(join(root, "src/components/auth/ClerkSafe.tsx"), "utf8");
  if (!/Auth shim backed by Supabase auth/u.test(shim))
    errors.push("ClerkSafe:Supabase ownership comment missing");
  if (!/from "@supabase\/supabase-js"/u.test(shim))
    errors.push("ClerkSafe:Supabase client types missing");
  if (!/from "@\/integrations\/supabase\/client"/u.test(shim))
    errors.push("ClerkSafe:Supabase client missing");
  if (/from\s+["']@clerk\//u.test(shim)) errors.push("ClerkSafe:Clerk runtime import present");

  return { errors: [...new Set(errors)].sort(), warnings: [...new Set(warnings)].sort() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = inspectAuthProviderContract({ requireCleanLock: strictLock });
  for (const warning of result.warnings) console.warn(`AUTH_PROVIDER_WARNING=${warning}`);
  if (result.errors.length) {
    console.error(`Supabase auth ownership contract failed:\n${result.errors.join("\n")}`);
    process.exit(1);
  }
  console.log(
    `AUTH_PROVIDER_CONTRACT=PASS provider=supabase clerkRuntime=false strictLock=${strictLock} warnings=${result.warnings.length}`,
  );
}
