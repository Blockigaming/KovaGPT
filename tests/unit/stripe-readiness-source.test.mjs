import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile("src/lib/readiness.server.ts", "utf8");
const compiled = ts.transpileModule(
  source.replace(/^import .*;\n/gmu, "").replace(/^export /gmu, ""),
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
).outputText;
const account = "acct_1UAeDgAEZlsb6DBY";
const configured = {
  STRIPE_BILLING_RUNTIME: "durable",
  STRIPE_LIVE_ACCOUNT_ID: account,
  STRIPE_LIVE_API_KEY: "rk_live_Fixture",
  PAYMENTS_LIVE_WEBHOOK_SECRET: "whsec_Fixture",
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_Fixture",
};
function readiness(env, compiledToken) {
  const context = {
    runtimeEnv: (name) => env[name],
    PUBLIC_STRIPE_ACCOUNT_ID: account,
    COMPILED_PAYMENTS_CLIENT_TOKEN: compiledToken,
  };
  vm.runInNewContext(`${compiled}\nglobalThis.report = structuralReadiness();`, context);
  return context.report.capabilities;
}

test("runtime public-key configuration cannot claim a browser built without Checkout", () => {
  const capabilities = readiness(
    { ...configured, VITE_PAYMENTS_CLIENT_TOKEN: "pk_live_RuntimeOnly" },
    "",
  );
  assert.equal(capabilities.stripeCheckout.state, "unavailable");
  assert.equal(capabilities.stripe.state, "unavailable");
  assert.equal(capabilities.stripeWebhook.state, "ready");
});

test("independent billing capabilities require their own configuration", () => {
  const capabilities = readiness(
    { ...configured, PAYMENTS_LIVE_WEBHOOK_SECRET: "" },
    "pk_live_Compiled",
  );
  assert.equal(capabilities.stripeCheckout.state, "ready");
  assert.equal(capabilities.stripePortal.state, "ready");
  assert.equal(capabilities.stripeWebhook.state, "unavailable");
  assert.equal(capabilities.stripe.state, "unavailable");
  assert.equal(readiness(configured, "pk_live_Compiled").stripe.state, "ready");
  assert.equal(
    readiness({ ...configured, STRIPE_LIVE_ACCOUNT_ID: "acct_wrong" }, "pk_live_Compiled")
      .stripeCheckout.state,
    "unavailable",
  );
  assert.equal(readiness(configured, "pk_test_Sandbox").stripeCheckout.state, "unavailable");
});

test("browser and readiness read the same compiled value and Docker forwards the build argument", async () => {
  const [browser, sharedConfig, publicConfig, dockerfile] = await Promise.all([
    readFile("src/lib/stripe.ts", "utf8"),
    readFile("src/lib/stripe-browser-config.ts", "utf8"),
    readFile("src/config/public-config.ts", "utf8"),
    readFile("Dockerfile", "utf8"),
  ]);
  assert.match(browser, /const clientToken = COMPILED_PAYMENTS_CLIENT_TOKEN/u);
  assert.match(source, /test\(COMPILED_PAYMENTS_CLIENT_TOKEN\)/u);
  assert.doesNotMatch(source, /runtimeEnv\("VITE_PAYMENTS_CLIENT_TOKEN"\)/u);
  assert.match(sharedConfig, /import\.meta\.env\.VITE_PAYMENTS_CLIENT_TOKEN/u);
  assert.match(publicConfig, /PUBLIC_PAYMENTS_CLIENT_TOKEN = ""/u);
  assert.match(dockerfile, /ARG VITE_PAYMENTS_CLIENT_TOKEN=/u);
  assert.match(
    dockerfile,
    /RUN VITE_PAYMENTS_CLIENT_TOKEN="\$VITE_PAYMENTS_CLIENT_TOKEN"[^\n]+npm run build/u,
  );
});
