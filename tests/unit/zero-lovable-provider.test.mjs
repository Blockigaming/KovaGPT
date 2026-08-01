import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI provider configuration has no Lovable credit path", async () => {
  const [providerSource, envExample] = await Promise.all([
    readFile(
      new URL("../../src/lib/ai/provider.server.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../.env.example", import.meta.url), "utf8"),
  ]);

  for (const source of [providerSource, envExample]) {
    assert.doesNotMatch(source, /LOVABLE_API_KEY/i);
    assert.doesNotMatch(source, /LOVABLE_AI_BASE_URL/i);
    assert.doesNotMatch(source, /ai\.gateway\.lovable\.dev/i);
    assert.doesNotMatch(source, /Lovable-API-Key/i);
  }

  assert.match(providerSource, /provider:\s*"openai"/);
  assert.match(
    providerSource,
    /configured:\s*Boolean\(env\("OPENAI_API_KEY"\)\)/,
  );
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
