import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as principalStorage from "../../src/lib/principal-browser-storage.mjs";
import { createSpeechPlayback, stopActiveSpeechPlayback } from "../../src/lib/speech-playback.mjs";
import { createHash, webcrypto } from "node:crypto";
import { createHookHarness, elements, loadUiModule, settle } from "../helpers/ui-state-harness.mjs";

const compiled = ts.transpileModule(
  readFileSync("src/components/ComposerVoiceDialog.tsx", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
const compiledView = ts.transpileModule(
  readFileSync("src/components/ComposerVoiceDialogView.tsx", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
const compiledInlineView = ts.transpileModule(
  readFileSync("src/components/ComposerDictationView.tsx", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
const text = (node) =>
  node == null || typeof node === "boolean"
    ? ""
    : Array.isArray(node)
      ? node.map(text).join("")
      : typeof node === "object"
        ? text(node.props?.children)
        : String(node);
const nodes = (node) =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(nodes)
      : [node, ...nodes(node.props?.children)];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function waitForRequest(f, count) {
  const deadline = Date.now() + 5000;
  while (f.requests.length < count && Date.now() < deadline) await f.flush();
  assert.equal(f.requests.length, count, `Expected ${count} authenticated request(s)`);
  return f.requests.at(-1);
}
const configured = {
  configured: true,
  stt: true,
  tts: true,
  sts: false,
  conversation: true,
  voices: [
    { id: "default", label: "Default voice", available: true },
    { id: "warm", label: "Warm voice", available: true },
    { id: "locked", label: "Locked voice", available: false },
  ],
  defaultVoiceId: "default",
};
const voiceKey = (owner) =>
  principalStorage.principalScopedStorageKey("kova-voice-selection-v1", owner);

// Execute actual component callbacks with controlled hooks and web APIs, as in
// the repository's existing component runtime harnesses. No real microphone,
// browser permission, provider call, account, credential, or charge is involved.
function fixture(initial = {}, options = {}) {
  const hooks = [],
    effects = [],
    requests = [],
    microphoneRequests = [],
    recorders = [],
    preparations = [],
    voiceSubmissions = [],
    playbackSinks = [];
  const timers = new Map(),
    urls = [],
    revoked = [],
    submitted = [],
    closed = [],
    dispatched = [],
    storageWrites = [],
    storageReads = [];
  const storage = options.storage ?? new Map();
  const listeners = new Map();
  const fakeWindow = {
    get localStorage() {
      if (options.storageUnavailable) throw new Error("Storage getter denied");
      return {
        getItem(key) {
          storageReads.push(key);
          if (options.storageReadError) throw new Error("Storage read denied");
          return storage.get(key) ?? null;
        },
        setItem(key, value) {
          if (options.storageWriteError) throw new Error("Storage full");
          storageWrites.push([key, value]);
          storage.set(key, String(value));
        },
        removeItem(key) {
          if (options.storageRemoveError) throw new Error("Storage removal denied");
          storage.delete(key);
        },
      };
    },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    dispatchEvent(event) {
      dispatched.push(event);
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
  };
  let cursor = 0,
    dirty = true,
    tree,
    timerId = 0,
    mounted = true;
  let props = {
    open: true,
    userId: "owner-a",
    contextKey: "chat-a",
    disabled: false,
    isStreaming: false,
    latestAssistantText: "A completed reply.",
    latestAssistantReply: {
      chatId: "chat-a",
      messageId: "saved-assistant-a",
      content: "A completed reply.",
    },
    onTranscript: (value) => submitted.push(value),
    onVoiceSubmit: (value, signal) => {
      const pending = deferred();
      voiceSubmissions.push({ value, signal, ...pending });
      return pending.promise;
    },
    onOpenChange: (value) => closed.push(value),
    ...initial,
  };
  const react = {
    useId() {
      return `voice-id-${cursor++}`;
    },
    useState(initialValue) {
      const index = cursor++;
      hooks[index] ??= { value: initialValue };
      return [
        hooks[index].value,
        (next) => {
          const value = typeof next === "function" ? next(hooks[index].value) : next;
          if (!Object.is(value, hooks[index].value)) {
            hooks[index].value = value;
            dirty = true;
          }
        },
      ];
    },
    useRef(value) {
      const index = cursor++;
      hooks[index] ??= { current: value };
      return hooks[index];
    },
    useCallback(value, dependencies) {
      const index = cursor++,
        prior = hooks[index];
      if (!prior || dependencies.some((value, i) => !Object.is(value, prior.dependencies[i])))
        hooks[index] = { value, dependencies };
      return hooks[index].value;
    },
    useLayoutEffect(run, dependencies) {
      const index = cursor++,
        prior = hooks[index];
      if (!prior || dependencies.some((value, i) => !Object.is(value, prior.dependencies[i]))) {
        hooks[index] = { dependencies, cleanup: prior?.cleanup };
        effects.push(() => {
          hooks[index].cleanup?.();
          hooks[index].cleanup = run();
        });
      }
    },
  };
  const jsx = (type, props) =>
    typeof type === "function" ? type(props ?? {}) : { type, props: props ?? {} };
  class FakeRecorder {
    static isTypeSupported(type) {
      return type.startsWith("audio/webm");
    }
    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = options.mimeType;
      this.state = "inactive";
      recorders.push(this);
    }
    start(timeslice) {
      this.state = "recording";
      this.timeslice = timeslice;
    }
    emit(size = 16) {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(size)], { type: this.mimeType }) });
    }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => {
        this.emit();
        this.onstop?.();
      });
    }
  }
  const player = {
    paused: 0,
    removed: 0,
    loaded: 0,
    pause() {
      this.paused++;
    },
    removeAttribute() {
      this.removed++;
    },
    load() {
      this.loaded++;
    },
  };
  const modules = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": {},
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/textarea": { Textarea: "textarea" },
    "./composer-voice.css": {},
    "@/components/ui/popover": Object.fromEntries(
      ["Popover", "PopoverContent", "PopoverTrigger"].map((name) => [name, name]),
    ),
    "@/components/ui/dialog": Object.fromEntries(
      [
        "Dialog",
        "DialogContent",
        "DialogDescription",
        "DialogFooter",
        "DialogHeader",
        "DialogTitle",
      ].map((name) => [name, name]),
    ),
    "@/components/ui/select": Object.fromEntries(
      ["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"].map((name) => [
        name,
        name,
      ]),
    ),
    "@/lib/principal-browser-storage.mjs": {
      ...principalStorage,
      safeBrowserStorage: (area) => principalStorage.safeBrowserStorage(area, fakeWindow),
    },
    "@/lib/voice-recording": {
      prepareVoiceRecording(blob, { signal }) {
        const pending = deferred();
        preparations.push({ blob, signal, ...pending });
        if (options.holdPreparation) return pending.promise;
        if (options.preparationError) return Promise.reject(new Error(options.preparationError));
        return Promise.resolve(new Blob(["canonical wav fixture"], { type: "audio/wav" }));
      },
    },
    "@/lib/speech-playback.mjs": {
      createSpeechPlayback,
      stopActiveSpeechPlayback,
      createBrowserSpeechSink(options) {
        const sink = {
          options,
          writes: [],
          ended: 0,
          disposed: 0,
          async write(bytes) {
            this.writes.push(bytes);
            options.onPlaying();
          },
          async end() {
            this.ended++;
          },
          dispose() {
            this.disposed++;
          },
        };
        playbackSinks.push(sink);
        return sink;
      },
    },
    "@/lib/auth-fetch": {
      authFetch(url, init) {
        const pending = deferred();
        requests.push({ url, init, ...pending });
        return pending.promise;
      },
    },
  };
  const viewExports = {};
  vm.runInNewContext(compiledView, {
    exports: viewExports,
    require(name) {
      assert.ok(name in modules, `Unexpected view import: ${name}`);
      return modules[name];
    },
  });
  modules["@/components/ComposerVoiceDialogView"] = viewExports;
  const inlineViewExports = {};
  vm.runInNewContext(compiledInlineView, {
    exports: inlineViewExports,
    require(name) {
      assert.ok(name in modules, `Unexpected inline view import: ${name}`);
      return modules[name];
    },
  });
  modules["@/components/ComposerDictationView"] = inlineViewExports;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      assert.ok(name in modules, `Unexpected import: ${name}`);
      return modules[name];
    },
    AbortController,
    Event,
    Blob,
    File,
    FormData,
    Error,
    Date,
    crypto: webcrypto,
    TextEncoder,
    console,
    window: fakeWindow,
    CustomEvent: class {
      constructor(type, { detail }) {
        this.type = type;
        this.detail = detail;
      }
    },
    MediaRecorder: options.unsupported ? undefined : FakeRecorder,
    navigator: {
      mediaDevices: {
        getUserMedia(constraints) {
          options.onMicrophoneRequest?.();
          const pending = deferred();
          microphoneRequests.push({ constraints, ...pending });
          return pending.promise;
        },
      },
    },
    URL: {
      createObjectURL(blob) {
        const url = `blob:voice-${urls.length}`;
        urls.push({ url, blob });
        return url;
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay, interval: true });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
  });
  function render() {
    cursor = 0;
    dirty = false;
    tree = exports.ComposerVoiceDialog(props);
    for (const node of nodes(tree)) if (node.type === "audio") node.props.ref.current = player;
    while (effects.length) effects.shift()();
  }
  async function flush() {
    for (let i = 0; i < 10; i++) {
      await new Promise(setImmediate);
      if (dirty && mounted) render();
    }
  }
  function control(label) {
    const found = nodes(tree).find((node) => node.type === "button" && text(node).trim() === label);
    assert.ok(found, `Missing button ${label}; visible: ${text(tree)}`);
    return found.props;
  }
  function trackStream() {
    const tracks = [
      {
        stopped: 0,
        stop() {
          this.stopped++;
        },
      },
      {
        stopped: 0,
        stop() {
          this.stopped++;
        },
      },
    ];
    return { tracks, getTracks: () => tracks };
  }
  render();
  return {
    requests,
    preparations,
    voiceSubmissions,
    playbackSinks,
    microphoneRequests,
    recorders,
    timers,
    urls,
    revoked,
    submitted,
    closed,
    player,
    storage,
    storageWrites,
    storageReads,
    dispatched,
    dispatch: (event) => fakeWindow.dispatchEvent(event),
    async chooseVoice(id) {
      const picker = nodes(tree).find((node) => node.type === "Select");
      assert.ok(picker, "Voice picker should be visible");
      picker.props.onValueChange(id);
      await flush();
    },
    selectedVoice: () => nodes(tree).find((node) => node.type === "Select")?.props.value,
    flush,
    control,
    text: () => text(tree),
    nodes: () => nodes(tree),
    trackStream,
    async ready(value = configured) {
      requests[0].resolve(Response.json(value));
      await flush();
    },
    async click(label) {
      const action = control(label);
      assert.ok(!action.disabled, `${label} should be enabled`);
      action.onClick();
      await flush();
    },
    async update(next) {
      props = { ...props, ...next };
      dirty = true;
      await flush();
    },
    async acquire() {
      const acquired = trackStream();
      microphoneRequests.at(-1).resolve(acquired);
      await flush();
      return acquired;
    },
    async recordToRequest() {
      await this.click(
        this.nodes().some((node) => node.type === "textarea") ? "Record again" : "Start recording",
      );
      const acquired = await this.acquire();
      await this.click("Stop and transcribe");
      return acquired;
    },
    async timer(delay) {
      const [id, timer] =
        [...timers].find(([, timer]) => timer.delay === delay && !timer.interval) ?? [];
      assert.ok(timer, `Missing timer ${delay}`);
      timers.delete(id);
      timer.callback();
      await flush();
    },
    unmount() {
      mounted = false;
      for (const hook of hooks) hook?.cleanup?.();
    },
  };
}

