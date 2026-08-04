import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("Stripe verifies raw signed body, bounds replay age, and releases failed claims", async () => {
  const verify = await readFile(new URL("../../src/lib/stripe.server.ts", import.meta.url), "utf8"),
    hook = await readFile(
      new URL("../../src/routes/api/public/payments/webhook.ts", import.meta.url),
      "utf8",
    );
  assert.match(verify, /req\.text\(\)/);
  assert.match(verify, /age > 300/);
  assert.match(verify, /timingSafeEqualText/);
  assert.match(hook, /code.*23505/);
  assert.match(hook, /processed_stripe_events"\)\.delete/);
  assert.match(hook, /correlationId/);
  assert.doesNotMatch(hook, /console\.(log|error)/);
});
test("installed TanStack compiler and application retain validated input contract", async () => {
  const compiler = await readFile(
    new URL(
      "../../node_modules/@tanstack/start-plugin-core/src/start-compiler/handleCreateServerFn.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const app = await readFile(
    new URL("../../src/lib/agent-definitions.functions.ts", import.meta.url),
    "utf8",
  );
  assert.match(compiler, /inputValidator/);
  assert.match(app, /\.validator\(/);
  const pkg = JSON.parse(
    await readFile(
      new URL("../../node_modules/@tanstack/react-start/package.json", import.meta.url),
    ),
  );
  assert.equal(pkg.version, "1.168.34");
});
