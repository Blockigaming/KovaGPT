import assert from "node:assert/strict";
import test from "node:test";
import * as metadata from "../../src/lib/document-extraction/pdf-metadata.mjs";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

function fixture() {
  const hooks = createHookHarness();
  const { ComposerPdfPages } = loadUiModule("src/components/ComposerPdfPages.tsx", {
    react: hooks.react,
    "@/lib/document-extraction/pdf-metadata.mjs": metadata,
  });
  const pdf = {
    pageCount: 4,
    pages: [
      { pageNumber: 1, status: "extracted", text: "One" },
      { pageNumber: 2, status: "no_text" },
      { pageNumber: 3, status: "failed" },
      { pageNumber: 4, status: "extracted", text: "Four" },
    ],
  };
  let selectedPages,
    value = metadata.pdfDocumentText(pdf),
    disabled = false,
    calls = 0;
  const render = () =>
    hooks.render(ComposerPdfPages, {
      pdf,
      selectedPages,
      disabled,
      onSelect: (input) => {
        calls++;
        try {
          const selection = input === null ? undefined : metadata.selectPdfPages(pdf, input);
          value = selection?.text ?? metadata.pdfDocumentText(pdf);
          selectedPages = selection?.pageNumbers;
        } catch (error) {
          return error.message;
        }
      },
    });
  return {
    render,
    pdf,
    value: () => value,
    calls: () => calls,
    input: (input) =>
      elements(render(), (node) => node.type === "input")[0].props.onChange({
        target: { value: input },
      }),
    button: (label) =>
      elements(render(), (node) => node.type === "button" && text(node).includes(label))[0],
    disable: () => {
      disabled = true;
    },
  };
}

test("preview exposes parser counts and separately labels empty pages and real read failures", () => {
  const f = fixture(),
    output = text(f.render()).replace(/\s+/gu, " ");
  assert.match(output, /4 PDF pages.*2 with extracted text/);
  assert.match(output, /Available text pages: 1, 4/);
  assert.match(output, /No extractable text on pages 2/);
  assert.match(output, /may be blank or scanned/);
  assert.match(output, /Text extraction failed on pages 3/);
  assert.match(output, /OCR is not available/);
  assert.match(output, /Saved Library copies are unchanged/);
});

test("invalid selection leaves source intact; successful selection is explicit and Restore returns all local text", () => {
  const f = fixture(),
    original = f.value();
  f.input("1-4");
  f.button("Use selected pages").props.onClick();
  assert.match(text(f.render()), /No available extracted text for pages 2-3/);
  assert.equal(f.value(), original);
  f.input("4");
  f.button("Use selected pages").props.onClick();
  assert.match(text(f.render()), /Sending extracted text from pages 4 of 4 only/);
  assert.match(f.value(), /Four/);
  assert.doesNotMatch(f.value(), /One/);
  assert.equal(f.pdf.pages[0].text, "One");
  f.button("Restore full extraction").props.onClick();
  assert.equal(f.value(), original);
  assert.equal(f.button("Restore full extraction").props.disabled, true);
});

test("disabled controls and Enter cannot alter page selection", () => {
  const f = fixture();
  f.disable();
  f.input("4");
  f.button("Use selected pages").props.onClick();
  const input = elements(f.render(), (node) => node.type === "input")[0];
  input.props.onKeyDown({ key: "Enter", preventDefault() {} });
  assert.equal(f.calls(), 0);
  assert.equal(input.props.disabled, true);
});

test("all-empty observations show no sendable text and no page selection controls", () => {
  const hooks = createHookHarness();
  const { ComposerPdfPages } = loadUiModule("src/components/ComposerPdfPages.tsx", {
    react: hooks.react,
    "@/lib/document-extraction/pdf-metadata.mjs": metadata,
  });
  const tree = hooks.render(ComposerPdfPages, {
    pdf: { pageCount: 1, pages: [{ pageNumber: 1, status: "no_text" }] },
    disabled: true,
    onSelect: () => assert.fail("Cannot select empty text"),
  });
  assert.match(text(tree), /No extracted text can be sent/);
  assert.doesNotMatch(text(tree), /Text extraction failed on pages/);
  assert.equal(elements(tree, (node) => node.type === "input").length, 0);
});
