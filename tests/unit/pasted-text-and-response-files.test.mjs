import assert from "node:assert/strict";
import test from "node:test";

import {
  isFreePastedText,
  PASTE_CARD_MIN_CHARACTERS,
  PASTE_CARD_MIN_LINES,
  PASTED_TEXT_MAX_CHARACTERS,
  pastePreviewSnippet,
  shouldCardPaste,
} from "../../src/lib/composer-local-attachments.mjs";
import {
  CHAT_MAX_MESSAGE_CHARS,
  ChatIngressError,
  normalizeChatPayload,
} from "../../src/lib/chat-ingress.server.mjs";
import { kovaAttachmentsAllowed } from "../../src/lib/custom-kovas-policy.mjs";
import {
  buildFilePreviewDocument,
  describeFile,
  extractResponseFiles,
  fenceFilename,
  summarizeCreatedFiles,
} from "../../src/lib/response-files.mjs";

const pasted = (content) => ({
  kind: "text_file",
  name: "pasted-text.txt",
  content,
  fileType: "text/plain",
  pasted: true,
});
const payload = (attachments) => ({
  messages: [{ role: "user", content: "Summarize this", attachments }],
});

test("long or tall pastes become a card; short text stays inline", () => {
  assert.equal(shouldCardPaste("hello world"), false);
  assert.equal(shouldCardPaste("   \n\n  "), false);
  assert.equal(shouldCardPaste("x".repeat(PASTE_CARD_MIN_CHARACTERS - 1)), false);
  assert.equal(shouldCardPaste("x".repeat(PASTE_CARD_MIN_CHARACTERS)), true);
  assert.equal(shouldCardPaste("item\n".repeat(PASTE_CARD_MIN_LINES - 2)), false);
  assert.equal(shouldCardPaste("item\n".repeat(PASTE_CARD_MIN_LINES)), true);
});

test("pasted text is message text only up to the typed-message limit", () => {
  assert.equal(PASTED_TEXT_MAX_CHARACTERS, CHAT_MAX_MESSAGE_CHARS);
  assert.equal(isFreePastedText("x".repeat(PASTED_TEXT_MAX_CHARACTERS)), true);
  assert.equal(isFreePastedText("x".repeat(PASTED_TEXT_MAX_CHARACTERS + 1)), false);
});

test("the card face mounts a bounded snippet, never the full paste", () => {
  const text =
    "  # Chemical bonding\r\n\r\n\tIonic bonds transfer electrons.\n" + "NaCl ".repeat(5_000);
  const snippet = pastePreviewSnippet(text);
  assert.ok(snippet.length <= 321);
  assert.ok(snippet.startsWith("# Chemical bonding\n\n  Ionic bonds"));
  assert.ok(snippet.endsWith("…"));
  assert.equal(pastePreviewSnippet("short"), "short");
});

test("ingress keeps the pasted flag within the message limit and drops it above", () => {
  const small = normalizeChatPayload(payload([pasted("a".repeat(5_000))]));
  assert.equal(small.messages[0].attachments[0].pasted, true);
  const large = normalizeChatPayload(payload([pasted("a".repeat(CHAT_MAX_MESSAGE_CHARS + 1))]));
  assert.equal(large.messages[0].attachments[0].pasted, undefined);
  assert.throws(
    () => normalizeChatPayload(payload([{ ...pasted("a"), pasted: "yes" }])),
    (error) => error instanceof ChatIngressError && error.code === "invalid_text_attachment",
  );
});

test("pasted cards do not use the two file slots but have their own cap", () => {
  const file = { kind: "text_file", name: "notes.txt", content: "notes" };
  const four = [1, 2, 3, 4].map((index) => pasted(`paste ${index}`));
  assert.equal(
    normalizeChatPayload(payload([...four, file, file])).messages[0].attachments.length,
    6,
  );
  assert.throws(
    () => normalizeChatPayload(payload([...four, pasted("fifth")])),
    (error) => error instanceof ChatIngressError && error.code === "too_many_pasted_texts",
  );
  assert.throws(
    () => normalizeChatPayload(payload([file, file, file])),
    (error) => error instanceof ChatIngressError && error.code === "too_many_attachments",
  );
});

test("a Kova without file access accepts pasted text but not files", () => {
  const context = { config: { tools: [] } };
  assert.equal(kovaAttachmentsAllowed(context, [{ attachments: [pasted("x")] }]), true);
  assert.equal(
    kovaAttachmentsAllowed(context, [
      { attachments: [pasted("x"), { kind: "text_file", name: "a.txt", content: "a" }] },
    ]),
    false,
  );
});

test("named fences are files; unclosed ones are still being written", () => {
  const reply = [
    "Here is your game.",
    "",
    '```html filename="game.html"',
    "<!doctype html><title>Game</title>",
    "```",
    "",
    "```js",
    "console.log('not a file')",
    "```",
    "",
    "~~~python file=tools/run.py",
    "print('hi')",
  ].join("\n");
  const files = extractResponseFiles(reply);
  assert.deepEqual(
    files.map(({ name, language, complete, category, languageLabel }) => ({
      name,
      language,
      complete,
      category,
      languageLabel,
    })),
    [
      {
        name: "game.html",
        language: "html",
        complete: true,
        category: "Code",
        languageLabel: "HTML",
      },
      {
        name: "run.py",
        language: "python",
        complete: false,
        category: "Code",
        languageLabel: "Python",
      },
    ],
  );
  assert.equal(files[0].title, "Game");
  assert.equal(summarizeCreatedFiles(files), "Created a file");
  assert.equal(summarizeCreatedFiles([]), null);
  assert.equal(fenceFilename('md filename="../../etc/passwd"'), "passwd");
  assert.equal(describeFile("notes.md", "markdown", "# Hi").category, "Document");
});

test("HTML previews always start with a no-network policy before the file's markup", () => {
  const doc = buildFilePreviewDocument({
    language: "html",
    content:
      "<!DOCTYPE html><!-- <head> --><html><head><title>x</title></head><body><script>fetch('https://example.com')</script></body></html>",
  });
  assert.ok(doc.startsWith('<!doctype html><meta charset="utf-8">'));
  const policy = doc.indexOf("Content-Security-Policy");
  assert.ok(policy > 0 && policy < doc.indexOf("<!-- <head> -->"));
  assert.match(doc, /connect-src 'none'/);
  assert.match(doc, /form-action 'none'/);
  assert.doesNotMatch(doc, /<!DOCTYPE html><!--/);
  const svg = buildFilePreviewDocument({
    language: "svg",
    content: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>',
  });
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /script-src 'none'/);
});

test("named PDF fences are document outputs, including an empty blank page", () => {
  const [file] = extractResponseFiles('~~~pdf filename="blank_letter.pdf"\n~~~');
  assert.equal(file.name, "blank_letter.pdf");
  assert.equal(file.language, "pdf");
  assert.equal(file.languageLabel, "PDF");
  assert.equal(file.category, "Document");
  assert.equal(file.mime, "application/pdf");
  assert.equal(file.content, "");
  assert.equal(file.complete, true);
  assert.equal(extractResponseFiles('~~~pdf filename="unfinished.pdf"\ntext')[0].complete, false);
});
