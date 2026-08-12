import { readFileSync } from "node:fs";

export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) out._.push(value);
    else if (value.includes("=")) {
      const [key, ...rest] = value.slice(2).split("=");
      out[key] = rest.join("=");
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[value.slice(2)] = argv[++i];
    else out[value.slice(2)] = true;
  }
  return out;
}

export function jsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function result(tool, checks, extra = {}) {
  const blockers = checks.filter((check) => check.status === "BLOCKER").length;
  const warnings = checks.filter((check) => check.status === "WARNING").length;
  return {
    tool,
    status: blockers ? "BLOCKER" : warnings ? "WARNING" : "PASS",
    blockers,
    warnings,
    checks,
    ...extra,
  };
}

export function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  if (value.status === "BLOCKER") process.exitCode = 2;
}

export function namesFromInput(path) {
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  if (raw.startsWith("{") || raw.startsWith("[")) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
    if (Array.isArray(parsed.environmentVariables))
      return parsed.environmentVariables.map((item) => item.name ?? item).filter(Boolean);
    if (Array.isArray(parsed.properties?.template?.containers?.[0]?.env))
      return parsed.properties.template.containers[0].env.map((item) => item.name);
    return Object.keys(parsed);
  }
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim().split("=")[0])
    .filter((line) => line && !line.startsWith("#"));
}

export function safeOrigin(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname) &&
      !url.hostname.endsWith(".lovable.app")
    );
  } catch {
    return false;
  }
}