test("opening, guests, missing configuration, and playback-only setup never request a microphone", async () => {
  const guest = fixture({ userId: null });
  await guest.flush();
  assert.equal(guest.requests.length, 0);
  assert.match(guest.text(), /Sign in/);
  const absent = fixture();
  await absent.ready({ configured: false, stt: false, tts: false });
  assert.equal(absent.microphoneRequests.length, 0);
  assert.match(absent.text(), /Voice is not available yet/);
  const playback = fixture();
  await playback.ready({ ...configured, stt: false });
  assert.equal(playback.control("Start recording").disabled, true);
  assert.equal(playback.control("Read latest completed reply").disabled, false);
  playback.control("Start recording").onClick();
  await playback.flush();
  assert.equal(playback.microphoneRequests.length, 0);
  const normal = fixture();
  await normal.ready();
  assert.equal(normal.microphoneRequests.length, 0);
  await normal.click("Start recording");
  assert.equal(normal.microphoneRequests.length, 1);
  guest.unmount();
  absent.unmount();
  playback.unmount();
  normal.unmount();
});

test("recording submits authenticated multipart, reviews edits, and only inserts after Use in chat", async () => {
  const f = fixture();
  await f.ready();
  const stream = await f.recordToRequest();
  assert.ok(stream.tracks.every((track) => track.stopped > 0));
  const call = f.requests.at(-1);
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["X-Kova-Voice-Owner"], "owner-a");
  assert.equal(call.init.body.get("action"), "stt");
  assert.ok(call.init.body.get("audio") instanceof Blob);
  assert.equal(call.init.body.get("audio").name, "recording.wav");
  assert.equal(call.init.body.get("audio").type, "audio/wav");
  call.resolve(Response.json({ text: "Original text" }));
  await f.flush();
  assert.deepEqual(f.submitted, []);
  let input = f.nodes().find((node) => node.type === "textarea").props;
  input.onChange({ target: { value: "" } });
  await f.flush();
  assert.ok(
    f.nodes().some((node) => node.type === "textarea"),
    "Empty review remains editable",
  );
  assert.equal(f.control("Use in chat").disabled, true);
  input = f.nodes().find((node) => node.type === "textarea").props;
  input.onChange({ target: { value: "  Reviewed text  " } });
  await f.flush();
  const useReviewed = f.control("Use in chat");
  useReviewed.onClick();
  useReviewed.onClick();
  await f.flush();
  assert.deepEqual(f.submitted, ["Reviewed text"]);
  assert.deepEqual(f.closed, [false]);
  f.unmount();
});

for (const change of [{ userId: "owner-b" }, { contextKey: "chat-b" }, { open: false }]) {
  test(`stale capability/transcription results cannot escape ${JSON.stringify(change)}`, async () => {
    const config = fixture();
    const old = config.requests[0];
    await config.update(change);
    assert.equal(old.init.signal.aborted, true);
    old.resolve(Response.json(configured));
    await config.flush();
    assert.ok(
      !config
        .nodes()
        .some((node) => node.type === "button" && text(node).trim() === "Start recording"),
    );
    config.unmount();
    const f = fixture();
    await f.ready();
    await f.recordToRequest();
    const pending = f.requests.at(-1);
    await f.update(change);
    assert.equal(pending.init.signal.aborted, true);
    pending.resolve(Response.json({ text: "Stale secret transcript" }));
    await f.flush();
    assert.doesNotMatch(f.text(), /Stale secret transcript/);
    assert.deepEqual(f.submitted, []);
    f.unmount();
  });
}

test("cancelled microphone prompts stop every late-acquired track and do not record", async () => {
  const f = fixture();
  await f.ready();
  await f.click("Start recording");
  await f.click("Cancel");
  const stream = await f.acquire();
  assert.ok(stream.tracks.every((track) => track.stopped > 0));
  assert.equal(f.recorders.length, 0);
  assert.equal(f.requests.length, 1);
  f.unmount();
});

test("cancel and unmount stop recording tracks, discard chunks, and prevent transcription", async () => {
  for (const unmount of [false, true]) {
    const f = fixture();
    await f.ready();
    await f.click("Start recording");
    const stream = await f.acquire();
    f.recorders[0].emit();
    if (unmount) {
      f.unmount();
      await f.flush();
    } else await f.click("Cancel");
    assert.equal(f.recorders[0].state, "inactive");
    assert.ok(stream.tracks.every((track) => track.stopped > 0));
    assert.equal(f.requests.length, 1);
    assert.equal(f.timers.size, 0);
    f.unmount();
  }
});

