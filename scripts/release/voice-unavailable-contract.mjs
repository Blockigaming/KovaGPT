import ts from "typescript";

const activeVoicePatterns = [
  /\b(?:SpeechRecognition|webkitSpeechRecognition|SpeechSynthesisUtterance|speechSynthesis|getUserMedia|MediaRecorder)\b/u,
  /\b(?:startListening|stopListening|isListening|voiceMode|toggleDictation|dictating|recognitionRef)\b/u,
  /\bnew\s+Audio\s*\(/u,
  /elevenlabs|xi-api-key|\/api\/(?:voice|audio|speech)\b|audio\/(?:speech|transcriptions)|(?:speech_to_text|text_to_speech|speech_to_speech|realtime_voice)/iu,
  /Dictation is supported/iu,
];
const voiceLabel = /voice|dictat|microphone|read aloud/iu;
const voiceIcons = new Set(["Mic", "MicOff", "AudioLines", "Volume2"]);

/** Historical negative-fixture checker; current production uses the configured boundary below. */
export function inspectUnavailableVoiceSource(source, { allowDisconnectedControl = false } = {}) {
  const errors = activeVoicePatterns
    .filter((pattern) => pattern.test(source))
    .map((pattern) => `active voice/capture/provider contract ${pattern}`);
  const file = ts.createSourceFile(
    "surface.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const elements = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const opening = (node) => (ts.isJsxElement(node) ? node.openingElement : node);
  const tag = (node) => opening(node).tagName.getText(file);
  const attr = (node, name) =>
    opening(node).attributes.properties.find(
      (property) => ts.isJsxAttribute(property) && property.name.getText(file) === name,
    )?.initializer;
  const literal = (node, name) => {
    const value = attr(node, name);
    return value && ts.isStringLiteral(value) ? value.text : undefined;
  };
  const compact = (node) => node?.getText(file).replace(/\s+/gu, "") ?? "";
  const inside = (node, parent) => node.pos >= parent.pos && node.end <= parent.end;
  const ancestor = (node, name) => {
    for (let parent = node.parent; parent; parent = parent.parent)
      if (ts.isJsxElement(parent) && tag(parent) === name) return parent;
    return undefined;
  };
  const approved = new Set();
  if (allowDisconnectedControl) {
    for (const button of elements.filter((node) => tag(node) === "button")) {
      const trigger = ancestor(button, "DialogTrigger");
      const dialog = ancestor(button, "Dialog");
      const hasTitle =
        dialog &&
        elements.some(
          (node) =>
            inside(node, dialog) &&
            tag(node) === "DialogTitle" &&
            ts.isJsxElement(node) &&
            node.children
              .map((child) => child.getText(file))
              .join("")
              .trim() === "Voice is not connected",
        );
      const hasDescription =
        dialog &&
        elements.some(
          (node) =>
            inside(node, dialog) &&
            tag(node) === "DialogDescription" &&
            ts.isJsxElement(node) &&
            node.children
              .map((child) => child.getText(file))
              .join("")
              .replace(/\s+/gu, " ")
              .trim() === "Voice input is not available yet. You can keep typing your message.",
        );
      const nested = elements.filter((node) => inside(node, button));
      const safeAttributes = nested.every((node) =>
        opening(node).attributes.properties.every(
          (property) =>
            ts.isJsxAttribute(property) &&
            (!/^on[A-Z]/u.test(property.name.getText(file)) ||
              (node === button && property.name.getText(file) === "onClick")),
        ),
      );
      if (
        literal(button, "type") === "button" &&
        literal(button, "aria-label") === "Voice (not connected)" &&
        literal(button, "data-testid") === "voice-button" &&
        compact(attr(button, "disabled")) === "{disabled}" &&
        compact(attr(button, "ref")) === "{voiceTriggerRef}" &&
        compact(attr(button, "onClick")) ===
          "{()=>{voiceReturnUrlRef.current=window.location.href;}}" &&
        compact(attr(button, "title")) ===
          '{disabled?"Messagingisunavailable":"Voiceisnotconnected"}' &&
        safeAttributes &&
        nested.filter((node) => tag(node) === "Mic").length === 1 &&
        trigger &&
        opening(trigger).attributes.getText(file).trim() === "asChild" &&
        dialog &&
        opening(dialog).attributes.properties.length === 0 &&
        hasTitle &&
        hasDescription
      )
        approved.add(button);
    }
  }
  for (const node of elements) {
    const name = tag(node);
    if (voiceIcons.has(name) && !(name === "Mic" && approved.has(ancestor(node, "button"))))
      errors.push(`unapproved voice icon ${name}`);
    if (["button", "a"].includes(name)) {
      const labels = [
        attr(node, "aria-label")?.getText(file),
        attr(node, "title")?.getText(file),
        ts.isJsxElement(node)
          ? node.children
              .filter(ts.isJsxText)
              .map((child) => child.text)
              .join(" ")
          : "",
      ].join(" ");
      if (voiceLabel.test(labels) && !approved.has(node))
        errors.push("active or unlabelled voice control");
    }
  }
  return { errors: [...new Set(errors)], disconnectedControlCount: approved.size };
}

function parseVoiceSurface(source) {
  const file = ts.createSourceFile(
    "surface.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const elements = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const opening = (node) => (ts.isJsxElement(node) ? node.openingElement : node);
  const tag = (node) => opening(node).tagName.getText(file);
  const attr = (node, name) =>
    opening(node).attributes.properties.find(
      (property) => ts.isJsxAttribute(property) && property.name.getText(file) === name,
    );
  const literal = (node, name) => {
    const value = attr(node, name)?.initializer;
    return value && ts.isStringLiteral(value) ? value.text : undefined;
  };
  return { file, elements, opening, tag, attr, literal };
}

const browserVoiceBypasses = [
  /\b(?:SpeechRecognition|webkitSpeechRecognition|SpeechSynthesisUtterance|speechSynthesis|getUserMedia|MediaRecorder)\b/u,
  /\bnew\s+Audio\s*\(/u,
  /ELEVENLABS_API_KEY|OPENAI_API_KEY|xi-api-key|api\.elevenlabs\.io|api\.openai\.com/iu,
  /["']\/api\/(?:voice|speech|audio)(?:["'/?]|$)/u,
];

// Production controls delegate capture to one dialog; opening a dialog must not
// directly request a microphone, call a provider or submit a chat message.
export function inspectConfiguredVoiceComposer(source) {
  const { file, elements, opening, tag, attr, literal } = parseVoiceSurface(source);
  const errors = browserVoiceBypasses
    .filter((pattern) => pattern.test(source))
    .map(() => "composer capture/provider boundary bypass");
  const approved = new Set();
  for (const [id, mode, label] of [
    ["dictate-button", "dictate", "Dictate"],
    ["voice-button", "voice", "Voice"],
  ]) {
    const buttons = elements.filter(
      (node) => tag(node) === "button" && literal(node, "data-testid") === id,
    );
    if (buttons.length !== 1) {
      errors.push(`expected one ${id} control`);
      continue;
    }
    const button = buttons[0];
    const click = attr(button, "onClick")?.initializer;
    const handler = click && ts.isJsxExpression(click) ? click.expression : undefined;
    const call = handler && ts.isArrowFunction(handler) ? handler.body : undefined;
    const exactOpen =
      call &&
      ts.isCallExpression(call) &&
      call.expression.getText(file) === "openVoice" &&
      call.arguments.length === 2 &&
      ts.isStringLiteral(call.arguments[0]) &&
      call.arguments[0].text === mode &&
      handler.parameters.length === 1 &&
      call.arguments[1].getText(file) ===
        `${handler.parameters[0].name.getText(file)}.currentTarget`;
    const safeAttributes = opening(button).attributes.properties.every(
      (property) =>
        ts.isJsxAttribute(property) &&
        (!/^on[A-Z]/u.test(property.name.getText(file)) ||
          property.name.getText(file) === "onClick"),
    );
    if (
      literal(button, "type") !== "button" ||
      literal(button, "aria-label") !== label ||
      literal(button, "aria-haspopup") !== "dialog" ||
      !attr(button, "disabled") ||
      !safeAttributes ||
      !exactOpen
    )
      errors.push(`invalid explicit ${mode} dialog trigger`);
    else approved.add(button);
  }
  const dialogs = elements.filter((node) => tag(node) === "ComposerVoiceDialog");
  if (dialogs.length !== 1) errors.push("expected one real ComposerVoiceDialog mount");
  if (dialogs.length === 1) {
    for (const name of [
      "open",
      "onOpenChange",
      "mode",
      "userId",
      "contextKey",
      "disabled",
      "onTranscript",
      "onVoiceSubmit",
      "latestAssistantText",
      "isStreaming",
    ]) {
      const value = attr(dialogs[0], name)?.initializer;
      const expression = value && ts.isJsxExpression(value) ? value.expression : undefined;
      const emptyCallback =
        expression &&
        ts.isArrowFunction(expression) &&
        ts.isBlock(expression.body) &&
        expression.body.statements.length === 0;
      if (
        !expression ||
        /^(?:undefined|null|false|true|["'].*["'])$/u.test(expression.getText(file)) ||
        emptyCallback
      )
        errors.push(`configured voice binding missing: ${name}`);
    }
  }
  const inside = (node, parent) => node.pos >= parent.pos && node.end <= parent.end;
  for (const node of elements) {
    if (voiceIcons.has(tag(node)) && ![...approved].some((button) => inside(node, button)))
      errors.push("unapproved voice icon outside the explicit controls");
    if (["button", "a"].includes(tag(node)) && !approved.has(node)) {
      const labels = [
        attr(node, "aria-label")?.getText(file),
        attr(node, "title")?.getText(file),
        ts.isJsxElement(node)
          ? node.children
              .filter(ts.isJsxText)
              .map((child) => child.text)
              .join(" ")
          : "",
      ].join(" ");
      if (voiceLabel.test(labels)) errors.push("unapproved extra voice control");
    }
  }
  if (/Voice is not connected|Voice \(not connected\)/u.test(source))
    errors.push("obsolete disconnected Voice placeholder");
  return { errors: [...new Set(errors)], configuredControlCount: approved.size };
}

// Route props carry dialog state across the existing composer layouts. They do
// not grant the route capture/provider access or permit unrelated Voice controls.
export function inspectVoiceRouteSource(source) {
  const { elements, opening, tag } = parseVoiceSurface(source);
  const approvedAttributes = [];
  for (const node of elements.filter((node) => tag(node) === "ChatInput")) {
    for (const property of opening(node).attributes.properties) {
      if (ts.isJsxAttribute(property) && property.name.text === "voiceMode")
        approvedAttributes.push(property);
    }
  }
  let remaining = source;
  for (const property of approvedAttributes.sort((a, b) => b.pos - a.pos))
    remaining = remaining.slice(0, property.pos) + remaining.slice(property.end);
  return inspectUnavailableVoiceSource(remaining);
}

export function inspectConfiguredVoiceDialog(source) {
  const errors = [];
  for (const pattern of [
    /ELEVENLABS_API_KEY|OPENAI_API_KEY|xi-api-key|api\.elevenlabs\.io|api\.openai\.com/iu,
    /\b(?:SpeechRecognition|webkitSpeechRecognition|speechSynthesis)\b/u,
    /\bprocess\.env\b|import\.meta\.env/u,
  ]) {
    if (pattern.test(source)) errors.push("browser voice provider/credential bypass");
  }
  for (const token of [
    "getUserMedia",
    "MediaRecorder",
    "/api/voice",
    "X-Kova-Voice-Owner",
    "AbortController",
    "onVoiceSubmit",
    "createSpeechPlayback",
    "contentSha256",
    "pagehide",
    "PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT",
  ]) {
    if (!source.includes(token)) errors.push(`configured voice safety contract missing: ${token}`);
  }
  for (const [label, pattern] of [
    ["explicit recording click", /onClick=\{\(\) => void startRecording\(\)\}/u],
    ["recording capability gate", /!capabilities\.stt/u],
    ["playback capability gate", /!capabilities\.tts/u],
    ["captured owner", /"X-Kova-Voice-Owner": scope\.userId/u],
    ["track cleanup", /track\.stop\(\)/u],
    ["URL cleanup", /URL\.revokeObjectURL\(/u],
  ])
    if (!pattern.test(source)) errors.push(`configured voice safety contract missing: ${label}`);
  return { errors: [...new Set(errors)] };
}

// Source checks supplement runtime tests; they never certify account entitlement
// or live capture/playback. Browser callers must keep credentials and upstream
// transport server-side, while explicit capture stays in the reviewed dialog.
export function inspectBrowserVoiceSource(source, { allowMicrophone = false } = {}) {
  const errors = [];
  for (const pattern of [
    /ELEVENLABS_API_KEY|xi-api-key|api\.elevenlabs\.io/iu,
    /\b(?:SpeechRecognition|webkitSpeechRecognition|SpeechSynthesisUtterance|speechSynthesis)\b/u,
  ]) {
    if (pattern.test(source)) errors.push("browser voice provider/credential bypass");
  }
  if (!allowMicrophone && /\b(?:getUserMedia|MediaRecorder|prepareVoiceRecording)\b/u.test(source))
    errors.push("microphone capture must remain inside the reviewed voice boundary");
  return { errors: [...new Set(errors)] };
}

export function inspectVoiceComposerBoundary(source) {
  const errors = [...inspectBrowserVoiceSource(source).errors];
  if (/\/api\/(?:voice|speech)\b/u.test(source))
    errors.push("composer voice requests must remain inside the reviewed voice boundary");
  const file = ts.createSourceFile(
    "composer.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let mountedDialogCount = 0;
  let voiceControls = 0;
  const visit = (node) => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (opening) {
      const name = opening.tagName.getText(file);
      const props = opening.attributes.properties;
      if (name === "ComposerVoiceDialog") {
        mountedDialogCount++;
        if (props.some(ts.isJsxSpreadAttribute))
          errors.push("mounted voice dialog bindings must not be overwritten by spread props");
        for (const required of [
          "open",
          "onOpenChange",
          "userId",
          "contextKey",
          "disabled",
          "onTranscript",
          "isStreaming",
        ]) {
          const prop = props.find(
            (value) => ts.isJsxAttribute(value) && value.name.getText(file) === required,
          );
          if (!prop?.initializer)
            errors.push(`mounted voice dialog missing explicit ${required} binding`);
        }
      }
      if (name === "button") {
        const labels = props
          .filter(
            (value) =>
              ts.isJsxAttribute(value) &&
              ["aria-label", "title", "data-testid"].includes(value.name.getText(file)),
          )
          .map((value) => value.initializer?.getText(file) ?? "")
          .join(" ");
        if (/voice|dictat|microphone/iu.test(labels)) voiceControls++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (voiceControls > 0 && mountedDialogCount === 0)
    errors.push("voice controls require the configured dialog boundary");
  return { errors: [...new Set(errors)], mountedDialogCount };
}
