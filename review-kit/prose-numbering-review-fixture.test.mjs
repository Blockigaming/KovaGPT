import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import ts from "typescript";
import * as catalog from "./review-state-fixtures.mjs";
import {
  BACKEND_ORIGIN,
  FIXTURE_ORIGIN,
  REVIEW_OWNER,
  REVIEW_PROSE_NUMBERING_CHAT_ID,
  REVIEW_PROSE_NUMBERING_PARAGRAPH,
  REVIEW_PROSE_NUMBERING_COPY,
  REVIEW_PROSE_NUMBERING_FILENAME,
  REVIEW_PROSE_NUMBERING_FILE_TEXT,
  REVIEW_PROSE_NUMBERING_MARKDOWN,
  REVIEW_PROSE_NUMBERING_DISCLOSURE,
  createFixtureSession,
  createConversationFixture,
  FixtureRegistry,
  initialStorage,
  loadReviewPackage,
  reviewConversations,
} from "./private-http-review.mjs";
import { normalizeChatHistory } from "../src/lib/chat-history-policy.mjs";
import * as tableOverflow from "../src/lib/table-overflow.ts";

// In-process fixture dispatch and Markdown parsing only. No socket, browser,
// clipboard, model call, mutation service or application build is exercised.
const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = resolve(process.env.KOVA_REVIEW_PACKAGE ?? "");
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const sealed = await import(pathToFileURL(resolve(packageRoot, "private-http-review.mjs")));
const pkg = { ...(await loadReviewPackage(packageRoot)), state: catalog };
const scenario = "chat-prose-numbering-review";
const selection = {
  account: "free",
  theme: "dark",
  path: "/",
  size: "phone",
  state: "populated",
  scenario,
};
const owner = { "x-kova-owner": REVIEW_OWNER };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const source = (path) => readFileSync(resolve(root, path), "utf8");
const read = (session, query = "", headers = owner) =>
  session.registry.dispatch({ url: `${FIXTURE_ORIGIN}/api/chat/history${query}`, headers });
async function allRecords(session) {
  const records = [];
  let query = "";
  while (true) {
    const response = await read(session, query);
    assert.equal(response.status ?? 200, 200);
    records.push(...response.json.records);
    if (!response.json.hasMore) return records;
    query = `?epoch=${response.json.epoch}&cursor=${response.json.nextCursor}`;
  }
}

test("the scenario adds one isolated exact response without changing either sealed sample", () => {
  for (const existing of ["default", "chat-long-content", "chat-writing-result-review"]) {
    const expected = sealed.reviewConversations(existing);
    if (existing === "chat-long-content") {
      const response = expected.at(-1).messages.at(-1);
      response.content = response.content.replace(
        "```js\n",
        "```js filename=synthetic-workshop-comparison-and-reusable-review-notes-with-a-deliberately-long-filename-for-phone-review.js\n",
      );
    }
    assert.deepEqual(reviewConversations(existing), expected);
  }
  const chats = reviewConversations(scenario);
  assert.deepEqual(chats.slice(0, 2), reviewConversations());
  assert.equal(chats.length, 3);
  const chat = chats.at(-1);
  assert.equal(chat.id, REVIEW_PROSE_NUMBERING_CHAT_ID);
  assert.equal(chat.messages[1].content, REVIEW_PROSE_NUMBERING_MARKDOWN);
  assert.deepEqual(normalizeChatHistory(chat, REVIEW_OWNER), chat);
  assert.equal(REVIEW_PROSE_NUMBERING_PARAGRAPH.length, 1358);
  assert.doesNotMatch(REVIEW_PROSE_NUMBERING_PARAGRAPH, /\n/);
  assert.equal(REVIEW_PROSE_NUMBERING_COPY.length, 1392);
  assert.equal(REVIEW_PROSE_NUMBERING_MARKDOWN.length, 2107);
  for (const [value, expected] of [
    [
      REVIEW_PROSE_NUMBERING_PARAGRAPH,
      "7a17e4fad47ddb47a0124adf787acd6676b8c4aea28cd2e70b35959589557111",
    ],
    [
      REVIEW_PROSE_NUMBERING_COPY,
      "871bfae4a32f77d02e9830c37c17d549f5349a50bd959c9da26770a375232a5d",
    ],
    [
      REVIEW_PROSE_NUMBERING_MARKDOWN,
      "7b6c1673f2327f1ca25f2bb5004a1cec214072bf7167801703ddf5ba486ad3b5",
    ],
  ])
    assert.equal(hash(value), expected);
  chats.at(-1).messages[1].content = "changed";
  assert.equal(
    reviewConversations(scenario).at(-1).messages[1].content,
    REVIEW_PROSE_NUMBERING_MARKDOWN,
  );
});

