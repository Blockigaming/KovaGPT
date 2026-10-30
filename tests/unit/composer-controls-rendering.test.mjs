import * as pdfMetadata from "../../src/lib/document-extraction/pdf-metadata.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as localAttachments from "../../src/lib/composer-local-attachments.mjs";

const nativeRequire = createRequire(import.meta.url);
const empty = () => null;
const signedInAccount = { isLoaded: true, user: { id: "synthetic-user" } };
let account = signedInAccount;
const desktopLayout = { isDesktop: true, isMobile: false, interaction: "pointer" };
const phoneLayout = { isDesktop: false, isMobile: true, interaction: "touch" };
let layout = desktopLayout;
let thinkingUpgradeProps;
let showOptionsContent = false;
const upgradeActions = [];
const jsxRuntime = nativeRequire("react/jsx-runtime");
const captureUpgrade = (factory) => (type, props, key) => {
  if (type === "button" && props?.["data-testid"] === "thinking-upgrade-button")
    thinkingUpgradeProps = props;
  return factory(type, props, key);
};
const closedSurfaces = {
  "@/components/ComposerVoiceDialog": { ComposerVoiceDialog: empty },
  "@/components/ComposerUploadAllowance": { ComposerUploadAllowance: empty },
  "@/components/ComposerContextPanel": { ComposerContextPanel: empty },
  "@/components/ComposerModelStatus": {
    ComposerModelStatus: ({ visible }) =>
      visible ? React.createElement("button", { "data-testid": "model-status" }, "Model") : null,
  },
  "@/components/MobileBottomSheet": { MobileBottomSheet: empty },
  "@/components/ResponsiveModelSelector": { ResponsiveModelSelector: empty },
  "@/components/ComposerDrawingDialog": { ComposerDrawingDialog: empty },
  "@/components/ComposerPluginList": { ComposerPluginList: empty },
};

