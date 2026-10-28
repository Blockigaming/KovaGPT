import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import * as speech from "../../src/lib/speech.server.mjs";
import {
  createAcceptanceFixture,
  liveAcceptanceFixtureTime,
} from "../helpers/generation-acceptance.mjs";

test("full ChatMessage control → actual speech route → ownership → playback and Stop", async (t) => {
  const folder = mkdtempSync(join(tmpdir(), "kova-chat-message-speech-"));
  let browser, server;
  const acceptance = createAcceptanceFixture({ now: liveAcceptanceFixtureTime() });
  const ownerId = acceptance.plan.ownerId,
    chatId = acceptance.plan.chatId;
  const state = {
    acceptanceMode: false,
    calls: 0,
    cancelled: false,
    upstreamSignal: null,
    providerText: null,
    deny: false,
  };
  try {
    const mp3 = join(folder, "silence.mp3");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=22050:cl=mono",
      "-t",
      "3",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "32k",
      mp3,
    ]);
    const audio = readFileSync(mp3);
    const saved = {
      owner_id: ownerId,
      id: chatId,
      deleted_at: null,
      payload: {
        id: chatId,
        messages: [{ id: "msg-a", role: "assistant", content: "Saved assistant response." }],
      },
    };
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      abortSignal: () => query,
      maybeSingle: async () => ({ data: saved, error: null }),
    };
    const dependencies = {
      "@tanstack/react-router": { createFileRoute: () => (value) => value },
      "@/lib/api-auth.server": {
        requireVerifiedUser: async () =>
          state.deny
            ? Response.json({ error: "unauthorized" }, { status: 401 })
            : {
                userId: ownerId,
                supabaseUser: {
                  from: (table) => {
                    assert.equal(table, "chat_history_records");
                    return query;
                  },
                },
              },
      },
      "@/lib/distributed-rate-limit.server": {
        consumeApplicationRateLimit: async () => ({ allowed: true }),
      },
      "@/lib/runtime-env.server": {
        runtimeEnv: (name) =>
          ({
            KOVA_SPEECH_ENABLED: "true",
            KOVA_GENERATION_ACCEPTANCE_ENABLED: state.acceptanceMode ? "true" : "false",
            ELEVENLABS_API_KEY: "mock-key-never-live",
            ELEVENLABS_VOICE_ID: "fixtureVoice",
          })[name],
      },
      "@/lib/speech.server.mjs": speech,
      "@/lib/generation-acceptance-runtime.server": { generationAcceptance: acceptance.build() },
      "@/lib/multimodal/image-source.server.mjs": { assertImagePrincipal: async () => {} },
    };
    // The existing handler takes an injectable provider fetch; use a wrapper
    // solely at the server route's imported factory, preserving its real wiring.
    dependencies["@/lib/speech.server.mjs"] = {
      createSpeechHandler: (options) =>
        speech.createSpeechHandler({
          ...options,
          fetchImpl: async (url, init) => {
            state.calls++;
            state.upstreamSignal = init.signal;
            assert.equal(
              String(url),
              "https://api.elevenlabs.io/v1/text-to-speech/fixtureVoice/stream?output_format=mp3_44100_128",
            );
            const body = JSON.parse(init.body);
            assert.equal(body.model_id, "eleven_multilingual_v2");
            state.providerText = body.text;
            return new Response(
              new ReadableStream({
                start(c) {
                  c.enqueue(audio);
                },
                cancel() {
                  state.cancelled = true;
                },
              }),
              { headers: { "Content-Type": "audio/mpeg" } },
            );
          },
        }),
    };
    // CommonJS import holds the module object captured during evaluation.
    const wiredModule = { exports: {} };
    vm.runInNewContext(
      ts.transpileModule(readFileSync("src/routes/api/speech.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      { exports: wiredModule.exports, require: (name) => dependencies[name] },
    );
    const post = wiredModule.exports.Route.server.handlers.POST;
    const stubs = {
      "@/lib/auth-fetch":
        'export const authFetch=(url,init)=>fetch(url,{...init,headers:{...init.headers,...(window.fixtureOperationId?{"x-kova-acceptance-operation":window.fixtureOperationId}:{})}});',
      "@/components/auth/ClerkSafe":
        "export const useUser=()=>({isSignedIn:window.fixtureSignedIn!==false});",
      "@tanstack/react-start": "export const useServerFn=(fn)=>fn;",
      "@/lib/library.functions": "export const saveToLibrary=async()=>({});",
      "@/lib/feedback.functions":
        "export const getResponseFeedbackBatch=async()=>({ratings:{}}); export const submitResponseFeedback=async()=>({});",
      "@/hooks/use-mobile": "export const useLayout=()=>({isMobile:false});",
      ...Object.fromEntries(
        [
          "MemorySourcesDialog",
          "ChatChart",
          "ArtifactEditor",
          "SelectionEditDialog",
          "MessageVersionHistoryDialog",
          "ToolConfirmCard",
          "InfoChip",
        ].map((name) => ["./" + name, `export const ${name}=()=>null;`]),
      ),
    };
    const bundle = await build({
      absWorkingDir: process.cwd(),
      stdin: {
        resolveDir: process.cwd(),
        loader: "jsx",
        contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {ChatMessage} from './src/components/ChatMessage';
        const root=createRoot(document.getElementById('root'));
        window.showMessage=(options={})=>{window.fixtureSignedIn=options.signedIn!==false;
          root.render(React.createElement(ChatMessage,{message:{id:'msg-a',role:'assistant',content:'Saved assistant response.',...options.message},
          userKey:${JSON.stringify(ownerId)},principalResolved:true,chatId:${JSON.stringify(chatId)},...options}));};
        window.showMessage();
      `,
      },
      bundle: true,
      write: false,
      format: "esm",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"test"' },
      plugins: [
        {
          name: "unrelated-authority-fixtures",
          setup(b) {
            b.onResolve({ filter: /.*/ }, ({ path }) =>
              path in stubs ? { path, namespace: "stub" } : undefined,
            );
            b.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({
              contents: stubs[path],
            }));
          },
        },
      ],
    });
    server = createServer(async (req, res) => {
      try {
        if (req.url === "/bundle.js") {
          res.setHeader("Content-Type", "text/javascript");
          res.end(bundle.outputFiles[0].contents);
          return;
        }
        if (req.url === "/api/speech") {
          const buffers = [];
          for await (const chunk of req) buffers.push(chunk);
          const abort = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) abort.abort();
          });
          const origin = `http://${req.headers.host}`;
          const result = await post({
            request: new Request(origin + req.url, {
              method: "POST",
              body: Buffer.concat(buffers),
              headers: req.headers,
              signal: abort.signal,
            }),
          });
          res.writeHead(result.status, Object.fromEntries(result.headers));
          if (!result.body) {
            res.end();
            return;
          }
          const reader = result.body.getReader();
          res.on("close", () => {
            void reader.cancel().catch(() => {});
          });
          while (!res.destroyed) {
            const { value, done } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
          return;
        }
        res.setHeader("Content-Type", "text/html");
        res.end('<div id="root"></div><script type="module" src="/bundle.js"></script>');
      } catch {
        res.destroy();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.fixtureAudios = [];
      const NativeAudio = window.Audio;
      window.Audio = new Proxy(NativeAudio, {
        construct(target, args) {
          const audio = new target(...args);
          window.fixtureAudios.push(audio);
          return audio;
        },
      });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Read aloud", exact: true }).waitFor();
    await t.test("eligible full response shows control; ineligible responses hide it", async () => {
      for (const options of [
        { streaming: true },
        { temporary: true },
        { principalResolved: false },
        { userKey: null },
        { signedIn: false },
        {
          message: {
            id: "msg-a",
            role: "assistant",
            content: "Saved assistant response.",
            generationStatus: "failed",
          },
        },
        {
          message: {
            id: "msg-a",
            role: "assistant",
            content: "Saved assistant response.",
            generationStatus: "stopped",
          },
        },
        {
          message: {
            id: "msg-a",
            role: "assistant",
            content: "Saved assistant response.",
            pendingImage: true,
          },
        },
        { message: { id: "msg-a", role: "user", content: "Saved assistant response." } },
      ]) {
        await page.evaluate((options) => window.showMessage(options), options);
        await page.waitForTimeout(30);
        assert.equal(
          await page.getByRole("button", { name: "Read aloud", exact: true }).count(),
          0,
          JSON.stringify(options),
        );
      }
      await page.evaluate(() => window.showMessage());
      await page.getByRole("button", { name: "Read aloud", exact: true }).waitFor();
      assert.equal(state.calls, 0);
    });
    await t.test(
      "full response reaches real route, loads saved text, plays and cancels",
      async () => {
        await page.getByRole("button", { name: "Read aloud", exact: true }).click();
        await page.waitForFunction(() =>
          window.fixtureAudios.some((a) => !a.paused && a.currentTime > 0),
        );
        assert.equal(state.calls, 1);
        assert.equal(state.providerText, "Saved assistant response.");
        await page.getByRole("button", { name: "Stop reading aloud", exact: true }).click();
        await page.getByRole("button", { name: "Read aloud", exact: true }).waitFor();
        await page.waitForTimeout(50);
        assert.equal(state.cancelled, true);
        assert.equal(state.upstreamSignal.aborted, true);
        assert.equal(await page.evaluate(() => window.fixtureAudios.some((a) => !a.paused)), false);
      },
    );
    await t.test("server session rejection is visible and does not call provider", async () => {
      state.deny = true;
      await page.getByRole("button", { name: "Read aloud", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Sign in" }).waitFor();
      assert.equal(state.calls, 1);
      await page.getByRole("button", { name: "Read aloud", exact: true }).waitFor();
    });
    await t.test("actual speech admission permits one request and rejects a replay", async () => {
      state.deny = false;
      state.acceptanceMode = true;
      state.cancelled = false;
      await page.evaluate((id) => {
        window.fixtureOperationId = id;
      }, acceptance.plan.operationId);
      await page.getByRole("button", { name: "Read aloud", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Reading aloud" }).waitFor();
      assert.equal(state.calls, 2);
      await page.getByRole("button", { name: "Stop reading aloud", exact: true }).click();
      await page.getByRole("button", { name: "Read aloud", exact: true }).waitFor();
      await page.getByRole("button", { name: "Read aloud", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Read aloud is not available" }).waitFor();
      assert.equal(state.calls, 2);
      assert.equal(acceptance.calls.length, 2);
    });
  } finally {
    await browser?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    rmSync(folder, { recursive: true, force: true });
  }
});
