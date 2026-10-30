import test from "node:test";
import assert from "node:assert/strict";
import { File } from "node:buffer";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
import { encodeVoicePcm } from "../../src/lib/voice-pcm.mjs";
import { loadVoiceTools, submitVoiceTool } from "../../src/lib/voice-tools-client.mjs";

const config = {
  configured: true,
  tts: true,
  stt: true,
  sts: true,
  voices: [{ id: "default", label: "Default voice", available: true }],
  defaultVoiceId: "default",
};
const wav = () =>
  new Blob([encodeVoicePcm([new Float32Array(1600)], 16000)], { type: "audio/wav" });
function fixture({ fetchImpl, prepare, owner = { id: "owner-one" } }) {
  const urls = [],
    revoked = [],
    preparations = [],
    calls = [];
  const authenticatedFetch = async (path, init) => {
    calls.push({ path, init });
    return init.method === "GET" ? Response.json(config) : fetchImpl(path, init);
  };
  const panel = reactFixture(
    "src/components/AudioToolsPanel.tsx",
    ({ AudioToolsPanel }) =>
      () =>
        AudioToolsPanel({ ownerId: owner.id }),
    {
      globals: {
        AbortController,
        setTimeout,
        clearTimeout,
        URL: {
          createObjectURL(blob) {
            const url = `blob:audio-${urls.length}`;
            urls.push({ url, blob });
            return url;
          },
          revokeObjectURL(url) {
            revoked.push(url);
          },
        },
      },
      modules: {
        "@/lib/auth-fetch": { authFetch: authenticatedFetch },
        "@/lib/voice-recording": {
          prepareVoiceRecording: async (file, options) => {
            preparations.push({ file, options });
            return prepare ? prepare(file, options) : wav();
          },
        },
        "@/lib/voice-tools-client.mjs": { loadVoiceTools, submitVoiceTool },
      },
    },
  );
  return { panel, urls, revoked, preparations, calls, owner };
}
const inputFile = () =>
  new File(["selected audio fixture"], "selected.mp3", { type: "audio/mpeg" });
const audioResponse = () =>
  new Response(new Uint8Array([73, 68, 51]), { headers: { "Content-Type": "audio/mpeg" } });