test("cancel aborts transcription and ignores its late success", async () => {
  const f = fixture();
  await f.ready();
  await f.recordToRequest();
  const pending = f.requests.at(-1);
  await f.click("Cancel");
  assert.equal(pending.init.signal.aborted, true);
  pending.resolve(Response.json({ text: "Cancelled transcript" }));
  await f.flush();
  assert.doesNotMatch(f.text(), /Cancelled transcript/);
  assert.deepEqual(f.submitted, []);
  f.unmount();
});

test("59-second capture deadline leaves codec headroom and the 8 MiB limit rejects oversized recordings", async () => {
  const f = fixture();
  await f.ready();
  await f.click("Start recording");
  const stream = await f.acquire();
  await f.timer(59_000);
  assert.equal(f.recorders[0].state, "inactive");
  assert.ok(stream.tracks.every((track) => track.stopped > 0));
  assert.equal(f.requests.length, 2);
  f.requests.at(-1).resolve(Response.json({ text: "Keep this draft" }));
  await f.flush();
  await f.click("Record again");
  await f.acquire();
  f.recorders.at(-1).emit(8 * 1024 * 1024 + 1);
  await f.flush();
  assert.match(f.text(), /8 MB limit/);
  assert.equal(f.requests.length, 2);
  assert.equal(f.nodes().find((node) => node.type === "textarea").props.value, "Keep this draft");
  f.unmount();
});

test("request timeout preserves reviewed text, and errors are readable without leaking raw server content", async () => {
  const f = fixture();
  await f.ready();
  await f.recordToRequest();
  f.requests.at(-1).resolve(Response.json({ text: "Keep me" }));
  await f.flush();
  await f.recordToRequest();
  const pending = f.requests.at(-1);
  await f.timer(60_000);
  assert.equal(pending.init.signal.aborted, true);
  pending.reject(new Error("abort"));
  await f.flush();
  assert.match(f.text(), /timed out/);
  assert.equal(f.nodes().find((node) => node.type === "textarea").props.value, "Keep me");
  f.unmount();
  for (const [status, error, expected] of [
    [403, "email_verification_required", /Verify your email/],
    [409, "account_changed", /account changed/],
    [429, "quota_exceeded", /usage limit/],
    [503, "voice_not_configured", /Voice is not available yet/],
    [502, "secret-provider-key", /unavailable/],
  ]) {
    const failed = fixture();
    failed.requests[0].resolve(Response.json({ error }, { status }));
    await failed.flush();
    assert.match(failed.text(), expected);
    assert.doesNotMatch(failed.text(), new RegExp(error));
    failed.unmount();
  }
});

test("unsupported browsers and denied permission fail without a recording or upload", async () => {
  const unsupported = fixture({}, { unsupported: true });
  await unsupported.ready();
  await unsupported.click("Start recording");
  assert.match(unsupported.text(), /does not support/);
  assert.equal(unsupported.microphoneRequests.length, 0);
  unsupported.unmount();
  const denied = fixture();
  await denied.ready();
  await denied.click("Start recording");
  denied.microphoneRequests[0].reject(
    Object.assign(new Error("denied"), { name: "NotAllowedError" }),
  );
  await denied.flush();
  assert.match(denied.text(), /access was denied/);
  assert.equal(denied.requests.length, 1);
  assert.equal(denied.recorders.length, 0);
  denied.unmount();
});

test("Dictate reads only the exact saved model-proven reply and stops playback on scope changes", async () => {
  for (const change of [
    { open: false },
    { contextKey: "new-chat" },
    { userId: "new-owner" },
    { latestAssistantText: "A newer completed reply.", latestAssistantReply: undefined },
  ]) {
    const f = fixture();
    await f.ready({ ...configured, stt: false });
    assert.equal(f.requests.length, 1);
    await f.click("Read latest completed reply");
    const call = await waitForRequest(f, 2);
    assert.equal(call.url, "/api/speech");
    assert.deepEqual(JSON.parse(call.init.body), {
      ownerId: "owner-a",
      chatId: "chat-a",
      messageId: "saved-assistant-a",
      contentSha256: createHash("sha256").update("A completed reply.").digest("hex"),
      voiceId: "default",
    });
    call.resolve(
      new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mpeg" } }),
    );
    await f.flush();
    const sink = f.playbackSinks[0];
    assert.equal(sink.writes.length, 1);
    await f.update(change);
    assert.equal(call.init.signal.aborted, true);
    assert.ok(sink.disposed > 0);
    f.unmount();
  }
  const long = fixture({
    latestAssistantText: "x".repeat(4001),
    latestAssistantReply: {
      chatId: "chat-a",
      messageId: "saved-assistant-a",
      content: "x".repeat(4001),
    },
  });
  await long.ready();
  await long.click("Read latest completed reply");
  assert.equal(long.requests.length, 1);
  assert.match(long.text(), /4,000 characters/);
  long.unmount();
});

test("late saved speech after a scope change cannot play audio", async () => {
  const f = fixture();
  await f.ready();
  await f.click("Read latest completed reply");
  const call = await waitForRequest(f, 2);
  await f.update({ contextKey: "elsewhere" });
  assert.equal(call.init.signal.aborted, true);
  call.resolve(new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }));
  await f.flush();
  assert.equal(f.playbackSinks[0].writes.length, 0);
  f.unmount();
});

test("Dictate Cancel stops speaking and ignores the ended callback", async () => {
  const f = fixture();
  await f.ready();
  await f.click("Read latest completed reply");
  const request = await waitForRequest(f, 2);
  request.resolve(new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }));
  await f.flush();
  const sink = f.playbackSinks[0];
  assert.equal(sink.writes.length, 1);
  assert.equal(
    f.nodes().find((node) => node.type === "DialogContent").props["data-voice-phase"],
    "speaking",
  );
  await f.click("Cancel");
  assert.equal(request.init.signal.aborted, true);
  assert.equal(sink.disposed, 1);
  sink.options.onEnded();
  await f.flush();
  assert.equal(
    f.nodes().find((node) => node.type === "DialogContent").props["data-voice-phase"],
    "idle",
  );
  assert.equal(f.requests.length, 2);
  f.unmount();
});

test("a different response player stops Dictate speech without leaving it busy", async () => {
  const f = fixture();
  await f.ready();
  await f.click("Read latest completed reply");
  const request = await waitForRequest(f, 2);
  request.resolve(new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }));
  await f.flush();
  const sink = f.playbackSinks[0];
  assert.equal(sink.writes.length, 1);
  stopActiveSpeechPlayback();
  await f.flush();
  assert.equal(sink.disposed, 1);
  assert.equal(
    f.nodes().find((node) => node.type === "DialogContent").props["data-voice-phase"],
    "idle",
  );
  assert.equal(f.control("Read latest completed reply").disabled, false);
  f.unmount();
});

test("Dictate cannot read a reply without matching saved message proof", async () => {
  for (const latestAssistantReply of [
    undefined,
    { chatId: "chat-a", messageId: "saved-assistant-a", content: "Other reply." },
    { chatId: "chat-a", messageId: "", content: "A completed reply." },
  ]) {
    const f = fixture({ latestAssistantReply });
    await f.ready();
    assert.equal(f.control("Read latest completed reply").disabled, true);
    assert.equal(f.requests.length, 1);
    f.unmount();
  }
});

test("normalization failure retains the original recording for explicit retry without a new microphone request", async () => {
  const options = {
    preparationError: "This recording could not be prepared. Your recording is still available.",
  };
  const f = fixture({}, options);
  await f.ready();
  await f.recordToRequest();
  assert.equal(f.requests.length, 1);
  assert.equal(f.preparations.length, 1);
  assert.match(f.text(), /still available/);
  assert.equal(f.control("Retry transcription").disabled, false);
  options.preparationError = null;
  await f.click("Retry transcription");
  assert.equal(f.microphoneRequests.length, 1);
  assert.equal(f.requests.length, 2);
  assert.equal(f.preparations[0].blob, f.preparations[1].blob);
  f.requests.at(-1).resolve(Response.json({ text: "Recovered recording" }));
  await f.flush();
  assert.equal(
    f.nodes().find((node) => node.type === "textarea").props.value,
    "Recovered recording",
  );
  assert.ok(
    !f
      .nodes()
      .some((node) => node.type === "button" && text(node).trim() === "Retry transcription"),
  );
  f.unmount();
});

