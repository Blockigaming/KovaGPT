import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/ca-kovagpt-dev-AutoDeployTrigger-1724b7ba-d38e-4fd3-95e8-bef7f7fbc290.yml",
  "utf8",
);
const step = workflow.slice(
  workflow.indexOf("      - name: Resolve and verify the existing registry destination"),
  workflow.indexOf("      - name: Verify ACR push access before building"),
);
const validator = step.match(/node --input-type=module -e '([\s\S]*?)\n\s*'/u)?.[1];
const subscriptionId = "12345678-1234-1234-1234-123456789abc";
const observation = () => ({
  id: `/subscriptions/${subscriptionId}/resourceGroups/rg-kovagpt-dev/providers/Microsoft.ContainerRegistry/registries/kovagptacr`,
  name: "kovagptacr",
  type: "Microsoft.ContainerRegistry/registries",
  loginServer: "kovagptacr-fixture.azurecr.io",
});

function validate(value) {
  assert.ok(validator, "workflow registry validator is required");
  return execFileSync(process.execPath, ["--input-type=module", "-e", validator], {
    input: JSON.stringify(value),
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 32 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ACR_NAME: "kovagptacr",
      ACR_RESOURCE_GROUP: "rg-kovagpt-dev",
      KOVA_DEV_AZURE_SUBSCRIPTION_ID: subscriptionId,
    },
  });
}

test("dev image destination comes from the validated exact existing registry", () => {
  assert.equal(validate(observation()), "kovagptacr-fixture.azurecr.io");
  assert.match(step, /timeout 30s az acr show/u);
  assert.match(step, /--resource-group "\$ACR_RESOURCE_GROUP"/u);
  assert.match(step, /validateObservedProductionAcr/u);
  assert.match(step, /ACR_LOGIN_SERVER=\$login_server/u);
  assert.doesNotMatch(workflow, /ACR_LOGIN_SERVER:\s*kovagptacr\.azurecr\.io/u);
});

test("dev registry resolution rejects wrong identity and injected destinations", () => {
  for (const mutate of [
    (v) => (v.id = v.id.replace(subscriptionId, "00000000-0000-0000-0000-000000000000")),
    (v) => (v.id = v.id.replace("rg-kovagpt-dev", "rg-other")),
    (v) => (v.name = "otheracr"),
    (v) => (v.type = "Microsoft.App/containerApps"),
    (v) => (v.loginServer = "https://registry.azurecr.io"),
    (v) => (v.loginServer = "registry.azurecr.io.evil.example"),
    (v) => (v.loginServer = "registry.azurecr.io\nINJECTED=value"),
    (v) => delete v.loginServer,
  ]) {
    const value = observation();
    mutate(value);
    assert.throws(() => validate(value));
  }
});

test("registry correction preserves manual main-only deployment and image provenance", () => {
  const trigger = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("permissions:"));
  assert.match(trigger, /workflow_dispatch:/u);
  assert.doesNotMatch(trigger, /\n\s+(?:push|pull_request):/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main' && inputs\.confirm_deploy == true/u);
  assert.match(workflow, /RESOURCE_GROUP: rg-kovagpt-dev/u);
  assert.match(workflow, /CONTAINER_APP_NAME: ca-kovagpt-dev/u);
  assert.match(workflow, /runtime_url" != "\$VITE_SUPABASE_URL/u);
  assert.match(workflow, /digest_image="\$\{ACR_LOGIN_SERVER\}\/\$\{IMAGE_NAME\}@\$\{digest\}"/u);
  assert.match(workflow, /--image "\$\{\{ steps\.image\.outputs\.digest_image \}\}"/u);
});
