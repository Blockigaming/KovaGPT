import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as flows from "../../src/integrations/connection-flows.mjs";
import * as master from "../../src/lib/connector-master-list.mjs";
function load(path, modules = {}) {
  const source = readFileSync(path, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, (id) => {
    assert.ok(id in modules, `Unexpected import: ${id}`);
    return modules[id];
  });
  return exports;
}
const original = load("src/lib/connectors-catalog.ts", {
  "@/integrations/connection-flows.mjs": flows,
});
const provenance = JSON.parse(readFileSync("src/assets/plugins/provenance.json", "utf8"));
const assetModules = Object.fromEntries(
  provenance.assets.map((asset) => [
    `../assets/plugins/${asset.file}`,
    { default: `/local-assets/${asset.file}` },
  ]),
);
const review = load("src/lib/plugin-review-catalog.ts", {
  "@/integrations/connection-flows.mjs": flows,
  "./connectors-catalog": original,
  "./connector-master-list.mjs": master,
  ...assetModules,
});
const expected = [
  "gmail",
  "google-calendar",
  "google-drive",
  "outlook",
  "onedrive",
  "sharepoint",
  "ms-teams",
  "notion",
  "github",
  "linear",
  "slack",
  "salesforce",
];

test("launch review includes exactly 12 providers, preserving original catalog identity", () => {
  assert.deepEqual(
    review.LAUNCH_PLUGIN_REVIEW_CATALOG.map((item) => item.connector.id),
    expected,
  );
  for (const item of review.LAUNCH_PLUGIN_REVIEW_CATALOG) {
    assert.equal(item.connector, original.getConnector(item.connector.id));
    assert.equal("connected" in item, false);
    assert.equal("connectionState" in item, false);
  }
  assert.equal(original.getConnector("sharepoint").status, "setup_required");
});

test("master directory contains the 31 requested services and six retained services exactly once", () => {
  assert.equal(master.USER_REQUESTED_MASTER_CONNECTORS.length, 31);
  assert.equal(master.MASTER_CONNECTORS.length, 37);
  const ids = review.MASTER_PLUGIN_REVIEW_CATALOG.map((item) => item.connector.id);
  assert.deepEqual([...ids].sort(), [...master.MASTER_CONNECTOR_IDS].sort());
  assert.equal(new Set(ids).size, 37);
  for (const item of review.MASTER_PLUGIN_REVIEW_CATALOG) {
    assert.equal(item.connector, original.getConnector(item.connector.id));
    if (!expected.includes(item.connector.id)) {
      assert.deepEqual(item.permissions, []);
      assert.equal(item.brandAsset.status, "generic_placeholder");
      assert.equal(item.brandAsset.src, "");
      assert.equal(item.connector.status === "live", false);
    }
  }
  for (const [id, alias] of [
    ["interactive-brokers", "IBKR"],
    ["outlook", "Outlook Mail"],
    ["custom-mcp", "bring your own server"],
  ]) {
    assert.ok(master.masterConnectorSearchText(id).includes(alias));
  }
  assert.equal(master.masterConnectorSearchText("unknown"), "");
  assert.match(review.getPluginPreviewProvider("apple-health").availabilityNote, /native mobile/);
  assert.match(review.getPluginPreviewProvider("plaid").availabilityNote, /Finances/);
});

test("planned provider permissions are explicitly unconfirmed and carry no invented contracts", () => {
  for (const item of review.LAUNCH_PLUGIN_REVIEW_CATALOG.filter(
    (item) => item.availability === "planned",
  )) {
    assert.equal(item.connector.status, "planned");
    for (const permission of item.permissions) {
      assert.equal(permission.verification, "proposal_unconfirmed");
      assert.deepEqual(permission.sourceFiles, []);
    }
    const preview = review.getPluginPreviewProvider(item.connector.id);
    assert.match(preview.description, /^Planned interface:/);
    assert.ok(preview.readCapabilities.every((label) => label.startsWith("Unconfirmed proposal:")));
    assert.ok(
      preview.writeCapabilities.every((label) => label.startsWith("Unconfirmed proposal:")),
    );
    assert.ok(preview.permissions.every((label) => label.includes("Unconfirmed proposal:")));
    assert.match(preview.availabilityNote, /No connection flow or provider operations are enabled/);
  }
});

test("source-backed capabilities name existing local code and never imply granted authorization", () => {
  for (const item of review.LAUNCH_PLUGIN_REVIEW_CATALOG) {
    for (const permission of item.permissions.filter(
      (permission) => permission.verification === "source_contract",
    )) {
      assert.ok(permission.sourceFiles.length);
      for (const path of permission.sourceFiles) assert.ok(existsSync(path), path);
    }
    assert.match(
      review.getPluginPreviewProvider(item.connector.id).availabilityNote,
      /account grants and action approval/,
    );
  }
  assert.equal(
    review
      .getPluginReview("google-drive")
      .permissions.find((permission) => permission.access === "write").verification,
    "proposal_unconfirmed",
  );
  assert.equal(review.getPluginPreviewProvider("unknown"), undefined);
});

test("all launch marks use verified local assets with preserved package provenance", () => {
  assert.equal(Object.keys(review.PLUGIN_BRAND_ASSET_URLS).length, 12);
  for (const item of review.LAUNCH_PLUGIN_REVIEW_CATALOG) {
    const asset = provenance.assets.find(
      (asset) =>
        asset.id === item.connector.id ||
        (item.connector.id === "ms-teams" && asset.file === "microsoft-teams.svg"),
    );
    assert.ok(asset, item.connector.id);
    assert.equal(item.brandAsset.status, "verified_local_asset");
    assert.equal(item.brandAsset.src, `/local-assets/${asset.file}`);
    assert.equal(item.brandAsset.src, review.PLUGIN_BRAND_ASSET_URLS[item.connector.id]);
    assert.equal(item.brandAsset.provenance, "src/assets/plugins/provenance.json");
    const bytes = readFileSync(`src/assets/plugins/${asset.file}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
  }
  assert.equal(review.PLUGIN_BRAND_ASSET_URLS["ms-teams"], "/local-assets/microsoft-teams.svg");
  const source = readFileSync("src/lib/plugin-review-catalog.ts", "utf8");
  assert.doesNotMatch(source, /fetch\(|https?:\/\/|localStorage|sessionStorage/);
});