test("late audio conversion cannot upload after cancel, close, account/context changes, or unmount", async () => {
  for (const change of [
    "cancel",
    "unmount",
    { open: false },
    { userId: "owner-b" },
    { contextKey: "chat-b" },
  ]) {
    const f = fixture({}, { holdPreparation: true });
    await f.ready();
    await f.recordToRequest();
    const pending = f.preparations[0];
    assert.ok(pending);
    assert.equal(f.requests.length, 1);
    if (change === "cancel") await f.click("Cancel");
    else if (change === "unmount") f.unmount();
    else await f.update(change);
    assert.equal(pending.signal.aborted, true);
    pending.resolve(new Blob(["late converted audio"], { type: "audio/wav" }));
    await f.flush();
    assert.equal(f.requests.filter((request) => request.init.method === "POST").length, 0);
    assert.ok(
      !f
        .nodes()
        .some((node) => node.type === "button" && text(node).trim() === "Retry transcription"),
    );
    f.unmount();
  }
});

test("provider failure preserves both recording retry and edited transcript; Cancel drops retained audio", async () => {
  const f = fixture();
  await f.ready();
  await f.recordToRequest();
  f.requests.at(-1).resolve(Response.json({ text: "Original draft" }));
  await f.flush();
  f.nodes()
    .find((node) => node.type === "textarea")
    .props.onChange({ target: { value: "Edited draft" } });
  await f.flush();
  await f.recordToRequest();
  f.requests
    .at(-1)
    .resolve(Response.json({ error: "voice_provider_unavailable" }, { status: 502 }));
  await f.flush();
  assert.equal(f.nodes().find((node) => node.type === "textarea").props.value, "Edited draft");
  assert.equal(f.control("Retry transcription").disabled, false);
  await f.click("Cancel");
  assert.ok(
    !f
      .nodes()
      .some((node) => node.type === "button" && text(node).trim() === "Retry transcription"),
  );
  assert.equal(f.nodes().find((node) => node.type === "textarea").props.value, "Edited draft");
  f.unmount();
});

test("repeated recording and TTS clicks are serialized before a rerender", async () => {
  const f = fixture();
  await f.ready();
  const record = f.control("Start recording");
  record.onClick();
  record.onClick();
  await f.flush();
  assert.equal(f.microphoneRequests.length, 1);
  await f.click("Cancel");
  const read = f.control("Read latest completed reply");
  read.onClick();
  read.onClick();
  await waitForRequest(f, 2);
  f.unmount();
});

test("picker renders only server catalog labels and stores available choices per account", async () => {
  const f = fixture();
  await f.ready();
  assert.equal(f.selectedVoice(), "default");
  assert.match(f.text(), /Locked voice.*View plans/);
  const picker = f.nodes().find((node) => node.type === "SelectTrigger");
  const label = f.nodes().find((node) => node.type === "label" && text(node) === "Reply voice");
  assert.equal(picker.props.id, label.props.htmlFor);
  assert.match(picker.props.className, /min-h-11/);
  assert.ok(
    f
      .nodes()
      .filter((node) => node.type === "SelectItem")
      .every((node) => /min-h-11/.test(node.props.className)),
  );
  await f.chooseVoice("warm");
  assert.equal(f.selectedVoice(), "warm");
  assert.equal(f.storage.get(voiceKey("owner-a")), "warm");
  assert.equal(f.requests.length, 1);
  assert.equal(f.microphoneRequests.length, 0);
  await f.click("Read latest completed reply");
  await waitForRequest(f, 2);
  assert.equal(JSON.parse(f.requests.at(-1).init.body).voiceId, "warm");
  assert.equal(f.requests.at(-1).init.headers["X-Kova-Owner"], "owner-a");
  f.unmount();
});

test("stored voice is validated against fresh permissions, with isolated account/default fallback", async () => {
  const storage = new Map([
    [voiceKey("owner-a"), "warm"],
    [voiceKey("owner-b"), "locked"],
  ]);
  const f = fixture({}, { storage });
  await f.ready();
  assert.equal(f.selectedVoice(), "warm");
  const oldChange = f.nodes().find((node) => node.type === "Select").props.onValueChange;
  await f.update({ userId: "owner-b" });
  oldChange("warm");
  await f.flush();
  assert.equal(storage.get(voiceKey("owner-b")), "locked");
  f.requests.at(-1).resolve(Response.json({ ...configured, defaultVoiceId: "default" }));
  await f.flush();
  assert.equal(f.selectedVoice(), "default");
  assert.equal(storage.has(voiceKey("owner-b")), false);
  assert.equal(storage.get(voiceKey("owner-a")), "warm");
  await f.chooseVoice("warm");
  assert.equal(storage.get(voiceKey("owner-b")), "warm");
  await f.update({ open: false });
  await f.update({ open: true });
  f.requests.at(-1).resolve(
    Response.json({
      ...configured,
      voices: configured.voices.map((voice) => ({ ...voice, available: voice.id === "default" })),
    }),
  );
  await f.flush();
  assert.equal(f.selectedVoice(), "default");
  assert.equal(storage.has(voiceKey("owner-b")), false);
  f.unmount();
});

test("unknown or locked stored preferences never authorize playback and guest storage is untouched", async () => {
  for (const saved of ["unknown-provider-id", "locked", "", "x".repeat(1000)]) {
    const storage = new Map([[voiceKey("owner-a"), saved]]);
    const f = fixture({}, { storage });
    await f.ready({ ...configured, defaultVoiceId: "missing" });
    assert.equal(f.selectedVoice(), "default");
    assert.equal(storage.has(voiceKey("owner-a")), false);
    assert.equal(f.dispatched.length, 0);
    f.unmount();
  }
  const guest = fixture({ userId: null });
  await guest.flush();
  assert.equal(guest.storageReads.length, 0);
  assert.equal(guest.storageWrites.length, 0);
  guest.unmount();
});

test("voice changes cancel pending speech and preserve reviewed text", async () => {
  const f = fixture();
  await f.ready();
  await f.recordToRequest();
  f.requests.at(-1).resolve(Response.json({ text: "My reviewed draft" }));
  await f.flush();
  await f.click("Read latest completed reply");
  const stale = await waitForRequest(f, 3);
  await f.chooseVoice("warm");
  assert.equal(stale.init.signal.aborted, true);
  stale.resolve(new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }));
  await f.flush();
  assert.equal(f.urls.length, 0);
  assert.equal(f.nodes().find((node) => node.type === "textarea").props.value, "My reviewed draft");
  await f.click("Read latest completed reply");
  await waitForRequest(f, 4);
  f.requests
    .at(-1)
    .resolve(new Response(new Uint8Array([2]), { headers: { "content-type": "audio/mpeg" } }));
  await f.flush();
  assert.equal(f.playbackSinks.at(-1).writes.length, 1);
  f.playbackSinks.at(-1).options.onEnded();
  await f.flush();
  await f.chooseVoice("default");
  assert.equal(f.playbackSinks.at(-1).disposed, 1);
  assert.equal(f.selectedVoice(), "default");
  assert.equal(f.nodes().find((node) => node.type === "textarea").props.value, "My reviewed draft");
  f.unmount();
});

test("locked voices open only existing billing after close focus releases, without saving or posting", async () => {
  let normalFocus = 0,
    prevented = 0;
  const f = fixture({ onCloseAutoFocus: () => normalFocus++ });
  await f.ready();
  await f.chooseVoice("locked");
  assert.deepEqual(f.closed, [false]);
  assert.equal(f.dispatched.length, 0);
  assert.equal(f.storageWrites.length, 0);
  assert.equal(f.requests.length, 1);
  await f.update({ open: false });
  f.nodes()
    .find((node) => node.type === "DialogContent")
    .props.onCloseAutoFocus({
      preventDefault() {
        prevented++;
      },
    });
  assert.equal(prevented, 1);
  assert.equal(normalFocus, 0);
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.dispatched[0].type, "kova-open-settings");
  assert.equal(f.dispatched[0].detail.tab, "billing");
  f.nodes()
    .find((node) => node.type === "DialogContent")
    .props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(f.dispatched.length, 1);
  assert.equal(normalFocus, 0);
  f.unmount();
});

test("billing handoff is discarded if the account changes before close autofocus", async () => {
  const f = fixture();
  await f.ready();
  await f.chooseVoice("locked");
  await f.update({ open: false, userId: "owner-b" });
  f.nodes()
    .find((node) => node.type === "DialogContent")
    .props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(f.dispatched.length, 0);
  f.unmount();
});

