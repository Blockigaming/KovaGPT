import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import * as catalog from "./review-state-fixtures.mjs";
import {
  FIXTURE_ORIGIN,
  BACKEND_ORIGIN,
  REVIEW_OWNER,
  createFixtureSession,
  loadReviewPackage,
} from "./private-http-review.mjs";
import {
  LIBRARY_PDF_RESOURCE_REVIEW_OPTION as option,
  installLibraryPdfResourceSamples,
} from "./library-pdf-resource-review-fixture.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const selection = {
  account: "pro",
  theme: "dark",
  state: "populated",
  size: "phone",
  path: "/library",
  scenario: option.id,
};
const sampleRows = [],
  originals = installLibraryPdfResourceSamples(sampleRows);
const list = {
  operation: "list",
  query: "",
  sort: "newest",
  filter: "all",
  folder: "all",
  favorites: "",
  cursor: null,
};
const request = (
  session,
  path,
  { method = "GET", body, owner = REVIEW_OWNER, origin = FIXTURE_ORIGIN } = {},
) =>
  session.registry.dispatch({
    url: origin + path,
    method,
    headers: { "x-kova-owner": owner, "content-type": "application/json" },
    body: body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)),
  });
const items = (session) => request(session, "/api/library/items", { method: "POST", body: list });

test("resource option is signed-in HTTP-only and appends four exact samples without changing default or sealed document states", async () => {
  assert.deepEqual(
    catalog.REVIEW_STATE_OPTIONS.find(({ id }) => id === option.id),
    option,
  );
  await assert.rejects(createFixtureSession(pkg, { ...selection, account: "guest" }), /requires/);
  await assert.rejects(catalog.installReviewState({}, option.id, "pro"), /HTTP review adapter/);
  const baseline = await createFixtureSession(pkg, { ...selection, scenario: "default" });
  const ordinary = (await items(baseline)).json.items;
  baseline.dispose();
  const sealed = await createFixtureSession(pkg, {
    ...selection,
    scenario: "library-document-review",
  });
  const sealedBefore = (await items(sealed)).json.items;
  for (const account of ["free", "plus", "pro"]) {
    const session = await createFixtureSession(pkg, { ...selection, account });
    const rows = (await items(session)).json.items;
    assert.deepEqual(
      rows.filter(({ id }) => !originals.has(id)),
      ordinary,
    );
    assert.deepEqual(
      rows.filter(({ id }) => originals.has(id)).sort((a, b) => a.id.localeCompare(b.id)),
      sampleRows,
    );
    session.dispose();
  }
  assert.deepEqual((await items(sealed)).json.items, sealedBefore);
  assert.equal(sealedBefore.filter(({ id }) => originals.has(id)).length, 0);
  sealed.dispose();
});

test("registered detail/original reads preserve exact bytes and independent text; mutations cannot fall through to reusable CRUD", async () => {
  const session = await createFixtureSession(pkg, selection);
  const before = (await items(session)).json.items;
  for (const { item, generation, bytes } of originals.values()) {
    const query = `?id=${item.id}&generation=${generation}`;
    const detail = await request(session, "/api/library/items" + query);
    assert.deepEqual(detail.json, item);
    if (item.file_name === "synthetic-all-blank.pdf") assert.equal(detail.json.content_text, "");
    else assert.match(detail.json.content_text, /Independently authored synthetic saved text/);
    assert.deepEqual((await request(session, "/api/library/files" + query)).body, bytes);
    assert.deepEqual((await request(session, "/api/library/items" + query + "&history=1")).json, {
      supported: false,
      versions: [],
    });
    assert.equal(
      (await request(session, "/api/library/files" + query, { owner: "other" })).status,
      401,
    );
    for (const operation of ["replace_text", "delete", "rename"])
      assert.equal(
        (
          await request(session, "/api/library/items", {
            method: "POST",
            body: {
              operation,
              id: item.id,
              generation,
              revision: 1,
              text: "Rejected fictional draft",
            },
          })
        ).status,
        405,
      );
  }
  for (const [hash, name] of pkg.base.functionNames) {
    if (!/^(renameLibrarySavedItem|saveToLibrary|deleteLibraryItem)_/.test(name)) continue;
    assert.equal(
      (await request(session, "/_serverFn/" + hash, { method: "POST", body: {} })).status,
      405,
    );
  }
  assert.equal(
    (
      await request(session, "/rest/v1/user_library_items", {
        origin: BACKEND_ORIGIN,
        method: "PATCH",
        body: {},
      })
    ).status,
    405,
  );
  assert.equal(
    (
      await request(session, "/storage/v1/object/library-files/sample", {
        origin: BACKEND_ORIGIN,
        method: "POST",
        body: {},
      })
    ).status,
    405,
  );
  assert.deepEqual((await items(session)).json.items, before);
  await request(session, "/auth/v1/logout", { origin: BACKEND_ORIGIN, method: "POST" });
  assert.equal((await items(session)).status, 401);
  const reset = await createFixtureSession(pkg, selection);
  assert.deepEqual((await items(reset)).json.items, before);
  reset.dispose();
});

test("portable helper resolves its exact packaged assets without generator or source-tree dependencies", async () => {
  const names = [
    "README.md",
    "synthetic-all-blank.pdf",
    "synthetic-text-blank-failed.pdf",
    "synthetic-all-page-reads-failed.pdf",
    "synthetic-large-mediabox.pdf",
    "synthetic-101-page-limit.pdf",
    "synthetic-unsupported-cmap.pdf",
  ];
  const packaging = readFileSync(join(root, "review-kit/package.mjs"), "utf8");
  assert.match(packaging, /"library-pdf-resource-review-fixture\.mjs"/);
  for (const name of names) assert.ok(packaging.includes(JSON.stringify(name)));
  const output = mkdtempSync(join(tmpdir(), "kova-pdf-resource-package-"));
  try {
    const assetTarget = join(output, "review-samples/pdf-pages");
    mkdirSync(assetTarget, { recursive: true });
    for (const name of names)
      cpSync(join(root, "review-kit/review-samples/pdf-pages", name), join(assetTarget, name));
    const bundled = join(output, "library-pdf-resource-review-fixture.mjs");
    await build({
      entryPoints: [join(root, "review-kit/library-pdf-resource-review-fixture.mjs")],
      outfile: bundled,
      bundle: true,
      platform: "node",
      format: "esm",
    });
    assert.doesNotMatch(readFileSync(bundled, "utf8"), /pdf-lib|from ["']\.\.\/src\//);
    const portable = await import(pathToFileURL(bundled).href);
    const rows = [];
    const assets = portable.installLibraryPdfResourceSamples(rows);
    assert.deepEqual(rows, sampleRows);
    for (const [id, value] of assets) assert.deepEqual(value.bytes, originals.get(id).bytes);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
