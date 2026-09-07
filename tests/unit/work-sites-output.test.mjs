import assert from "node:assert/strict";
import test from "node:test";

import {
  compileWorkSiteBundle,
  loadVerifiedWorkSiteOutput,
  parseWorkSiteBundle,
} from "../../src/lib/work-sites-output.mjs";
import { sha256 } from "../../src/lib/sites-policy.mjs";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OUTPUT = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";

const input = {
  kind: "site",
  title: "Launch brief",
  files: [
    { path: "styles.css", content: "body { color: #111; }" },
    { path: "index.html", content: "<!doctype html><title>Launch brief</title>" },
  ],
};

test("Work Site bundles are deterministic, bounded static assets", () => {
  const bytes = compileWorkSiteBundle(input);
  assert.deepEqual(parseWorkSiteBundle(bytes), {
    title: "Launch brief",
    files: [input.files[1], input.files[0]],
  });
  assert.deepEqual(bytes, compileWorkSiteBundle({ ...input, files: [...input.files].reverse() }));
});

test("Work Site bundles reject missing entrypoints, traversal, binary assets and duplicate paths", () => {
  for (const files of [
    [{ path: "styles.css", content: "body{}" }],
    [{ path: "../index.html", content: "bad" }],
    [{ path: "index.png", content: "not an image" }],
    [
      { path: "index.html", content: "first" },
      { path: "INDEX.HTML", content: "second" },
    ],
  ]) {
    assert.throws(() => compileWorkSiteBundle({ kind: "site", title: "Bad", files }));
  }
  assert.throws(() =>
    compileWorkSiteBundle({
      kind: "site",
      title: "Too large after encoding",
      files: ["index.html", "a.css", "b.css", "c.css"].map((path) => ({
        path,
        content: "x".repeat(262130),
      })),
    }),
  );
});

test("Sites imports only the current owner's exact ready Work output bytes", async () => {
  const content = compileWorkSiteBundle(input);
  const digest = await sha256(content);
  const fixture = (overrides = {}) => ({
    readOutput: async () => ({
      id: OUTPUT,
      owner_id: OWNER,
      project_file_id: FILE,
      sha256: digest,
      size_bytes: content.byteLength,
      mime_type: "application/json",
      ...overrides.output,
    }),
    readProjectFile: async () => ({
      id: FILE,
      storage_path: `${OWNER}/${FILE}.json`,
      status: "ready",
      content_sha256: digest,
      size_bytes: content.byteLength,
      mime_type: "application/json",
      ...overrides.file,
    }),
    download: async () => overrides.content ?? content,
  });

  const imported = await loadVerifiedWorkSiteOutput(fixture(), OWNER, OUTPUT);
  assert.equal(imported.title, input.title);
  assert.deepEqual(
    imported.files.map(({ path, type }) => ({ path, type })),
    [
      { path: "index.html", type: "text/html" },
      { path: "styles.css", type: "text/css" },
    ],
  );

  for (const forged of [
    fixture({ output: { owner_id: FILE } }),
    fixture({ output: { mime_type: "text/plain" } }),
    fixture({ file: { status: "pending" } }),
    fixture({ file: { content_sha256: "a".repeat(64) } }),
    fixture({ content: new TextEncoder().encode("changed") }),
  ]) {
    await assert.rejects(loadVerifiedWorkSiteOutput(forged, OWNER, OUTPUT));
  }
});