test("storage denial never blocks selecting or using an available voice", async () => {
  for (const options of [
    { storageUnavailable: true },
    { storageReadError: true },
    { storageWriteError: true },
    { storageRemoveError: true, storage: new Map([[voiceKey("owner-a"), "locked"]]) },
  ]) {
    const f = fixture({}, options);
    await f.ready();
    assert.equal(f.selectedVoice(), "default");
    await f.chooseVoice("warm");
    assert.equal(f.selectedVoice(), "warm");
    if (options.storageUnavailable || options.storageWriteError)
      assert.match(f.text(), /could not be saved/);
    await f.click("Read latest completed reply");
    await waitForRequest(f, 2);
    assert.equal(JSON.parse(f.requests.at(-1).init.body).voiceId, "warm");
    f.unmount();
  }
});

test("account data cleanup resets mounted preference, cancels speech and does not rewrite storage", async () => {
  const f = fixture();
  await f.ready();
  await f.chooseVoice("warm");
  const writes = f.storageWrites.length;
  await f.click("Read latest completed reply");
  const pending = await waitForRequest(f, 2);
  f.dispatch({
    type: principalStorage.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
    detail: { principal: "user:someone-else" },
  });
  await f.flush();
  assert.equal(f.selectedVoice(), "warm");
  assert.equal(pending.init.signal.aborted, false);
  f.storage.delete(voiceKey("owner-a"));
  f.dispatch({
    type: principalStorage.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
    detail: { principal: "user:owner-a" },
  });
  await f.flush();
  assert.equal(f.selectedVoice(), "default");
  assert.equal(pending.init.signal.aborted, true);
  assert.equal(f.storageWrites.length, writes);
  assert.equal(f.storage.has(voiceKey("owner-a")), false);
  f.unmount();
});

test("catalog choices can be previewed while provider audio remains unconfigured", async () => {
  const model = { type: "button", props: { children: "Existing model control" } };
  const f = fixture({ conversationModelControl: model });
  await f.ready({ ...configured, configured: false, stt: false, tts: false, sts: false });
  assert.doesNotMatch(f.text(), /Existing model control/);
  assert.ok(!f.nodes().some((node) => node.props?.className === "kova-voice-mark"));
  assert.doesNotMatch(f.text(), /Your conversation is here when/);
  await f.chooseVoice("warm");
  assert.equal(f.selectedVoice(), "warm");
  assert.equal(f.requests.length, 1);
  assert.equal(f.microphoneRequests.length, 0);
  assert.ok(
    !f
      .nodes()
      .some(
        (node) => node.type === "button" && text(node).trim() === "Read latest completed reply",
      ),
  );
  assert.match(f.text(), /Voice is not available yet/);
  f.unmount();
});

test("empty, locked-only and malformed catalogs never enable unauthorized TTS", async () => {
  for (const voices of [
    [],
    configured.voices.filter((voice) => !voice.available),
    [{ id: "bad/id", label: "Bad", available: true }],
    [{ id: "safe", label: "Bad\nlabel", available: true }],
    [{ id: "safe", label: "Safe", available: "true" }],
    [configured.voices[0], configured.voices[0]],
  ]) {
    const f = fixture();
    await f.ready({ ...configured, voices });
    assert.equal(f.control("Read latest completed reply").disabled, true);
    f.control("Read latest completed reply").onClick();
    await f.flush();
    assert.equal(f.requests.length, 1);
    f.unmount();
  }
});

test("permission denial after selection cannot create playback or reveal provider content", async () => {
  const f = fixture();
  await f.ready();
  await f.chooseVoice("warm");
  await f.click("Read latest completed reply");
  const request = await waitForRequest(f, 2);
  request.resolve(Response.json({ error: "speech_voice_plan_required" }, { status: 403 }));
  await f.flush();
  assert.match(f.text(), /requires a different plan/);
  assert.doesNotMatch(f.text(), /speech_voice_plan_required/);
  assert.equal(f.urls.length, 0);
  assert.deepEqual(f.submitted, []);
  f.unmount();
});

test("voice canvas keeps processor details contextual and secondary controls out of the main flow", async () => {
  const model = { type: "button", props: { children: "Existing model control" } };
  const f = fixture({ conversationModelControl: model });
  await f.ready();
  const dialog = f.nodes().find((node) => node.type === "DialogContent");
  assert.equal(dialog.props["data-voice-availability"], "ready");
  assert.equal(dialog.props["data-voice-phase"], "idle");
  assert.equal(dialog.props.className, "kova-voice-dialog");
  assert.ok(!f.nodes().some((node) => node.type === "details"));
  assert.ok(
    f
      .nodes()
      .some((node) => node.type === "div" && node.props["aria-label"] === "Conversation model"),
  );
  assert.ok(
    f
      .nodes()
      .some(
        (node) =>
          node.type === "button" && node.props["aria-label"] === "How your audio is processed",
      ),
  );
  const disclosure = f
    .nodes()
    .find((node) => node.type === "PopoverContent" && text(node).includes("ElevenLabs"));
  assert.ok(disclosure);
  assert.ok(
    !f
      .nodes()
      .some(
        (node) => node.type === "PopoverContent" && text(node).includes("Existing model control"),
      ),
  );
  assert.match(text(disclosure), /When you stop or reach 59 seconds/);
  assert.match(text(disclosure), /Cancel before stopping to discard audio/);
  const outsidePopoverText = (node) =>
    node == null || typeof node === "boolean"
      ? ""
      : Array.isArray(node)
        ? node.map(outsidePopoverText).join("")
        : typeof node === "object"
          ? node.type === "PopoverContent"
            ? ""
            : outsidePopoverText(node.props?.children)
          : String(node);
  assert.doesNotMatch(outsidePopoverText(dialog), /ElevenLabs|Conversation settings/);
  assert.equal(
    f.nodes().filter((node) => node.type === "button" && text(node).trim() === "Close").length,
    1,
  );
  assert.equal(f.control("Start recording").title, "Start recording");
  const mark = f
    .nodes()
    .find((node) => node.type === "svg" && node.props.className === "kova-voice-mark");
  assert.equal(mark.props["aria-hidden"], "true");
  assert.equal(mark.props.focusable, "false");
  assert.equal(f.microphoneRequests.length, 0);
  assert.equal(f.requests.length, 1);
  f.unmount();
});

test("unavailable canvas has no pretend microphone and playback-only copy does not invite recording", async () => {
  const f = fixture();
  await f.ready({ configured: false, stt: false, tts: false });
  assert.equal(
    f.nodes().find((node) => node.type === "DialogContent").props["data-voice-availability"],
    "unconfigured",
  );
  assert.ok(
    !f.nodes().some((node) => node.type === "button" && /record|transcrib|reply/i.test(text(node))),
  );
  assert.match(f.text(), /Voice is not available yet/);
  await f.click("Close");
  assert.deepEqual(f.closed, [false]);
  assert.equal(f.microphoneRequests.length, 0);
  f.unmount();

  const playback = fixture();
  await playback.ready({ ...configured, stt: false });
  assert.match(playback.text(), /Hear a reply/);
  assert.doesNotMatch(
    playback.text(),
    /Ready to talk|Record a message|Record a thought|Speak, review/,
  );
  assert.equal(playback.control("Start recording").disabled, true);
  playback.unmount();
});

