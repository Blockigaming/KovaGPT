import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name) => readFileSync(`src/components/${name}.tsx`, "utf8");
test("standard buttons and dialog Close use20px glyphs and44px targets", () => {
  assert.match(read("ui/button"), /\[&_svg\]:size-5/);
  const dialog = read("ui/dialog");
  assert.match(dialog, /<X className="h-5 w-5"/);
  assert.doesNotMatch(dialog, /sm:h-10 sm:w-10/);
});
test("standard dialog padding is24px and footer adds8px to the16px parent gap", () => {
  const dialog = read("ui/dialog");
  assert.match(dialog, /p-6 pb-\[calc\(1.5rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(dialog, /mt-2 flex min-w-0 flex-col-reverse/);
});
test("temporary-chat context uses a semantic book rather than sparkle decoration", () => {
  const dialog = read("TemporaryChatStartDialog");
  assert.doesNotMatch(dialog, /Sparkles/);
  assert.match(dialog, /BookOpen className="h-5 w-5"/);
});
test("phone toasts occupy the safe top region clear of expanded composers", () => {
  const toaster = read("ui/sonner");
  assert.match(toaster, /mobile \? "top-center" : "bottom-right"/);
  assert.match(toaster, /top: "calc\(72px \+ env\(safe-area-inset-top\)\)"/);
  assert.match(toaster, /left: 16, right: 16/);
  assert.match(toaster, /duration=\{4_000\}/);
});

test("pending schedule, share, upload and rename retain labels with a16px decorative spinner", () => {
  for (const name of ["ScheduledTaskEditor", "ShareChatDialog", "LibraryUploadDialog", "Sidebar"]) {
    const source = read(name);
    assert.match(source, /className="spec400-loading-spinner" aria-hidden="true"/);
    assert.match(source, /Saving…|Sharing…/);
  }
  const css = readFileSync("src/styles/spec400-system.css", "utf8");
  assert.match(css, /\.spec400-loading-spinner\s*\{[^}]*width: 16px;[^}]*height: 16px;/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.spec400-loading-spinner/);
});

test("shared dialog explanatory headers remain left aligned on narrow screens", () => {
  for (const path of ["src/components/ui/dialog.tsx", "src/components/ui/alert-dialog.tsx"]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /text-center sm:text-left/);
    assert.match(source, /text-left/);
  }
});
