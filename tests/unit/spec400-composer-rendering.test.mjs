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
import { shouldSubmitComposerOnEnter } from "../../src/lib/composer-keyboard.mjs";

const nativeRequire = createRequire(import.meta.url);
const empty = () => null;
const signedInAccount = { isLoaded: true, user: { id: "synthetic-user" } };
let account = signedInAccount;
const desktopLayout = { isDesktop: true, isMobile: false, interaction: "pointer" };
const phoneLayout = { isDesktop: false, isMobile: true, interaction: "touch" };
let layout = desktopLayout;
let thinkingUpgradeProps;
let textareaProps;
const controlProps = new Map();
const upgradeActions = [];
const jsxRuntime = nativeRequire("react/jsx-runtime");
const captureUpgrade = (factory) => (type, props, key) => {
  if (type === "button" && props?.["data-testid"] === "thinking-upgrade-button")
    thinkingUpgradeProps = props;
  if (type === "textarea" && props?.["aria-label"] === "Message KovaGPT") textareaProps = props;
  if (type === "button" && props?.["aria-label"]) controlProps.set(props["aria-label"], props);
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
    if (id === "@/lib/composer-keyboard.mjs") return { shouldSubmitComposerOnEnter };
    if (id === "@/lib/composer-preferences") return { useSharedSendOnEnter: () => true };
    if (id === "@/lib/modes") return { DAILY_UPLOAD_LIMIT_BY_TIER: { free: 3, plus: 20 } };
    if (id === "@/components/ui/dialog") {
      const dialog = nativeRequire("@radix-ui/react-dialog");
      return { Dialog: dialog.Root, DialogTrigger: dialog.Trigger, DialogContent: empty };
    }
    if (id === "@/components/ui/popover") {
      const popover = nativeRequire("@radix-ui/react-popover");
      return { Popover: popover.Root, PopoverTrigger: popover.Trigger, PopoverContent: empty };
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
const render = (props = {}, currentAccount = signedInAccount, currentLayout = desktopLayout) => {
  layout = currentLayout;
  account = currentAccount;
  thinkingUpgradeProps = undefined;
  textareaProps = undefined;
  controlProps.clear();
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

for (const [name, props, expectedDisabled] of [
  ["empty", {}, true],
  ["whitespace", { value: "   " }, true],
  ["valid text", { value: "Draft a note" }, false],
  ["disabled", { value: "Draft a note", disabled: true }, true],
  [
    "ready text attachment",
    {
      attachments: [
        {
          kind: "text_file",
          name: "Notes.txt",
          dataUrl: "",
          textContent: "Notes",
          status: "complete",
        },
      ],
    },
    false,
  ],
  [
    "empty attachment",
    { attachments: [{ kind: "text_file", name: "Notes.txt", dataUrl: "" }] },
    true,
  ],
  [
    "processing attachment",
    { attachments: [{ kind: "text_file", name: "Notes.txt", dataUrl: "", status: "uploading" }] },
    true,
  ],
  [
    "failed attachment",
    { attachments: [{ kind: "text_file", name: "Notes.txt", dataUrl: "", status: "failed" }] },
    true,
  ],
])
  test(`spec400 ${name}: valid submission guard and separate microphone controls`, () => {
    const html = render(props);
    assert.equal(controlProps.get("Send message").disabled, expectedDisabled);
    assert.match(html, /data-testid="send-button"/);
    assert.match(html, /data-testid="dictate-button"/);
    assert.match(html, /data-testid="voice-button"/);
    assert.equal(
      controlProps.get("Dictate").disabled,
      Boolean(props.disabled || props.isStreaming),
    );
    assert.equal(
      controlProps.get("Voice").disabled,
      true,
      "A specialized composer without a saved-chat bridge cannot submit voice",
    );
    assert.doesNotMatch(html, /Deep Research/);
  });

test("spec400 typing stays available during generation and Stop stays visible", () => {
  const html = render({ isStreaming: true, value: "My next question" });
  assert.match(html, /data-testid="stop-button"/);
  assert.doesNotMatch(html, /data-testid="send-button"/);
  assert.equal(textareaProps.disabled, false);
  assert.match(html, /Send it when this response finishes/);
});

test("spec400 desktop and mobile have the same toolbar and exact placeholder", () => {
  for (const device of [desktopLayout, phoneLayout]) {
    const html = render({ showAddMenu: true }, signedInAccount, device);
    for (const label of ["Attach", "Context", "Options", "Expand input", "Send message"])
      assert.ok(controlProps.has(label), label);
    assert.equal(textareaProps.placeholder, "Describe what you need…");
    assert.match(html, /spec400-composer-toolbar/);
  }
});

test("spec400 mobile Enter and modified Enter never submit; desktop Enter and IME stay safe", () => {
  for (const [device, modifiers, composing, expected] of [
    [phoneLayout, {}, false, 0],
    [phoneLayout, { metaKey: true }, false, 0],
    [phoneLayout, { ctrlKey: true }, false, 0],
    [desktopLayout, {}, false, 1],
    [desktopLayout, { shiftKey: true }, false, 0],
    [desktopLayout, { ctrlKey: true }, false, 1],
    [desktopLayout, { metaKey: true }, false, 1],
    [desktopLayout, {}, true, 0],
  ]) {
    let sends = 0;
    render(
      {
        value: "Test draft",
        onSubmit: () => {
          sends += 1;
        },
      },
      signedInAccount,
      device,
    );
    textareaProps.onKeyDown({
      key: "Enter",
      nativeEvent: { keyCode: 13, isComposing: composing },
      preventDefault() {},
      ...modifiers,
    });
    assert.equal(sends, expected);
  }
});

test("spec400 guards repeated activation with the same pending request", () => {
  let sends = 0;
  render({
    value: "Only once",
    onSubmit: () => {
      sends += 1;
      return new Promise(() => {});
    },
  });
  const send = controlProps.get("Send message").onClick;
  send();
  send();
  assert.equal(sends, 1);
});

test("Send next is explicit, bounded and never submitted by incidental typing or Enter", () => {
  let queued = 0;
  const html = render({
    value: "Next prompt",
    isStreaming: true,
    onSendNext: () => {
      queued++;
      return true;
    },
  });
  assert.match(html, />Send next</);
  assert.equal(textareaProps.disabled, false);
  textareaProps.onKeyDown({ key: "Enter", nativeEvent: { keyCode: 13 }, preventDefault() {} });
  assert.equal(queued, 0);
  const next = controlProps.get("Send next");
  assert.equal(next.disabled, false);
  next.onClick();
  next.onClick();
  assert.equal(queued, 1);
  assert.ok(controlProps.has("Stop generating"));
  render({
    value: "Later draft",
    isStreaming: true,
    onSendNext: () => true,
    sendNextDisabled: true,
  });
  assert.equal(controlProps.get("Send next").disabled, true);
});

test("Send next keeps mobile text label visible and respects failed attachment and guest gates", () => {
  let queued = 0;
  const html = render(
    {
      value: "Next prompt",
      isStreaming: true,
      onSendNext: () => {
        queued++;
        return true;
      },
    },
    signedInAccount,
    phoneLayout,
  );
  assert.match(html, />Send next</);
  assert.doesNotMatch(controlProps.get("Send next").className, /spec400-send-button/);
  render({
    value: "File",
    isStreaming: true,
    onSendNext: () => {
      queued++;
      return true;
    },
    attachments: [
      { kind: "text_file", dataUrl: "", textContent: "text", name: "failed.txt", status: "failed" },
    ],
  });
  assert.equal(controlProps.get("Send next").disabled, true);
  controlProps.get("Send next").onClick();
  assert.equal(queued, 0);
  render(
    {
      value: "Guest file",
      isStreaming: true,
      onSendNext: () => {
        queued++;
        return true;
      },
      attachments: [
        {
          kind: "text_file",
          dataUrl: "",
          textContent: "text",
          name: "file.txt",
          status: "complete",
        },
      ],
    },
    { isLoaded: true, user: null },
  );
  controlProps.get("Send next").onClick();
  assert.equal(queued, 0);
});

test("request recovery stays beside the editable composer without submitting or clearing its draft", () => {
  const html = render({
    value: "Unsent draft",
    requestStatusPanel: React.createElement("p", { role: "status" }, "Session needs attention"),
  });
  assert.match(html, /Session needs attention/);
  assert.match(html, /Unsent draft<\/textarea>/);
  assert.ok(html.indexOf("Session needs attention") < html.indexOf('class="spec400-composer"'));
  assert.equal(textareaProps.disabled, false);
});

test("request-status rendering receives the same nonempty-draft protection as composer sign-in", () => {
  for (const props of [
    { value: " " },
    { attachments: [{ kind: "text_file", name: "Unsent.txt", dataUrl: "", textContent: "Text" }] },
    {},
  ]) {
    let pending;
    render({
      ...props,
      requestStatusPanel: (value) => {
        pending = value;
        return null;
      },
    });
    assert.equal(pending, Boolean(props.value?.length || props.attachments?.length));
  }
});
