import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name) => readFileSync(`src/components/${name}.tsx`, "utf8");
test("shared buttons and dialog Close follow SDK icon sizes and retain coarse targets", () => {
  const button = read("ui/button");
  assert.ok(button.includes("[&_svg]:size-[18px]"));
  assert.ok(button.includes("[&_svg]:size-5"), "The prominent button has a 20px icon");
  assert.ok(button.includes("[@media(pointer:coarse)]:min-h-11"));
  const dialog = read("ui/dialog");
  for (const token of [
    '<X className="h-[18px] w-[18px]"',
    "h-8 w-8",
    "[@media(pointer:coarse)]:h-11",
    "[@media(pointer:coarse)]:w-11",
  ])
    assert.ok(dialog.includes(token), token);
});
test("shared dialog uses source 20px padding with a wrapping8px footer gap", () => {
  const dialog = read("ui/dialog");
  assert.match(dialog, /bg-popover p-5 text-popover-foreground/);
  assert.match(dialog, /flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:flex-wrap/);
  assert.ok(dialog.includes("max-w-[450px]"));
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