test("presentation boundary cannot initiate media, requests, storage or timers", () => {
  const view = readFileSync("src/components/ComposerVoiceDialogView.tsx", "utf8");
  assert.doesNotMatch(
    view,
    /authFetch|getUserMedia|MediaRecorder|localStorage|sessionStorage|\bfetch\s*\(|setTimeout|setInterval|useEffect|useLayoutEffect/,
  );
  const styles = readFileSync("src/components/composer-voice.css", "utf8");
  const restingOrb = styles.match(/\.kova-voice-mark\s*\{([^}]+)\}/)?.[1];
  assert.ok(restingOrb);
  assert.doesNotMatch(restingOrb, /animation\s*:/, "Idle voice never pretends to be recording");
  assert.match(
    styles,
    /\.kova-voice-dialog:is\(\[data-voice-phase="recording"\], \[data-voice-phase="speaking"\]\)[\s\S]*?\.kova-voice-mark\s*\{[^}]*animation:/,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.kova-voice-mark\s*\{\s*animation: none/,
  );
  assert.match(styles, /safe-area-inset-top/);
  assert.match(styles, /safe-area-inset-bottom/);
  assert.match(styles, /focus-visible/);
});

test("idle status is visually quiet while actual recording progress stays announced", async () => {
  const f = fixture();
  await f.ready();
  const idleStatus = f.nodes().find((node) => node.props?.role === "status");
  assert.match(idleStatus.props.className, /sr-only/);
  assert.equal(idleStatus.props["aria-live"], "polite");
  await f.click("Start recording");
  await f.acquire();
  const recordingStatus = f.nodes().find((node) => node.props?.role === "status");
  assert.doesNotMatch(recordingStatus.props.className, /sr-only/);
  assert.match(text(recordingStatus), /Recording · 0s of 59s/);
  assert.equal(recordingStatus.props["aria-live"], "polite");
  f.unmount();
});

test("an operation error replaces the ready hero and appears before recovery controls", async () => {
  const f = fixture();
  await f.ready();
  await f.recordToRequest();
  f.requests
    .at(-1)
    .resolve(Response.json({ error: "voice_provider_unavailable" }, { status: 502 }));
  await f.flush();
  const dialog = f.nodes().find((node) => node.type === "DialogContent");
  assert.equal(dialog.props["data-voice-error"], "true");
  assert.equal(dialog.props["data-voice-content-first"], "true");
  assert.equal(dialog.props["data-voice-compact"], "true");
  assert.equal(text(f.nodes().find((node) => node.type === "h2")), "Voice needs attention");
  assert.doesNotMatch(f.text(), /Ready to talk|Ready when you are/);
  assert.ok(!f.nodes().some((node) => node.props?.className === "kova-voice-mark"));
  const canvas = f.nodes().find((node) => node.props?.className === "kova-voice-canvas");
  assert.ok(nodes(canvas).some((node) => node.props?.role === "alert"));
  assert.match(text(canvas), /voice service is unavailable/i);
  const alertIndex = f.nodes().findIndex((node) => node.props?.role === "alert");
  const retryIndex = f
    .nodes()
    .findIndex((node) => node.type === "button" && text(node) === "Retry transcription");
  assert.ok(alertIndex < retryIndex);
  assert.equal(f.control("Retry transcription").disabled, false);
  f.unmount();
});

test("transcript and playback prioritize their content while inactive voice uses a compact panel", async () => {
  const f = fixture();
  await f.ready();
  await f.recordToRequest();
  f.requests.at(-1).resolve(Response.json({ text: "A transcript that remains fully editable." }));
  await f.flush();
  assert.equal(
    f.nodes().find((node) => node.type === "DialogContent").props["data-voice-content-first"],
    "true",
  );
  assert.ok(!f.nodes().some((node) => node.props?.className === "kova-voice-mark"));
  assert.equal(f.nodes().find((node) => node.type === "textarea").props.disabled, false);
  assert.equal(f.control("Use in chat").disabled, false);
  f.unmount();

  const playback = fixture();
  await playback.ready();
  await playback.click("Read latest completed reply");
  const request = await waitForRequest(playback, 2);
  request.resolve(new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }));
  await playback.flush();
  assert.equal(
    playback.nodes().find((node) => node.type === "DialogContent").props[
      "data-voice-content-first"
    ],
    "true",
  );
  assert.ok(!playback.nodes().some((node) => node.props?.className === "kova-voice-mark"));
  assert.equal(playback.playbackSinks.at(-1).writes.length, 1);
  assert.ok(!playback.nodes().some((node) => node.type === "audio"));
  playback.unmount();

  const absent = fixture();
  await absent.ready({ configured: false, stt: false, tts: false });
  assert.equal(
    absent.nodes().find((node) => node.type === "DialogContent").props["data-voice-compact"],
    "true",
  );
  absent.unmount();
  const styles = readFileSync("src/components/composer-voice.css", "utf8");
  assert.match(
    styles,
    /\[data-voice-content-first="true"\] \.kova-voice-canvas\s*\{[^}]*min-height: 0;[^}]*flex: 0 0 auto;/,
  );
  assert.match(styles, /\.kova-voice-dialog\[data-voice-compact="true"\]\s*\{[^}]*height: auto;/);
});

const savedVoiceReply = (change = {}) => ({
  ownerId: "owner-a",
  chatId: "chat-a",
  messageId: "new-voice-assistant",
  content: "A saved response to this voice turn.",
  contentSha256: "a".repeat(64),
  ...change,
});
async function voiceTurn(f) {
  await f.ready();
  await f.click("Start");
  const acquired = await f.acquire();
  await f.click("Finish turn");
  f.requests.at(-1).resolve(Response.json({ text: "  Spoken current turn  " }));
  await f.flush();
  assert.equal(f.voiceSubmissions.length, 1);
  return { acquired, submission: f.voiceSubmissions[0] };
}
async function voiceReply(f) {
  const turn = await voiceTurn(f);
  turn.submission.resolve(savedVoiceReply());
  await f.flush();
  const speech = f.requests.at(-1);
  assert.equal(speech.url, "/api/speech");
  speech.resolve(
    new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }),
  );
  await f.flush();
  return { ...turn, speech, sink: f.playbackSinks[0] };
}

test("Voice requires explicit Start and uses STT before the existing chat callback; Dictate never submits chat", async () => {
  const f = fixture({ mode: "voice" });
  await f.ready();
  assert.equal(f.microphoneRequests.length, 0);
  assert.equal(
    f.selectedVoice(),
    "default",
    "Saved-response speech uses the selected server catalog voice",
  );
  assert.doesNotMatch(f.text(), /Read latest completed reply/);
  await f.click("Start");
  const acquired = await f.acquire();
  await f.click("Finish turn");
  assert.ok(acquired.tracks.every((t) => t.stopped > 0));
  assert.equal(f.voiceSubmissions.length, 0);
  f.requests.at(-1).resolve(Response.json({ text: "Spoken input" }));
  await f.flush();
  assert.equal(f.voiceSubmissions[0].value, "Spoken input");
  assert.equal(f.submitted.length, 0, "Voice must not overwrite the composer draft");
  assert.match(f.text(), /reply and saved history/);
  await f.update({ isStreaming: true, latestAssistantText: "A partially streamed unrelated text" });
  assert.equal(
    f.voiceSubmissions[0].signal.aborted,
    false,
    "Own chat stream does not reset the Voice session",
  );
  assert.equal(
    f.requests.length,
    2,
    "Stream updates do not recheck capabilities or speak arbitrary latest text",
  );
  await f.click("Stop");
  assert.equal(f.voiceSubmissions[0].signal.aborted, true);
  f.unmount();
});

test("known unavailable Voice conversation never records, transcribes or submits chat", async () => {
  for (const value of [
    {
      ...configured,
      tts: false,
      conversation: false,
      voices: configured.voices.filter((voice) => !voice.available),
      defaultVoiceId: null,
    },
    { ...configured, conversation: false },
    { ...configured, conversation: undefined },
    { ...configured, voices: [], defaultVoiceId: null },
  ]) {
    const f = fixture({ mode: "voice" });
    await f.ready(value);
    assert.equal(
      f.nodes().find((node) => node.type === "DialogContent").props["data-voice-availability"],
      "unconfigured",
    );
    assert.match(f.text(), /Spoken replies are not available/);
    assert.match(f.text(), /Use Dictate/);
    assert.doesNotMatch(f.text(), /Microphone transcription is not configured/);
    assert.ok(!f.nodes().some((node) => node.type === "button" && text(node).trim() === "Start"));
    assert.equal(f.microphoneRequests.length, 0);
    assert.equal(f.preparations.length, 0);
    assert.equal(f.voiceSubmissions.length, 0);
    assert.equal(f.requests.length, 1, "Only the capability GET runs; no STT/chat/speech requests");
    f.unmount();
  }
});

