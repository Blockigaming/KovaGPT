import test from "node:test";
import assert from "node:assert/strict";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
test("print snapshot is removed at session cleanup and a queued load cannot print old content", () => {
  let frame,
    timer,
    printed = 0;
  const { printDocumentPaper } = loadUiModule(
    "src/lib/print-document.ts",
    {},
    {
      document: {
        createElement: () =>
          (frame = {
            style: {},
            setAttribute() {},
            isConnected: false,
            contentWindow: {
              focus() {},
              print() {
                printed++;
              },
            },
            remove() {
              this.isConnected = false;
              this.srcdoc = "";
            },
          }),
        body: {
          appendChild(f) {
            f.isConnected = true;
          },
        },
      },
      window: {
        setTimeout(fn) {
          timer = fn;
          return 1;
        },
        clearTimeout() {
          timer = null;
        },
      },
    },
  );
  const element = { innerHTML: "<h1>Current title</h1><p>Unsaved draft</p>" };
  const cleanup = printDocumentPaper(element);
  assert.match(frame.srcdoc, /Current title.*Unsaved draft/);
  assert.match(frame.srcdoc, /default-src 'none'/);
  const queuedLoad = frame.onload;
  cleanup();
  queuedLoad();
  assert.equal(printed, 0);
  assert.equal(frame.isConnected, false);
  assert.equal(timer, null);
  const cleanup2 = printDocumentPaper(element);
  frame.onload();
  assert.equal(printed, 1);
  assert.equal(timer, null);
  frame.contentWindow.onafterprint();
  assert.equal(frame.isConnected, false);
  cleanup2();
});
