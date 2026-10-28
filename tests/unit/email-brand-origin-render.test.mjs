import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));

async function renderSupportEmail(publicOrigin) {
  const directory = await mkdtemp(join(root, ".email-render-test-"));
  try {
    // Compile the real TSX template, then render the same component as help-submit.
    const result = await build({
      stdin: {
        contents: `
          import * as React from "react";
          import { render } from "@react-email/components";
          import { template } from "./src/lib/email-templates/help-contact-notification";
          export const html = (origin) => render(React.createElement(template.component, {
            publicOrigin: origin, name: "Ada", email: "ada@example.com",
            topic: "Help", message: "Please help", url: "https://untrusted.example/path"
          }));
        `,
        resolveDir: root,
        sourcefile: "email-preview.tsx",
      },
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
      write: false,
      logLevel: "silent",
    });
    const output = join(directory, "preview.mjs");
    await writeFile(output, result.outputFiles[0].contents);
    const { html } = await import(pathToFileURL(output).href);
    return await html(publicOrigin);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("branded support email renders without remote assets and links to direct Azure origin", async () => {
  const origin = "https://kovagpt-prod-web.purpleglacier-b10c3746.eastus.azurecontainerapps.io";
  const html = await renderSupportEmail(origin);
  assert.match(html, /KovaGPT/);
  assert.doesNotMatch(html, /<img\b/iu);
  assert.ok(html.includes(`href="${origin}/privacy"`));
  assert.ok(html.includes(`href="${origin}/terms"`));
  assert.match(html, /href="mailto:support@kovagpt\.com"/u);
  assert.doesNotMatch(html, /https:\/\/kovagpt\.com/u);
  assert.doesNotMatch(html, /href="https:\/\/untrusted\.example/u);
});

test("malformed public origin never becomes a footer link", async () => {
  for (const origin of [
    "https://user@example.com",
    "http://example.com",
    "https://example.com/path",
  ]) {
    const html = await renderSupportEmail(origin);
    assert.doesNotMatch(html, /href="(?:http:|https:)/u);
    assert.match(html, /href="mailto:support@kovagpt\.com"/u);
  }
});
