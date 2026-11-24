import assert from "node:assert/strict";
import test from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";

import remarkInlineMarks from "../../src/lib/remark-inline-marks.mjs";
import { formatMediaTime, parseMediaTitle } from "../../src/lib/response-media.mjs";
import { normalizeChatPayload } from "../../src/lib/chat-ingress.server.mjs";

async function html(markdown) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkInlineMarks)
    .use(remarkRehype);
  const tree = await processor.run(processor.parse(markdown));
  const render = (node) =>
    node.type === "text"
      ? node.value
      : node.type === "element"
        ? `<${node.tagName}>${node.children.map(render).join("")}</${node.tagName}>`
        : (node.children ?? []).map(render).join("");
  return render(tree);
}

test("highlight, subscript and superscript become elements outside code and links", async () => {
  assert.equal(
    await html("H~2~O, x^2^ and ==key==."),
    "<p>H<sub>2</sub>O, x<sup>2</sup> and <mark>key</mark>.</p>",
  );
  assert.equal(
    await html("`H~2~O` ~~old~~ 2^10 a ~ b [==x==](https://a.b)"),
    "<p><code>H~2~O</code> <del>old</del> 2^10 a ~ b <a>==x==</a></p>",
  );
});

test("media titles carry https captions and sorted chapters only", () => {
  assert.deepEqual(
    parseMediaTitle(
      "captions: https://cdn.example.com/a.vtt; chapters: 1:30 Setup, 0:00 Intro, 1:02:03 End, bad",
    ),
    {
      captions: "https://cdn.example.com/a.vtt",
      chapters: [
        { seconds: 0, label: "Intro" },
        { seconds: 90, label: "Setup" },
        { seconds: 3723, label: "End" },
      ],
    },
  );
  assert.equal(parseMediaTitle("captions: http://x/a.vtt").captions, null);
  assert.equal(parseMediaTitle("captions: javascript:alert(1)").captions, null);
  assert.equal(formatMediaTime(3723), "1:02:03");
  assert.equal(formatMediaTime(65), "1:05");
});

test("a conversation goal is trimmed, bounded and optional", () => {
  const base = { messages: [{ role: "user", content: "Hi" }] };
  assert.equal(normalizeChatPayload({ ...base, goal: "  Ship the PR  " }).goal, "Ship the PR");
  assert.equal(normalizeChatPayload(base).goal, undefined);
  assert.throws(() => normalizeChatPayload({ ...base, goal: "x".repeat(501) }));
  assert.throws(() => normalizeChatPayload({ ...base, goal: 5 }));
});
