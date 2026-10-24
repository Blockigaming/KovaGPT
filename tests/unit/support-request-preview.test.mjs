import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
const dependencies = { react: {}, "@/lib/dialog-return-focus": {} };
for (const name of ["button", "input", "label", "textarea"])
  dependencies[`@/components/ui/${name}`] = { [name[0].toUpperCase() + name.slice(1)]: name };
const module = loadUiModule("review-kit/components/SupportRequestPreview.tsx", dependencies);
const {
  validateSupportDraft,
  validateSupportAttachments,
  attachmentKey,
  supportPreviewReducer: reduce,
  initialSupportPreviewState: initial,
} = module;
const file = (name = "example.png", size = 1024, type = "image/png", lastModified = 123) => ({
  name,
  size,
  type,
  lastModified,
});
const validDraft = {
  category: "Report a problem",
  email: "review@example.com",
  message: "The button does not open.",
};

test("support draft validates known category, bounded email and meaningful bounded message", () => {
  assert.equal(Object.keys(validateSupportDraft(validDraft)).length, 0);
  const errors = validateSupportDraft({ category: "invented", email: "invalid", message: "  " });
  for (const field of ["category", "email", "message"]) assert.ok(errors[field]);
  assert.ok(validateSupportDraft({ ...validDraft, message: "a".repeat(4001) }).message);
  assert.ok(validateSupportDraft({ ...validDraft, email: `${"a".repeat(250)}@example.com` }).email);
  assert.equal(
    Object.keys(validateSupportDraft({ ...validDraft, email: " review@example.com " })).length,
    0,
  );
});

test("attachment picker rejects unsafe types, extension mismatches, empty and oversized files", () => {
  const cases = [
    file("script.svg", 1, "image/svg+xml"),
    file("fake.png", 1, "application/pdf"),
    file("empty.png", 0),
    file("large.png", 5 * 1024 * 1024 + 1),
    file("unknown.txt", 1, ""),
    file("bad.png", NaN),
  ];
  for (const candidate of cases) {
    const result = validateSupportAttachments([], [candidate]);
    assert.equal(result.accepted.length, 0);
    assert.equal(result.errors.length, 1);
  }
  for (const candidate of [
    file(),
    file("sample.JPG", 1, "image/jpeg"),
    file("sample.pdf", 1, "application/pdf"),
    file("sample.txt", 1, "text/plain"),
  ])
    assert.equal(validateSupportAttachments([], [candidate]).accepted.length, 1);
});

test("duplicate and batch count/total limits are cumulative and preserve accepted files", () => {
  const original = file();
  const duplicate = validateSupportAttachments([original], [file("EXAMPLE.PNG")]);
  assert.equal(duplicate.accepted.length, 1);
  assert.match(duplicate.errors[0], /already added/);
  const many = validateSupportAttachments(
    [],
    [file("a.png"), file("b.png"), file("c.png"), file("d.png")],
  );
  assert.equal(many.accepted.length, 3);
  assert.match(many.errors[0], /up to 3/);
  const large = validateSupportAttachments(
    [],
    [file("a.png", 5 * 1024 * 1024), file("b.png", 5 * 1024 * 1024), file("c.png")],
  );
  assert.equal(large.accepted.length, 2);
  assert.match(large.errors[0], /10 MB/);
});

test("simulated failure preserves draft and attachments; retry, cancellation, success and reset remain local", () => {
  const draft = { ...initial, draft: validDraft, attachments: [file()] };
  const sending = reduce(draft, { type: "submit" });
  assert.equal(sending.stage, "sending");
  assert.equal(reduce(sending, { type: "submit" }), sending);
  assert.equal(reduce(sending, { type: "edit", field: "message", value: "changed" }), sending);
  const failed = reduce(sending, { type: "result", outcome: "error" });
  assert.equal(failed.draft, draft.draft);
  assert.equal(failed.attachments, draft.attachments);
  const retry = reduce(failed, { type: "submit" });
  assert.equal(retry.stage, "sending");
  const canceled = reduce(retry, { type: "cancel" });
  assert.equal(canceled.draft, draft.draft);
  assert.equal(reduce(canceled, { type: "result", outcome: "sent" }), canceled);
  const sent = reduce(reduce(canceled, { type: "submit" }), { type: "result", outcome: "sent" });
  assert.equal(sent.stage, "sent");
  assert.equal(reduce(sent, { type: "reset" }), initial);
});

test("invalid submission stays editable and attachment removal uses the exact metadata key", () => {
  const invalid = reduce(initial, { type: "submit" });
  assert.equal(invalid.stage, "editing");
  assert.equal(Object.keys(invalid.errors).length, 3);
  const a = file("one.png");
  const b = file("two.png");
  const attached = reduce(initial, { type: "attach", files: [a, b] });
  const removed = reduce(attached, { type: "remove", key: attachmentKey(a) });
  assert.equal(removed.attachments.length, 1);
  assert.equal(removed.attachments[0], b);
});

test("review surface uses a native bounded picker and explicitly avoids real transmission", () => {
  const source = readFileSync("review-kit/components/SupportRequestPreview.tsx", "utf8");
  assert.match(source, /type="file"/);
  assert.match(source, /multiple/);
  assert.match(source, /event\.target\.value = ""/);
  assert.match(source, /Nothing is transmitted/);
  assert.match(source, /No support request was actually sent/);
  assert.doesNotMatch(
    source,
    /\bfetch\s*\(|XMLHttpRequest|FileReader|\.arrayBuffer\s*\(|new FormData|\/api\//,
  );
  for (const control of ["Button", "Input", "Label", "Textarea"])
    assert.ok(source.includes(`<${control}`));
});
