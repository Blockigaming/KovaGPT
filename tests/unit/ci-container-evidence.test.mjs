import assert from "node:assert/strict";
import test from "node:test";
import { verifyContainerProvenance } from "../../scripts/azure/ci-container-evidence.mjs";

const sha = "1".repeat(40);
const tree = "2".repeat(40);
const image = {
  Id: `sha256:${"3".repeat(64)}`,
  Config: {
    User: "kova",
    Labels: {
      "org.opencontainers.image.revision": sha,
      "com.kovagpt.source.tree": tree,
    },
  },
};
test("CI image evidence binds exact checkout and distinguishes config digest from deployable registry digest", () => {
  const result = verifyContainerProvenance(image, sha, tree);
  assert.equal(result.sourceSha, sha);
  assert.equal(result.imageConfigDigest, image.Id);
  assert.equal(result.registryManifestDigest, null);
  assert.equal(result.productionApproved, false);
});
test("unproven source, tree, image and root runtime cannot become candidate evidence", () => {
  for (const candidate of [
    { ...image, Id: "unknown" },
    { ...image, Config: { ...image.Config, User: "root" } },
    {
      ...image,
      Config: {
        ...image.Config,
        Labels: { ...image.Config.Labels, "com.kovagpt.source.tree": sha },
      },
    },
  ])
    assert.throws(() => verifyContainerProvenance(candidate, sha, tree), /does not match/);
  assert.throws(() => verifyContainerProvenance(image, "unknown", tree), /complete Git/);
});