test("Dictate still produces a composer draft when conversation speech is unavailable", async () => {
  const f = fixture();
  await f.ready({
    ...configured,
    tts: false,
    conversation: false,
    voices: configured.voices.filter((voice) => !voice.available),
    defaultVoiceId: null,
  });
  await f.recordToRequest();
  assert.equal(f.requests.at(-1).url, "/api/voice");
  assert.equal(f.requests.at(-1).init.body.get("action"), "stt");
  f.requests.at(-1).resolve(Response.json({ text: "Available dictation" }));
  await f.flush();
  await f.click("Use in chat");
  assert.deepEqual(f.submitted, ["Available dictation"]);
  assert.equal(f.voiceSubmissions.length, 0);
  assert.equal(f.requests.filter((request) => request.url === "/api/speech").length, 0);
  f.unmount();
});

test("Voice speaks the exact saved receipt and begins the next turn only after actual audio ended", async () => {
  const f = fixture({ mode: "voice" });
  const { speech, sink } = await voiceReply(f);
  assert.deepEqual(JSON.parse(speech.init.body), {
    ownerId: "owner-a",
    chatId: "chat-a",
    messageId: "new-voice-assistant",
    contentSha256: "a".repeat(64),
    voiceId: "default",
  });
  assert.equal(speech.init.headers["X-Kova-Owner"], "owner-a");
  assert.equal(sink.ended, 1, "The whole byte stream reached the audio sink");
  assert.equal(f.microphoneRequests.length, 1, "Buffer completion does not reopen microphone");
  assert.equal(f.submitted.length, 0);
  sink.options.onEnded();
  await f.flush();
  assert.equal(
    f.microphoneRequests.length,
    2,
    "An actual ended event advances the explicit Voice session",
  );
  assert.ok(sink.disposed > 0);
  await f.click("Stop");
  const late = await f.acquire();
  assert.ok(late.tracks.every((t) => t.stopped > 0));
  assert.equal(f.recorders.length, 1);
  f.unmount();
});

test("Voice uses the chosen catalog voice and Stop plus a changed selection rejects late audio", async () => {
  const f = fixture({ mode: "voice" });
  await f.ready();
  assert.equal(f.selectedVoice(), "default");
  await f.chooseVoice("warm");
  const { submission } = await voiceTurn(f);
  submission.resolve(savedVoiceReply());
  await f.flush();
  const oldSpeech = f.requests.at(-1);
  assert.equal(oldSpeech.url, "/api/speech");
  assert.deepEqual(JSON.parse(oldSpeech.init.body), {
    ownerId: "owner-a",
    chatId: "chat-a",
    messageId: "new-voice-assistant",
    contentSha256: "a".repeat(64),
    voiceId: "warm",
  });
  await f.click("Stop");
  await f.chooseVoice("default");
  assert.equal(oldSpeech.init.signal.aborted, true);
  oldSpeech.resolve(
    new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }),
  );
  const oldSink = f.playbackSinks[0];
  oldSink.options.onEnded();
  await f.flush();
  assert.equal(oldSink.writes.length, 0, "The old voice never reaches playback after Stop");
  assert.ok(oldSink.disposed > 0);
  assert.equal(f.microphoneRequests.length, 1, "The old voice cannot begin another turn");
  assert.equal(f.selectedVoice(), "default");
  f.unmount();
});

test("external shared Stop rejects a synchronous stale sink-ended event before the idle microtask", async () => {
  const f = fixture({ mode: "voice" });
  const { sink } = await voiceReply(f);
  stopActiveSpeechPlayback();
  // A browser/device can queue ended during teardown. The shared manager must
  // reject it before the dialog's external-Stop idle microtask has run.
  sink.options.onEnded();
  await f.flush();
  assert.equal(
    f.microphoneRequests.length,
    1,
    "A stopped sink cannot start the next listening turn",
  );
  assert.ok(sink.disposed > 0);
  f.unmount();
});

for (const change of [
  "Stop",
  "Close",
  "logout",
  "chat",
  "pagehide",
  "principal-clear",
  "unmount",
]) {
  test(`Voice chat wait aborts and ignores late saved reply on ${change}`, async () => {
    const f = fixture({ mode: "voice" });
    const { submission } = await voiceTurn(f);
    if (change === "Stop" || change === "Close") await f.click(change);
    else if (change === "logout") await f.update({ userId: null });
    else if (change === "chat") await f.update({ contextKey: "another-chat" });
    else if (change === "unmount") f.unmount();
    else
      f.dispatch(
        change === "pagehide"
          ? { type: "pagehide" }
          : {
              type: principalStorage.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
              detail: { principal: "user:owner-a" },
            },
      );
    await f.flush();
    assert.equal(submission.signal.aborted, true);
    submission.resolve(savedVoiceReply());
    await f.flush();
    assert.equal(f.requests.filter((r) => r.url === "/api/speech").length, 0);
    assert.equal(f.microphoneRequests.length, 1);
    assert.equal(f.submitted.length, 0);
    f.unmount();
  });
}

for (const change of [
  "Stop",
  "Close",
  "logout",
  "chat",
  "pagehide",
  "principal-clear",
  "unmount",
]) {
  test(`Voice playback releases audio and late ended cannot reopen mic on ${change}`, async () => {
    const f = fixture({ mode: "voice" });
    const { speech, sink } = await voiceReply(f);
    if (change === "Stop" || change === "Close") await f.click(change);
    else if (change === "logout") await f.update({ userId: null });
    else if (change === "chat") await f.update({ contextKey: "another-chat" });
    else if (change === "unmount") f.unmount();
    else
      f.dispatch(
        change === "pagehide"
          ? { type: "pagehide" }
          : {
              type: principalStorage.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
              detail: { principal: "user:owner-a" },
            },
      );
    await f.flush();
    assert.equal(speech.init.signal.aborted, true);
    assert.ok(sink.disposed > 0);
    sink.options.onEnded();
    await f.flush();
    assert.equal(f.microphoneRequests.length, 1);
    f.unmount();
  });
}

test("Voice Stop cancels pending microphone and transcription without late submission", async () => {
  const pending = fixture({ mode: "voice" });
  await pending.ready();
  await pending.click("Start");
  await pending.click("Stop");
  const late = await pending.acquire();
  assert.ok(late.tracks.every((t) => t.stopped > 0));
  assert.equal(pending.recorders.length, 0);
  pending.unmount();
  const f = fixture({ mode: "voice" });
  await f.ready();
  await f.click("Start");
  await f.acquire();
  await f.click("Finish turn");
  const stt = f.requests.at(-1);
  await f.click("Stop");
  assert.equal(stt.init.signal.aborted, true);
  stt.resolve(Response.json({ text: "Late cancelled transcript" }));
  await f.flush();
  assert.equal(f.voiceSubmissions.length, 0);
  f.unmount();
});

test("Voice refuses missing callback, wrong owner, malformed receipt, oversize reply and failed history without automatic retries", async () => {
  const absent = fixture({ mode: "voice", onVoiceSubmit: undefined });
  await absent.ready();
  assert.equal(absent.control("Start").disabled, true);
  absent.control("Start").onClick();
  await absent.flush();
  assert.equal(absent.microphoneRequests.length, 0);
  absent.unmount();
  for (const invalid of [
    { ownerId: "another-owner" },
    { contentSha256: "bad" },
    { messageId: "" },
    { content: "x".repeat(4001) },
    null,
  ]) {
    const f = fixture({ mode: "voice" });
    const { submission } = await voiceTurn(f);
    if (invalid === null) submission.reject(Error("secret provider output"));
    else submission.resolve(savedVoiceReply(invalid));
    await f.flush();
    assert.equal(f.requests.filter((r) => r.url === "/api/speech").length, 0);
    assert.match(f.text(), /could not be completed and saved|too long to speak/);
    assert.doesNotMatch(f.text(), /secret provider output/);
    assert.equal(f.microphoneRequests.length, 1);
    f.unmount();
  }
});

test("Voice speech failure is visible and neither error nor external playback Stop starts another turn", async () => {
  const failed = fixture({ mode: "voice" });
  const { submission } = await voiceTurn(failed);
  submission.resolve(savedVoiceReply());
  await failed.flush();
  failed.requests
    .at(-1)
    .resolve(Response.json({ error: "private upstream detail" }, { status: 503 }));
  await failed.flush();
  assert.match(failed.text(), /Read aloud is not configured/);
  assert.doesNotMatch(failed.text(), /private upstream detail/);
  assert.equal(failed.microphoneRequests.length, 1);
  failed.unmount();
  const f = fixture({ mode: "voice" });
  await voiceReply(f);
  const outside = createSpeechPlayback({
    fetchImpl: async () => new Response(null, { status: 503 }),
    createSink: () => ({ dispose() {} }),
    onState() {},
  });
  await outside.start({
    ownerId: "other",
    chatId: "other",
    messageId: "other",
    contentSha256: "b".repeat(64),
  });
  await f.flush();
  assert.equal(f.microphoneRequests.length, 1);
  assert.equal(f.nodes().find((n) => n.type === "DialogContent").props["data-voice-phase"], "idle");
  outside.stop();
  f.unmount();
});

