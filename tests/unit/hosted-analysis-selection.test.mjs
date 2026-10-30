import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/routes/api/chat.ts", "utf8");
const start = source.indexOf("            const explicitHostedTool =");
const end = source.indexOf("            // Detect image-generation intent", start);
assert.ok(start > 0 && end > start);
// Execute the exact production early-return block. Parsing and authentication
// precede it; quota, model routing, provider calls and files are never real here.
const gate = new Function(
  "clientTool",
  "auth",
  "currentAttachments",
  "runtimeEnv",
  "getAiProviderConfig",
  ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText,
);
const enabled = (name) => (name === "KOVA_OPENAI_SERVICES_ENABLED" ? "true" : undefined);
const run = (tool, { auth = {}, attachments = [], env = enabled, provider = "openai" } = {}) =>
  gate(tool, auth, attachments, env, () => ({ provider }));

test("explicit analysis rejects guests before quota and provider routing", async () => {
  for (const tool of ["data_analysis", "file_analysis"]) {
    const response = run(tool, { auth: null });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "analysis_sign_in_required");
  }
});

test("explicit analysis never silently falls back to ordinary chat when services or generation are disabled", async () => {
  for (const tool of ["data_analysis", "file_analysis"]) {
    for (const override of [
      { env: () => undefined },
      { env: (name) => (name === "KOVA_GENERATION_DISABLED" ? "true" : enabled(name)) },
      { provider: "azure" },
    ]) {
      const response = run(tool, override);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal((await response.json()).code, "hosted_tools_unavailable");
    }
  }
});

test("file analysis requires actual extracted file text rather than any attachment", async () => {
  for (const attachments of [
    [],
    [{ kind: "image", dataUrl: "data:image/png;base64,AAAA" }],
    [{ kind: "library_file", libraryItemId: "opaque-owned-reference" }],
    [{ kind: "text_file", content: "  " }],
  ]) {
    const response = run("file_analysis", { attachments });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "analysis_file_required");
  }
  assert.equal(
    run("file_analysis", {
      attachments: [{ kind: "text_file", content: "Synthetic data\n42" }],
    }),
    undefined,
  );
  assert.equal(run("data_analysis"), undefined);
});

test("ordinary chat and existing tools preserve their prior admission paths", () => {
  for (const tool of [undefined, "web_search", "image", "study"]) {
    assert.equal(
      run(tool, {
        auth: null,
        env: () => undefined,
        provider: "azure",
      }),
      undefined,
    );
  }
});

test("analysis input errors precede quota reservations and selected hosted tools cannot become plain chat", () => {
  for (const marker of [
    'preflight.run("image_quota"',
    'preflight.run("chat_quota"',
    "reserveUploads(",
    "const routeDecision = routeAiModel(",
    "upstream = await chatCompletions(",
  ])
    assert.ok(source.indexOf(marker) > end, marker);
  assert.match(source, /const selectedHostedTool = explicitHostedTool \? clientTool : null;/);
  assert.match(source, /if \(hostedTool\) \{[\s\S]*?upstream = await hostedChatCompletion\(/);
});

test("explicit analysis keeps image-intent heuristics and automatic web search from dispatching another tool", () => {
  const imageStart = source.indexOf("            let isImageRequest =");
  const imageEnd = source.indexOf("            // Detect the owner account", imageStart);
  const imageSelection = new Function(
    "explicitHostedTool",
    "lastText",
    "lastUser",
    "clientTool",
    "detectImageIntent",
    `${source.slice(imageStart, imageEnd)} return isImageRequest;`,
  );
  let imageDetections = 0;
  assert.equal(
    imageSelection(true, "Create an image of the data", {}, "data_analysis", () => {
      imageDetections++;
      return true;
    }),
    false,
  );
  assert.equal(imageDetections, 0);
  assert.equal(
    imageSelection(false, "Create an image", {}, undefined, () => true),
    true,
  );
  assert.match(source, /if \(\s*!explicitHostedTool &&\s*!lockdownBlocksNetwork &&/);
});