test("the actual section parser yields one exact copy payload and semantic nested ordered lists", () => {
  const path = "src/components/ResponseMarkdown.tsx";
  // Export the existing private parser in this test module only; production stays untouched.
  const compiled = ts.transpileModule(source(path) + "\nexport { separateTextOutputs };", {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  const native = createRequire(import.meta.url);
  vm.runInNewContext(compiled, {
    exports,
    require(id) {
      if (["react", "react/jsx-runtime", "lucide-react"].includes(id)) return native(id);
      if (id === "react-markdown") return { default: Markdown, defaultUrlTransform };
      if (id === "remark-gfm") return { default: remarkGfm };
      if (id === "./response-output-blocks.css") return {};
      if (id === "@/lib/table-overflow") return tableOverflow;
      if (id === "./ResponseImage")
        return { ResponseImage: () => assert.fail("No image in sample") };
      throw new Error(`Unexpected renderer dependency ${id}`);
    },
  });
  const copied = [];
  const files = [];
  const markup = renderToStaticMarkup(
    React.createElement(
      Markdown,
      {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [exports.separateTextOutputs],
        components: {
          div: ({ node, children }) => {
            if (node.data?.kovaTextOutput) copied.push(node.data.kovaTextOutput);
            return React.createElement("div", null, children);
          },
          pre: ({ node, children }) => {
            files.push({
              filename: node.data?.kovaCodeFilename,
              text: node.children[0]?.children[0]?.value,
            });
            return React.createElement("pre", null, children);
          },
        },
      },
      REVIEW_PROSE_NUMBERING_MARKDOWN,
    ),
  );
  assert.deepEqual(copied, [REVIEW_PROSE_NUMBERING_COPY]);
  assert.deepEqual(files, [
    {
      filename: REVIEW_PROSE_NUMBERING_FILENAME,
      text: REVIEW_PROSE_NUMBERING_FILE_TEXT + "\n",
    },
  ]);
  assert.equal(REVIEW_PROSE_NUMBERING_FILENAME, "synthetic-review-notes.txt");
  assert.equal(
    REVIEW_PROSE_NUMBERING_FILE_TEXT,
    "Fictional reading-room notes\nThis is inert local sample text. No instructions are executed.",
  );
  assert.match(REVIEW_PROSE_NUMBERING_MARKDOWN, /```text filename=synthetic-review-notes\.txt\n/);
  assert.match(markup, /<code class="language-text">Fictional reading-room notes/);
  assert.equal(
    copied[0],
    `## One continuous sample passage\n\n${REVIEW_PROSE_NUMBERING_PARAGRAPH}`,
  );
  assert.doesNotMatch(
    copied[0],
    /Nested ordered outline|Copy text|Sample boundary|Inert named text file|synthetic-review-notes/,
  );
  assert.match(markup, /<h1>Synthetic prose and numbering review<\/h1>/);
  assert.equal((markup.match(/<h2>/g) ?? []).length, 3);
  assert.equal((markup.match(/<ol>/g) ?? []).length, 4);
  assert.equal((markup.match(/<li>/g) ?? []).length, 9);
  assert.match(markup, /<li>Inspect[^]*?<ol>[^]*?<li>Compare[^]*?<ol>/);
  assert.doesNotMatch(markup, /<ul>|<script|<iframe|https?:\/\//);
  assert.match(REVIEW_PROSE_NUMBERING_MARKDOWN, /^   1\. Read/m);
  assert.match(REVIEW_PROSE_NUMBERING_MARKDOWN, /^      1\. Keep/m);
});

test("controller choice, browser seed and owner-bound history agree for every signed-in tier/state", async () => {
  const option = catalog.REVIEW_STATE_OPTIONS.find((entry) => entry.id === scenario);
  assert.equal(option.path, "/");
  assert.match(option.label, /read-only long prose and nested ordered list/);
  assert.deepEqual([...option.accounts], ["free", "plus", "pro"]);
  for (const account of option.accounts)
    for (const state of ["populated", "empty", "loading", "error"]) {
      const selected = { ...selection, account, state };
      const session = await createFixtureSession(pkg, selected);
      const storage = initialStorage(selected);
      assert.equal(
        storage[`nova-gpt-pending-active:v2:user:${REVIEW_OWNER}`],
        REVIEW_PROSE_NUMBERING_CHAT_ID,
      );
      const records = await allRecords(session);
      assert.deepEqual(
        records.map((record) => record.payload),
        JSON.parse(storage[`nova-gpt-conversations-v3:user:${REVIEW_OWNER}`]),
      );
      assert.ok(
        records.every(
          (record) => record.revision === 1 && !record.archived && record.deleted_at === null,
        ),
      );
      assert.equal((await read(session, "", {})).status, 401);
      assert.equal((await read(session, "", { "x-kova-owner": "other-account" })).status, 401);
      assert.equal((await read(session, "?cursor=-1")).status, 400);
      session.dispose();
      assert.equal((await read(session)).status, 401);
    }
  await assert.rejects(createFixtureSession(pkg, { ...selection, account: "guest" }), /requires/);
  await assert.rejects(catalog.installReviewState({}, scenario, "free"), /HTTP review adapter/);
});

test("provider, chat/history, save and unknown mutation requests remain disconnected without changing reads", async () => {
  const session = await createFixtureSession(pkg, selection);
  session.registry.diagnostic = null;
  const initial = await allRecords(session);
  for (const path of [
    "/api/chat",
    "/api/chat/history",
    "/api/chat/confirm",
    "/api/write",
    "/api/memory",
    "/api/library/items",
    "/_serverFn/unknown",
    "/api/unknown",
  ]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await session.registry.dispatch({
        url: FIXTURE_ORIGIN + path,
        method,
        headers: owner,
        body: Buffer.from('{"operation":"save"}'),
      });
      assert.equal(response.status, 503, `${method} ${path}`);
      assert.match(response.json.error, /read-only/);
    }
  }
  assert.deepEqual(await allRecords(session), initial);
  const isolated = new FixtureRegistry();
  await isolated.route(
    "**/api/chat/history",
    createConversationFixture(() => true, scenario),
  );
  assert.equal(
    (
      await isolated.dispatch({
        url: FIXTURE_ORIGIN + "/api/chat/history",
        method: "POST",
        headers: owner,
        body: Buffer.from("{}"),
      })
    ).status,
    503,
  );
  const logout = await session.registry.dispatch({
    url: BACKEND_ORIGIN + "/auth/v1/logout",
    method: "POST",
  });
  assert.equal(logout.status, 204);
  assert.equal((await read(session)).status, 401);
  const reset = await createFixtureSession(pkg, selection);
  assert.equal(
    (await allRecords(reset)).at(-1).payload.messages[1].content,
    REVIEW_PROSE_NUMBERING_MARKDOWN,
  );
  reset.dispose();
});

test("existing portable package registration includes the controller choice, constants and disclosure", async () => {
  const packageSource = source("review-kit/package.mjs");
  assert.match(packageSource, /"private-http-review\.mjs"/);
  assert.match(
    packageSource,
    /entryPoints: \[join\(root, "review-kit\/review-state-fixtures\.mjs"\)\]/,
  );
  const adapter = source("review-kit/private-http-review.mjs");
  assert.match(
    adapter,
    /selected\.scenario === "chat-prose-numbering-review"[^]*?htmlEscape\(REVIEW_PROSE_NUMBERING_DISCLOSURE\)/,
  );
  assert.match(REVIEW_PROSE_NUMBERING_DISCLOSURE, /read-only synthetic response/);
  assert.match(REVIEW_PROSE_NUMBERING_DISCLOSURE, /No provider or real account data/);
  // Compile only these tooling modules in memory, as the package does. No app build.
  for (const file of ["private-http-review.mjs", "review-state-fixtures.mjs"]) {
    const result = await build({
      entryPoints: [resolve(root, "review-kit", file)],
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
      write: false,
    });
    assert.ok(result.outputFiles[0].text.includes(scenario));
    assert.doesNotMatch(result.outputFiles[0].text, /from ["']\.\.\/src\//);
  }
});