test("Voice chat deadline aborts a stalled callback and ignores a late receipt", async () => {
  const f = fixture({ mode: "voice" });
  const { submission } = await voiceTurn(f);
  await f.timer(120_000);
  assert.equal(submission.signal.aborted, true);
  assert.match(f.text(), /voice turn timed out/);
  submission.resolve(savedVoiceReply());
  await f.flush();
  assert.equal(f.requests.filter((r) => r.url === "/api/speech").length, 0);
  f.unmount();
});

test("principal clear and pagehide release Dictate capture and abort pending preparation", async () => {
  for (const event of [
    { type: "pagehide" },
    {
      type: principalStorage.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
      detail: { principal: "user:owner-a" },
    },
  ]) {
    const f = fixture({}, { holdPreparation: true });
    await f.ready();
    const acquired = await f.recordToRequest();
    const conversion = f.preparations[0];
    f.dispatch(event);
    await f.flush();
    assert.equal(conversion.signal.aborted, true);
    assert.ok(acquired.tracks.every((t) => t.stopped > 0));
    conversion.resolve(new Blob(["late"], { type: "audio/wav" }));
    await f.flush();
    assert.equal(f.requests.length, 1);
    assert.equal(f.submitted.length, 0);
    f.unmount();
  }
});

test("pagehide and principal clear immediately release live Dictate/Voice microphone and close the dialog", async () => {
  for (const mode of ["dictate", "voice"]) {
    for (const event of [
      { type: "pagehide" },
      {
        type: principalStorage.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
        detail: { principal: "user:owner-a" },
      },
    ]) {
      const f = fixture({ mode });
      await f.ready();
      await f.click(mode === "voice" ? "Start" : "Start recording");
      const acquired = await f.acquire();
      f.dispatch(event);
      await f.flush();
      assert.ok(acquired.tracks.every((t) => t.stopped > 0));
      assert.equal(f.recorders[0].state, "inactive");
      assert.equal(f.requests.length, 1, "Cancelled live recording cannot transcribe");
      assert.deepEqual(f.closed, [false]);
      assert.equal(f.timers.size, 0);
      f.unmount();
    }
  }
});

test("a separate chat stream interrupts Voice recording instead of reusing the microphone session", async () => {
  const f = fixture({ mode: "voice" });
  await f.ready();
  await f.click("Start");
  const acquired = await f.acquire();
  await f.update({ isStreaming: true });
  assert.ok(acquired.tracks.every((t) => t.stopped > 0));
  assert.equal(f.recorders[0].state, "inactive");
  assert.equal(f.requests.length, 1);
  assert.equal(f.voiceSubmissions.length, 0);
  f.unmount();
});

// Exercise the actual response toolbar's onState callback through the shared
// manager. Only the browser audio sink/network is controlled by this harness.
async function playingResponseSpeech(events) {
  const hooks = createHookHarness();
  const calls = [];
  const requested = deferred();
  const playing = deferred();
  const ready = async (promise, stage) => {
    let timer;
    try {
      await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Response speech never reached ${stage}`)),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const props = {
    ownerId: "owner-a",
    chatId: "chat-a",
    messageId: "prior-assistant",
    content: "A prior completed reply.",
  };
  const { ResponseSpeechButton } = loadUiModule(
    "src/components/ResponseSpeechButton.tsx",
    {
      react: hooks.react,
      "lucide-react": {},
      "@/lib/principal-browser-storage.mjs": principalStorage,
      "@/lib/auth-fetch": {
        authFetch: (url, init) => {
          const pending = deferred();
          calls.push({ url, init, ...pending });
          requested.resolve();
          return pending.promise;
        },
      },
      "@/lib/speech-playback.mjs": {
        createSpeechPlayback: (options) =>
          createSpeechPlayback({
            ...options,
            createSink: (callbacks) => ({
              async write() {
                callbacks.onPlaying();
                playing.resolve();
              },
              async end() {},
              dispose() {
                events.push("speech-disposed");
              },
            }),
          }),
      },
    },
    {
      window: { addEventListener() {}, removeEventListener() {} },
      crypto: webcrypto,
      TextEncoder,
      Uint8Array,
    },
  );
  const render = () => hooks.render(ResponseSpeechButton, props);
  let tree = render();
  elements(tree, (n) => n.type === "button")[0].props.onClick();
  // SHA-256 runs on the host worker pool; event-loop turns are not a deadline
  // under the full concurrent CI suite. Await the actual transport transition.
  await ready(requested.promise, "the authenticated speech request");
  assert.equal(calls.length, 1);
  calls[0].resolve(
    new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }),
  );
  await ready(playing.promise, "audio playback");
  tree = render();
  assert.equal(
    elements(tree, (n) => n.type === "button")[0].props["aria-label"],
    "Stop reading aloud",
  );
  return { calls, render, unmount: () => hooks.unmount() };
}

for (const mode of ["dictate", "voice"]) {
  test(`${mode} explicit Start stops prior response Read aloud before microphone capture and resets its real toolbar state`, async () => {
    const events = [];
    const response = await playingResponseSpeech(events);
    const f = fixture({ mode }, { onMicrophoneRequest: () => events.push("microphone-requested") });
    try {
      await f.ready();
      await f.click(mode === "voice" ? "Start" : "Start recording");
      assert.equal(response.calls[0].init.signal.aborted, true);
      assert.ok(events.indexOf("speech-disposed") >= 0);
      assert.ok(events.indexOf("speech-disposed") < events.indexOf("microphone-requested"));
      const button = elements(response.render(), (n) => n.type === "button")[0];
      assert.equal(button.props["aria-label"], "Read aloud");
      assert.equal(button.props["aria-pressed"], false);
      assert.equal(response.calls.length, 1, "Starting capture never posts another speech request");
      assert.equal(f.requests.length, 1, "Only the existing voice capability GET has run");
    } finally {
      f.unmount();
      response.unmount();
    }
  });
}

test("inline dictation starts once after the explicit open, adds reviewed text only, and closes safely", async () => {
  const f = fixture({ inlineDictation: true });
  assert.equal(f.microphoneRequests.length, 0, "capability check precedes microphone request");
  await f.ready();
  assert.equal(f.microphoneRequests.length, 1);
  await f.flush();
  assert.equal(f.microphoneRequests.length, 1, "rerenders do not request the microphone again");
  const stream = await f.acquire();
  assert.ok(f.nodes().some((node) => node.props.id === "kova-inline-dictation"));
  await f.click("Stop and transcribe");
  assert.ok(stream.tracks.every((track) => track.stopped > 0));
  f.requests.at(-1).resolve(Response.json({ text: "A dictated message." }));
  await f.flush();
  assert.equal(
    f.submitted.length,
    0,
    "transcription cannot send or change the draft automatically",
  );
  const use = f.nodes().find((node) => node.props["aria-label"] === "Use in chat");
  assert.ok(use);
  use.props.onClick();
  await f.flush();
  assert.deepEqual(f.submitted, ["A dictated message."]);
  assert.deepEqual(f.closed, [false]);
  assert.equal(f.voiceSubmissions.length, 0);
  f.unmount();
});

test("canceling inline dictation rejects late microphone access and stops all acquired tracks", async () => {
  const f = fixture({ inlineDictation: true });
  await f.ready();
  const cancel = f.nodes().find((node) => node.props["aria-label"] === "Cancel dictation");
  cancel.props.onClick();
  await f.flush();
  const late = await f.acquire();
  assert.ok(late.tracks.every((track) => track.stopped > 0));
  assert.equal(f.recorders.length, 0);
  assert.equal(f.requests.length, 1, "cancelled capture cannot upload audio");
  assert.deepEqual(f.closed, [false]);
  f.unmount();
});
