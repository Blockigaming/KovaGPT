import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);
const runtimeRoots = [
  ".env.example",
  ".github/workflows",
  "src",
  "worker",
  "workers",
  "supabase/functions",
];
const runtimeExtension = /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|toml)$/;
const creditEscapePattern =
  /LOVABLE_API_KEY|LOVABLE_AI_BASE_URL|ai\.gateway\.lovable\.dev|Lovable-API-Key|OPENAI_BASE_URL|AI_PROVIDER_(?:URL|API_KEY)/i;

async function runtimeFiles(relativePath) {
  const url = new URL(relativePath, repositoryRoot);
  try {
    const entries = await readdir(url, { withFileTypes: true });
    const files = await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? runtimeFiles(path.posix.join(relativePath, entry.name))
          : runtimeExtension.test(entry.name)
            ? [path.posix.join(relativePath, entry.name)]
            : [],
      ),
    );
    return files.flat();
  } catch (error) {
    if (error?.code === "ENOTDIR") return [relativePath];
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

test("AI provider configuration has no Lovable credit path", async () => {
  const [providerSource, diagnosticsSource, envExample, discoveredFiles] =
    await Promise.all([
      readFile(
        new URL("../../src/lib/ai/provider.server.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../src/lib/config/diagnostics.server.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../../.env.example", import.meta.url), "utf8"),
      Promise.all(runtimeRoots.map(runtimeFiles)).then((groups) =>
        groups.flat(),
      ),
    ]);

  const violations = [];
  for (const file of discoveredFiles) {
    const source = await readFile(new URL(file, repositoryRoot), "utf8");
    if (creditEscapePattern.test(source)) violations.push(file);
  }
  assert.deepEqual(
    violations,
    [],
    `credit-routing escape hatches found in: ${violations.join(", ")}`,
  );

  assert.match(providerSource, /provider:\s*"openai"/);
  assert.match(
    providerSource,
    /configured:\s*Boolean\(env\("OPENAI_API_KEY"\)\)/,
  );
  assert.match(providerSource, /https:\/\/api\.openai\.com\/v1/);
  assert.match(providerSource, /redirect:\s*"error"/);
  assert.match(
    diagnosticsSource,
    /aiProvider:\s*feature\(\["OPENAI_API_KEY"\]\)/,
  );
  assert.doesNotMatch(envExample, /OPENAI_BASE_URL/);
});

test("title validation runs before the provider module is loaded", async () => {
  const source = await readFile(
    new URL("../../src/routes/api/title.ts", import.meta.url),
    "utf8",
  );
  const invalidMessagesGuard = source.indexOf("if (!messages)");
  const providerImport = source.indexOf(
    'await import("@/lib/ai/provider.server")',
  );

  assert.ok(invalidMessagesGuard >= 0, "missing invalid-message guard");
  assert.ok(
    providerImport > invalidMessagesGuard,
    "provider runtime loads before input validation",
  );
  assert.doesNotMatch(source, /^import .*provider\.server/m);
});
