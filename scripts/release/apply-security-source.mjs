import { readFileSync, writeFileSync } from "node:fs";

const checkOnly = process.argv.includes("--check");

const replacements = [
  {
    path: "src/lib/google-tools.server.ts",
    before: `import { validateSupportedGoogleWrite } from "@/lib/google-write-validation.server.mjs";`,
    after: `import { validateSupportedGoogleWrite } from "@/lib/google-write-validation.server.mjs";
import { safeConnectorError } from "@/lib/connectors.server";`,
    appliedNeedle: `import { safeConnectorError } from "@/lib/connectors.server";`,
  },
  {
    path: "src/lib/google-tools.server.ts",
    before: `  } catch (e) {
    console.error(\`[tool \${name}] failed\`, e);
    return { error: "tool_failed", message: (e as Error).message };
  }`,
    after: `  } catch (e) {
    const safeMessage = safeConnectorError(e);
    console.error(\`[tool \${name}] failed\`, safeMessage);
    return { error: "tool_failed", message: safeMessage };
  }`,
  },
  {
    path: "src/lib/google-tools.server.ts",
    before: `  if (error || !data) {
    console.error("[stagePendingAction] insert failed", error);
    throw new Error("Could not stage pending action");
  }`,
    after: `  if (error || !data) {
    console.error(
      "[stagePendingAction] insert failed",
      safeConnectorError(error?.message ?? "database write failed"),
    );
    throw new Error("Could not stage pending action");
  }`,
  },
];

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function replacementState(source, replacement) {
  const beforeCount = occurrences(source, replacement.before);
  const appliedNeedle = replacement.appliedNeedle ?? replacement.after;
  const afterCount = occurrences(source, appliedNeedle);
  if (replacement.appliedNeedle && afterCount === 1) {
    return { applied: true, pending: false, beforeCount, afterCount };
  }
  const afterContainsBefore = replacement.after.includes(replacement.before);
  const applied = afterCount === 1 && beforeCount === (afterContainsBefore ? 1 : 0);
  const pending = afterCount === 0 && beforeCount === 1;
  return { applied, pending, beforeCount, afterCount };
}

export function applySecuritySource({ check = checkOnly } = {}) {
  const files = new Map();
  const changed = new Set();

  for (const replacement of replacements) {
    const source = files.get(replacement.path) ?? readFileSync(replacement.path, "utf8");
    const state = replacementState(source, replacement);
    if (state.applied) {
      files.set(replacement.path, source);
      continue;
    }
    if (!state.pending) {
      throw new Error(
        `security_source_drift:${replacement.path}:before=${state.beforeCount}:after=${state.afterCount}`,
      );
    }
    files.set(replacement.path, source.replace(replacement.before, replacement.after));
    changed.add(replacement.path);
  }

  if (check && changed.size) {
    throw new Error(`security_source_pending:${[...changed].sort().join(",")}`);
  }
  if (!check) {
    for (const path of [...changed].sort()) writeFileSync(path, files.get(path));
  }
  return { changed: [...changed].sort(), check };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = applySecuritySource();
  console.log(
    `SECURITY_SOURCE=${checkOnly ? "PASS" : "APPLIED"} files=${result.changed.join(",") || "none"}`,
  );
}
