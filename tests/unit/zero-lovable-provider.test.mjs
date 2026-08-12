import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI provider uses fixed allowlisted endpoints and server-only credentials", async () => {
  const [provider, diagnostics, envExample, azure] = await Promise.all([
    readFile(new URL("../../src/lib/ai/provider.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/lib/config/diagnostics.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../../src/lib/azure-runtime-env.server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(provider, /const OPENAI_API_BASE_URL = "https:\/\/api\.openai\.com\/v1"/);
  assert.match(
    provider,
    /const LOVABLE_GATEWAY_BASE_URL = "https:\/\/ai\.gateway\.lovable\.dev\/v1"/,
  );
  assert.match(
    provider,
    /return usingGateway\(\) \? LOVABLE_GATEWAY_BASE_URL : OPENAI_API_BASE_URL/,
  );
  assert.doesNotMatch(
    provider + envExample,
    /OPENAI_BASE_URL|LOVABLE_AI_BASE_URL|AI_PROVIDER_(?:URL|API_KEY)|VITE_.*(?:OPENAI|LOVABLE).*KEY/,
  );
  assert.match(
    provider,
    /configured: Boolean\(env\("LOVABLE_API_KEY"\) \?\? env\("OPENAI_API_KEY"\)\)/,
  );
  assert.match(diagnostics, /aiProvider: feature\(\["LOVABLE_API_KEY", "OPENAI_API_KEY"\]\)/);
  assert.match(azure, /environment\.OPENAI_API_KEY \|\| environment\.AZURE_OPENAI_ENDPOINT/);
  assert.match(azure, /missing\(environment, \[/);
  assert.doesNotMatch(azure, /function missing\(names[\s\S]{0,180}process\.env/);
  assert.match(provider, /redirect: "error"/);
});

test("managed email provider dependencies are restricted to server routes", async () => {
  const [pkgText, webhook, queue] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../src/routes/lovable/email/auth/webhook.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/routes/lovable/email/queue/process.ts", import.meta.url), "utf8"),
  ]);
  const pkg = JSON.parse(pkgText);
  assert.ok(pkg.dependencies["@lovable.dev/email-js"]);
  assert.ok(pkg.dependencies["@lovable.dev/webhooks-js"]);
  assert.match(webhook, /verifyWebhookRequest/);
  assert.match(queue, /sendLovableEmail/);
  assert.doesNotMatch(webhook + queue, /VITE_LOVABLE|VITE_OPENAI/);
});
