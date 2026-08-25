import assert from "node:assert/strict";
import test from "node:test";
import { validateAzureProductionTemplate } from "../../scripts/azure/validate-production-template.mjs";

test("production Azure template is immutable, keyless, observable, Cloudflare-restricted, and scheduler-ready", () => {
  const evidence = validateAzureProductionTemplate();
  assert.equal(evidence.runtime, "azure-container-apps-node-server");
  assert.equal(evidence.imageUsesDigest, true);
  assert.equal(evidence.exactSourceIdentity, true);
  assert.equal(evidence.managedIdentityRbac, true);
  assert.equal(evidence.cloudflareOnlyOrigin, true);
  assert.equal(evidence.scheduledJobDefined, true);
  assert.equal(evidence.publicUrlConfigured, true);
  assert.equal(evidence.zeroLovable, true);
});