// Render the actual shared composer. Replace only account, service and closed
// neighboring surfaces; the trailing action and its state conditions are real.
const output = ts.transpileModule(readFileSync("src/components/ChatInput.tsx", "utf8"), {
  fileName: "src/components/ChatInput.tsx",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, {
  exports: module.exports,
  window: {
    dispatchEvent: (event) =>
      upgradeActions.push({ kind: "settings", type: event.type, tab: event.detail.tab }),
  },
  CustomEvent: class {
    constructor(type, { detail }) {
      this.type = type;
      this.detail = detail;
    }
  },
  require(id) {
    if (id === "@/lib/document-extraction/pdf-metadata.mjs") return pdfMetadata;
    if (id === "@/components/ComposerPdfPages") return { ComposerPdfPages: empty };
    if (id === "@/lib/composer-local-attachments.mjs") return localAttachments;
    if (["react", "lucide-react"].includes(id)) return nativeRequire(id);
    if (id === "react/jsx-runtime")
      return {
        ...jsxRuntime,
        jsx: captureUpgrade(jsxRuntime.jsx),
        jsxs: captureUpgrade(jsxRuntime.jsxs),
      };
    if (closedSurfaces[id]) return closedSurfaces[id];
    if (id === "@tanstack/react-router")
      return {
        useNavigate:
          () =>
          ({ to }) =>
            upgradeActions.push({ kind: "navigate", to }),
        Link: ({ to, children, ...props }) =>
          React.createElement("a", { href: to, ...props }, children),
      };
    if (id === "@/components/auth/ClerkSafe")
      return {
        useUser: () => account,
        SignInButton: empty,
      };
    if (id === "@/hooks/use-library-attachment-auto-save")
      return { useLibraryAttachmentAutoSave: () => ({ scope: "synthetic-user" }) };
    if (id === "@/hooks/use-mobile") return { useLayout: () => layout };
    if (id === "@/lib/composer-preferences") return { useSharedSendOnEnter: () => true };
    if (id === "@/lib/modes") return { DAILY_UPLOAD_LIMIT_BY_TIER: { free: 3, plus: 20 } };
    if (id === "@/components/ui/select") {
      const select = nativeRequire("@radix-ui/react-select");
      return {
        Select: select.Root,
        SelectContent: select.Content,
        SelectItem: select.Item,
        SelectTrigger: select.Trigger,
        SelectValue: select.Value,
      };
    }
    if (id === "@/components/ui/dialog") {
      const dialog = nativeRequire("@radix-ui/react-dialog");
      return { Dialog: dialog.Root, DialogTrigger: dialog.Trigger, DialogContent: empty };
    }
    if (id === "@/components/ui/popover") {
      const popover = nativeRequire("@radix-ui/react-popover");
      return {
        Popover: popover.Root,
        PopoverTrigger: popover.Trigger,
        // Expose the actual Options children only in tests inspecting that surface.
        // The default render still reflects the closed toolbar.
        PopoverContent: ({ children, "aria-label": label }) =>
          showOptionsContent && label === "Response options"
            ? React.createElement("div", { role: "dialog", "aria-label": label }, children)
            : null,
      };
    }
    if (
      [
        "@/lib/dialog-return-focus",
        "@/lib/limits",
        "@/lib/composer-keyboard.mjs",
        "sonner",
      ].includes(id)
    )
      return {};
    throw new Error(`Unexpected composer dependency: ${id}`);
  },
});
const render = (
  props = {},
  currentAccount = signedInAccount,
  currentLayout = desktopLayout,
  optionsOpen = false,
) => {
  showOptionsContent = optionsOpen;
  layout = currentLayout;
  account = currentAccount;
  thinkingUpgradeProps = undefined;
  upgradeActions.length = 0;
  return renderToStaticMarkup(
    React.createElement(module.exports.ChatInput, {
      value: "",
      attachments: [],
      isStreaming: false,
      showAddMenu: false,
      onChange() {},
      onSubmit() {
        throw new Error("Render must not submit");
      },
      onStop() {},
      onAttachmentsChange() {},
      ...props,
    }),
  );
};

function assertMicrophoneControls(html, dictateDisabled = false) {
  for (const [id, disabled] of [
    ["dictate", dictateDisabled],
    ["voice", true],
  ]) {
    const button = html.match(new RegExp(`<button\\b[^>]*data-testid="${id}-button"[^>]*>`))?.[0];
    assert.ok(button, `Missing separate ${id} control`);
    assert.equal(/\sdisabled(?:=|\s|>)/.test(button), disabled);
  }
}

test("history initialization blocks Send while the draft remains editable", () => {
  for (const viewport of [desktopLayout, phoneLayout]) {
    const html = render(
      { value: "Keep this first draft", sendDisabled: true },
      signedInAccount,
      viewport,
    );
    const input = html.match(/<textarea\b[^>]*>/)?.[0];
    const send = html.match(/<button\b[^>]*data-testid="send-button"[^>]*>/)?.[0];
    assert.ok(input);
    assert.doesNotMatch(input, /\sdisabled(?:=|\s|>)/);
    assert.match(html, /Keep this first draft<\/textarea>/);
    assert.ok(send);
    assert.match(send, /\sdisabled(?:=|\s|>)/);
  }
});

for (const [name, props, action, disabled] of [
  ["empty draft offers disabled Send", {}, "send", true],
  ["one character offers Send", { value: "a" }, "send", false],
  ["whitespace offers disabled Send", { value: " " }, "send", true],
  ["disabled empty composer cannot send", { disabled: true }, "send", true],
  ["disabled draft cannot send", { value: "a", disabled: true }, "send", true],
  ["streaming empty composer offers Stop", { isStreaming: true }, "stop", false],
  [
    "streaming draft offers Stop even when input is disabled",
    { value: "a", isStreaming: true, disabled: true },
    "stop",
    false,
  ],
  [
    "attachment-only draft offers Send",
    { attachments: [{ kind: "text_file", name: "Notes.txt", dataUrl: "", textContent: "Notes" }] },
    "send",
    false,
  ],
]) {
  test(name, () => {
    const html = render(props);
    const button = html.match(
      new RegExp(`<button\\b[^>]*data-testid="${action}-button"[^>]*>`),
    )?.[0];
    assert.ok(button, `Missing ${action} action`);
    assert.equal(/\sdisabled(?:=|\s|>)/.test(button), disabled);
    assertMicrophoneControls(html, Boolean(props.disabled || props.isStreaming));
    for (const other of ["send", "stop"].filter((item) => item !== action))
      assert.doesNotMatch(html, new RegExp(`data-testid="${other}-button"`));
  });
}

test("uploading and failed attachments retain their submission guard", () => {
  for (const status of ["uploading", "failed"]) {
    const html = render({
      attachments: [{ kind: "text_file", name: "Notes.txt", dataUrl: "", status }],
    });
    const button = html.match(/<button\b[^>]*data-testid="send-button"[^>]*>/)?.[0];
    assert.ok(button);
    assert.match(button, /\sdisabled(?:=|\s|>)/);
    assertMicrophoneControls(html);
    assert.match(
      html,
      status === "uploading"
        ? /Wait for Notes.txt to finish/
        : /Remove or retry Notes.txt before sending/,
    );
  }
});

test("Options points to the shared model picker without an obsolete Thinking upgrade", () => {
  for (const userTier of ["free", "plus", "pro"]) {
    const html = render({ userTier }, signedInAccount, desktopLayout, true);
    assert.match(html, /Choose your model from the bottom of the message box/);
    assert.doesNotMatch(html, /thinking-upgrade-button|Thinking is locked/);
    assert.deepEqual(upgradeActions, []);
  }
});

test("new and populated chats retain the approved Attach, Context, Options toolbar", () => {
  for (const surface of ["empty", "conversation"]) {
    const html = render({ showAddMenu: true, showChooseProject: true, surface });
    assert.match(html, new RegExp(`data-composer-surface="${surface}"`));
    for (const label of ["Message tools", "Attach", "Context", "Options", "Expand input"])
      assert.match(html, new RegExp(`aria-label="${label}"`));
    assert.doesNotMatch(html, /kova-composer-utilities/);
    assertMicrophoneControls(html);
    assert.doesNotMatch(html, /data-testid="thinking-upgrade-button"|data-testid="model-status"/);
  }
});

test("phone chat keeps one growing input and its model status beside the trailing actions", () => {
  for (const userTier of ["free", "plus", "pro"]) {
    const html = render(
      { showAddMenu: true, surface: "conversation", userTier, showModelStatus: true },
      signedInAccount,
      phoneLayout,
    );
    assert.match(html, /data-composer-surface="conversation"/);
    assert.match(html, /aria-label="Attach"/);
    assert.match(html, /aria-label="Options"/);
    assert.equal((html.match(/data-testid="send-button"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /data-testid="stop-button"/);
    assertMicrophoneControls(html);
    assert.doesNotMatch(html, /data-testid="thinking-upgrade-button"/);
    assert.match(html, /data-testid="model-status"/);
    assert.match(html, /rows="1"/);
    assert.match(html, /enterKeyHint="enter"/i);
  }
});

test("the primary composer action switches from Voice to Send without changing its guards", () => {
  for (const viewport of [desktopLayout, phoneLayout]) {
    for (const [value, attachments, primary] of [
      ["", [], "voice"],
      ["   ", [], "voice"],
      ["Keep this draft", [], "send"],
      ["", [{ kind: "text_file", name: "Notes.txt", dataUrl: "", status: "uploading" }], "send"],
    ]) {
      const html = render({ value, attachments }, signedInAccount, viewport);
      const voice = html.match(/<button\b[^>]*data-testid="voice-button"[^>]*>/)?.[0];
      const send = html.match(/<button\b[^>]*data-testid="send-button"[^>]*>/)?.[0];
      assert.ok(voice);
      assert.ok(send);
      assert.equal(/\bhidden=""/.test(voice), primary !== "voice");
      assert.equal(/\bhidden=""/.test(send), primary !== "send");
    }
    const streaming = render({ isStreaming: true, value: "" }, signedInAccount, viewport);
    const stop = streaming.match(/<button\b[^>]*data-testid="stop-button"[^>]*>/)?.[0];
    assert.ok(stop);
    assert.doesNotMatch(stop, /\bhidden=""/);
    assert.doesNotMatch(streaming, /data-testid="send-button"/);
  }
});

test("shared toolbar preserves specialized composer restrictions at every viewport", () => {
  for (const viewport of [
    desktopLayout,
    { isDesktop: false, isMobile: false, interaction: "touch" },
    phoneLayout,
  ]) {
    for (const surface of ["empty", "conversation"]) {
      const html = render({ surface, showAddMenu: false }, signedInAccount, viewport);
      assert.doesNotMatch(html, /aria-label="Attach"|aria-label="Context"/);
      assert.match(html, /aria-label="Options"/);
      assert.match(html, /aria-label="Expand input"/);
      assertMicrophoneControls(html);
    }
  }
});

test("phone composer retains Send, Stop, disabled and attachment contracts", () => {
  for (const [props, action, disabled] of [
    [{}, "send", true],
    [{ value: "A message" }, "send", false],
    [{ value: " " }, "send", true],
    [{ disabled: true }, "send", true],
    [{ value: "A message", disabled: true }, "send", true],
    [{ isStreaming: true, disabled: true }, "stop", false],
    [
      {
        attachments: [{ kind: "text_file", name: "Notes.txt", dataUrl: "", textContent: "Notes" }],
      },
      "send",
      false,
    ],
    [{ value: "First line\nSecond line" }, "send", false],
  ]) {
    const html = render(
      { showAddMenu: true, surface: "conversation", ...props },
      signedInAccount,
      phoneLayout,
    );
    assert.match(html, /data-composer-surface="conversation"/);
    const button = html.match(
      new RegExp(`<button\\b[^>]*data-testid="${action}-button"[^>]*>`),
    )?.[0];
    assert.ok(button, `Missing phone ${action} action`);
    assert.equal(/\sdisabled(?:=|\s|>)/.test(button), disabled);
    assertMicrophoneControls(html, Boolean(props.disabled || props.isStreaming));
    for (const other of ["send", "stop"].filter((item) => item !== action))
      assert.doesNotMatch(html, new RegExp(`data-testid="${other}-button"`));
    if (props.attachments) assert.match(html, /aria-label="Attachments"/);
    if (props.value?.includes("\n")) assert.match(html, /First line\nSecond line<\/textarea>/);
  }
});