test("speech generation uses an explicit submit and shows playable provider audio with cleanup", async () => {
  const f = fixture({ fetchImpl: async () => audioResponse() });
  await f.panel.flush();
  f.panel.find("textarea").props.onChange({ target: { value: "Kova audio acceptance." } });
  await f.panel.flush();
  assert.equal(f.calls.length, 1, "editing does not dispatch generation");
  f.panel.submit();
  await f.panel.flush();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(JSON.parse(f.calls[1].init.body), {
    action: "tts",
    text: "Kova audio acceptance.",
    voiceId: "default",
  });
  const audio = f.panel.find("audio");
  assert.equal(audio.props.controls, true);
  assert.equal(audio.props.src, "blob:audio-0");
  assert.equal(f.urls[0].blob.type, "audio/mpeg");
  let pauses = 0;
  audio.props.ref.current = {
    pause() {
      pauses++;
    },
  };
  f.panel
    .find("select", (node) => node.props["aria-label"] === "Audio operation")
    .props.onChange({ target: { value: "stt" } });
  await f.panel.flush();
  assert.equal(pauses, 1);
  assert.deepEqual(f.revoked, ["blob:audio-0"]);
  assert.equal(f.preparations.length, 0, "text speech never requests or decodes microphone audio");
  f.panel.unmount();
});
test("file transcription prepares a selected local file and renders the real returned transcript", async () => {
  const f = fixture({
    fetchImpl: async () => Response.json({ text: "The actual audio transcript." }),
  });
  await f.panel.flush();
  f.panel
    .find("select", (node) => node.props["aria-label"] === "Audio operation")
    .props.onChange({ target: { value: "stt" } });
  await f.panel.flush();
  const file = inputFile();
  f.panel
    .find("input", (node) => node.props.type === "file")
    .props.onChange({ target: { files: [file] } });
  await f.panel.flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.preparations.length, 0);
  f.panel.submit();
  await f.panel.flush();
  assert.equal(f.preparations[0].file, file);
  assert.equal(f.calls[1].init.body.get("action"), "stt");
  assert.equal(f.calls[1].init.body.get("voiceId"), null);
  assert.equal(f.calls[1].init.headers["x-kova-voice-owner"], "owner-one");
  assert.match(f.panel.text(), /The actual audio transcript/);
  assert.equal(f.urls.length, 0);
  f.panel.unmount();
});
test("voice transformation uses selected PCM audio and the server-catalog voice", async () => {
  const f = fixture({ fetchImpl: async () => audioResponse() });
  await f.panel.flush();
  f.panel
    .find("select", (node) => node.props["aria-label"] === "Audio operation")
    .props.onChange({ target: { value: "sts" } });
  await f.panel.flush();
  f.panel
    .find("input", (node) => node.props.type === "file")
    .props.onChange({ target: { files: [inputFile()] } });
  await f.panel.flush();
  f.panel.submit();
  await f.panel.flush();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].init.body.get("action"), "sts");
  assert.equal(f.calls[1].init.body.get("audio").type, "audio/wav");
  assert.equal(f.calls[1].init.body.get("voiceId"), "default");
  assert.equal(f.panel.find("audio").props.src, "blob:audio-0");
  f.panel.unmount();
  assert.deepEqual(f.revoked, ["blob:audio-0"]);
});
test("cancelling audio preparation aborts before a billable request and keeps retry explicit", async () => {
  let complete;
  const preparation = new Promise((resolve) => {
    complete = resolve;
  });
  const f = fixture({
    fetchImpl: async () => {
      throw Error("must not dispatch");
    },
    prepare: () => preparation,
  });
  await f.panel.flush();
  f.panel
    .find("select", (node) => node.props["aria-label"] === "Audio operation")
    .props.onChange({ target: { value: "sts" } });
  await f.panel.flush();
  f.panel
    .find("input", (node) => node.props.type === "file")
    .props.onChange({ target: { files: [inputFile()] } });
  await f.panel.flush();
  f.panel.submit();
  await f.panel.flush();
  await f.panel.click("Cancel audio");
  assert.equal(f.preparations[0].options.signal.aborted, true);
  complete(wav());
  await f.panel.flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.urls.length, 0);
  assert.equal(
    f.panel.find("button", (node) => node.props.type === "submit").props.disabled,
    false,
  );
  f.panel.unmount();
});
test("account changes abort active audio and prevent stale transcripts or playable URLs", async () => {
  let complete;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const f = fixture({ fetchImpl: () => pending });
  await f.panel.flush();
  f.panel.find("textarea").props.onChange({ target: { value: "Private owner-one text" } });
  await f.panel.flush();
  f.panel.submit();
  await f.panel.flush();
  f.owner.id = "owner-two";
  await f.panel.flush();
  assert.equal(f.calls[1].init.signal.aborted, true);
  complete(audioResponse());
  await f.panel.flush();
  assert.equal(f.urls.length, 0);
  assert.equal(f.panel.find("textarea").props.value, "");
  assert.doesNotMatch(f.panel.text(), /Audio result/);
  f.panel.unmount();
});

test("changing audio operation clears a file that is no longer visibly selected", async () => {
  const f = fixture({
    fetchImpl: async () => {
      throw Error("must not dispatch");
    },
  });
  await f.panel.flush();
  const change = async (value) => {
    f.panel
      .find("select", (node) => node.props["aria-label"] === "Audio operation")
      .props.onChange({ target: { value } });
    await f.panel.flush();
  };
  await change("stt");
  f.panel
    .find("input", (node) => node.props.type === "file")
    .props.onChange({ target: { files: [inputFile()] } });
  await f.panel.flush();
  assert.equal(
    f.panel.find("button", (node) => node.props.type === "submit").props.disabled,
    false,
  );
  await change("tts");
  await change("sts");
  assert.equal(f.panel.find("button", (node) => node.props.type === "submit").props.disabled, true);
  f.panel.submit();
  await f.panel.flush();
  assert.equal(f.calls.length, 1, "the hidden previous file cannot reach a billable request");
  assert.equal(f.preparations.length, 0);
  f.panel.unmount();
});
