import assert from "node:assert/strict";
import test from "node:test";
import { validateAzureStagingTemplate } from "../../scripts/azure/validate-staging-template.mjs";

test("staging Azure template is isolated, keyless, observable, and cost bounded", () => {
  const evidence = validateAzureStagingTemplate();
  assert.equal(evidence.runtime, "azure-container-apps-node-server");
  assert.equal(evidence.isolatedIdentity, true);
  assert.equal(evidence.isolatedObservability, true);
  assert.equal(evidence.scaleToZero, true);
  assert.equal(evidence.scheduledJobDefined, true);
  assert.equal(evidence.publicUrlConfigured, true);
  assert.equal(evidence.zeroLovable, true);
});
