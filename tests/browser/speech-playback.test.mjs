import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

// Isolated component, localhost-only mocked delivery, synthetic silent MP3.
// No app credentials, app server, ElevenLabs client, or paid generation.
test("real browser: Read aloud, streamed playback, Stop, errors, principal switch and Blob fallback", async (t) => {
  const folder = mkdtempSync(join(tmpdir(), "kova-speech-fixture-"));
  let browser, server;
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
      "2",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "32k",
      mp3,
    ]);
    const audio = readFileSync(mp3);
    const bundle = await build({
      absWorkingDir: process.cwd(),
      stdin: {
        contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ResponseSpeechButton} from './src/components/ResponseSpeechButton';
      const root=createRoot(document.getElementById('root'));
      window.showSpeech=(props)=>root.render(React.createElement(ResponseSpeechButton,props));
      window.showSpeech({ownerId:'owner-a',chatId:'chat-1',messageId:'msg-1',content:'Completed response.'});
    `,
        resolveDir: process.cwd(),
        loader: "jsx",
      },
      bundle: true,
      write: false,
      format: "esm",
      jsx: "automatic",
      plugins: [
        {
          name: "mock-auth-only",
          setup(b) {
            b.onResolve({ filter: /^@\/lib\/auth-fetch$/ }, () => ({
              path: "mock-auth",
              namespace: "fixture",
            }));
            b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              contents: "export const authFetch=(...args)=>fetch(...args);",
            }));
          },
        },
      ],
      define: { "process.env.NODE_ENV": '"test"' },
    });
    let mode = "audio",
      requests = 0,
      lastInput;
    server = createServer(async (req, res) => {
      if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(bundle.outputFiles[0].contents);
        return;
      }
      if (req.url === "/api/speech") {
        requests++;
        const buffers = [];
        for await (const c of req) buffers.push(c);
        lastInput = JSON.parse(Buffer.concat(buffers));
        if (mode === "error") {
          res.writeHead(429);
          res.end("private detail must not be rendered");
          return;
        }
        if (mode === "loading") {
          const timer = setTimeout(() => res.end(), 3000);
          res.on("close", () => clearTimeout(timer));
          return;
        }
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        res.write(audio.subarray(0, Math.floor(audio.length / 2)));
        const timer = setTimeout(() => res.end(audio.subarray(Math.floor(audio.length / 2))), 150);
        res.on("close", () => clearTimeout(timer));
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end('<div id="root"></div><script type="module" src="/bundle.js"></script>');
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(origin);
    await t.test("streamed audio plays and Stop returns idle", async () => {
      await page.getByRole("button", { name: "Read aloud", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Reading aloud" }).waitFor();
      assert.equal(lastInput.ownerId, "owner-a");
      assert.equal(lastInput.contentSha256.length, 64);
      assert.equal(lastInput.text, undefined);
      await page.getByRole("button", { name: "Stop reading aloud" }).click();
      await page.getByRole("button", { name: "Read aloud", exact: true }).waitFor();
    });
    await t.test("Stop during loading never starts late audio", async () => {
      mode = "loading";
      await page.getByRole("button", { name: "Read aloud", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Loading audio" }).waitFor();
      await page.getByRole("button", { name: "Stop reading aloud" }).click();
      await page.getByRole("button", { name: "Read aloud", exact: true }).waitFor();
    });
    await t.test("429 shows a safe actionable error, with no automatic retry", async () => {
      mode = "error";
      const before = requests;
      await page.getByRole("button", { name: "Read aloud", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Read-aloud limit reached" }).waitFor();
      assert.equal(requests, before + 1);
      assert.doesNotMatch(await page.locator("body").innerText(), /private detail/);
    });
    await t.test("account change stops ongoing playback", async () => {
      mode = "audio";
      await page.getByRole("button", { name: "Read aloud", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Reading aloud" }).waitFor();
      await page.evaluate(() =>
        window.showSpeech({
          ownerId: "owner-b",
          chatId: "chat-1",
          messageId: "msg-1",
          content: "Completed response.",
        }),
      );
      await page.getByRole("button", { name: "Read aloud", exact: true }).waitFor();
    });
    await t.test("browser without MP3 MediaSource plays bounded Blob fallback", async () => {
      await page.addInitScript(() => {
        window.MediaSource = undefined;
      });
      await page.reload();
      await page.getByRole("button", { name: "Read aloud", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Reading aloud" }).waitFor();
      await page.getByRole("button", { name: "Stop reading aloud" }).click();
    });
    await t.test("account cleanup invalidates a pending digest before any request", async () => {
      const before = requests;
      await page.evaluate(() => {
        const original = crypto.subtle.digest.bind(crypto.subtle);
        crypto.subtle.digest = (...args) =>
          new Promise((resolve) => {
            window.releaseSpeechDigest = async () => {
              crypto.subtle.digest = original;
              resolve(await original(...args));
            };
          });
      });
      await page.getByRole("button", { name: "Read aloud", exact: true }).click();
      await page.evaluate(async () => {
        window.dispatchEvent(new Event("kova:principal-browser-storage-cleared"));
        await window.releaseSpeechDigest();
      });
      await page.getByRole("button", { name: "Read aloud", exact: true }).waitFor();
      assert.equal(requests, before);
    });
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    rmSync(folder, { recursive: true, force: true });
  }
});
