import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { DEFAULT_ACCOUNT_EMAIL_PREFERENCES } from "../../src/lib/account-email-preferences.mjs";

// Exercise the real component and owner-bound client against localhost-only
// preference storage. No account, Resend credential, email or cloud operation.
test("account email controls persist each event, handle uncertain writes, and isolate accounts", async (t) => {
  const owners = new Map([
    ["owner-a", { ...DEFAULT_ACCOUNT_EMAIL_PREFERENCES }],
    [
      "owner-b",
      Object.fromEntries(Object.keys(DEFAULT_ACCOUNT_EMAIL_PREFERENCES).map((key) => [key, false])),
    ],
  ]);
  const requests = [];
  let failWrite = false;
  let holdOwner = null;
  let releaseRead;
  let browser;
  const bundle = await build({
    absWorkingDir: process.cwd(),
    stdin: {
      contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {AccountEmailPreferences} from './src/components/AccountEmailPreferences';
        const root=createRoot(document.getElementById('root'));
        window.fixtureOwner='owner-a';
        window.showOwner=(owner)=>{window.fixtureOwner=owner;root.render(React.createElement(AccountEmailPreferences,{ownerId:owner}));};
        window.showOwner('owner-a');
      `,
      resolveDir: process.cwd(),
      loader: "jsx",
    },
    bundle: true,
    write: false,
    format: "esm",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "local-session-fixture",
        setup(b) {
          b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({
            path: "session",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: `export const supabase={auth:{getSession:async()=>({data:{session:window.fixtureOwner?{user:{id:window.fixtureOwner},access_token:'synthetic-session'}:null},error:null})}};`,
          }));
        },
      },
    ],
  });
  const server = createServer(async (req, res) => {
    if (req.url === "/bundle.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].contents);
      return;
    }
    if (req.url !== "/api/account/email-preferences") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/bundle.js"></script>',
      );
      return;
    }
    const owner = req.headers["x-kova-owner"];
    assert.equal(req.headers.authorization, "Bearer synthetic-session");
    let body;
    if (req.method === "PATCH") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString());
      Object.assign(owners.get(owner), body.preferences);
    }
    requests.push({ owner, method: req.method, body });
    const value = { version: 1, preferences: { ...owners.get(owner) } };
    if (req.method === "GET" && owner === holdOwner) {
      await new Promise((resolve) => {
        releaseRead = resolve;
      });
    }
    if (req.method === "PATCH" && failWrite) {
      failWrite = false;
      res.writeHead(503);
      res.end("internal delivery details must remain private");
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(value));
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const toggle = (name) => page.getByRole("switch", { name, exact: true });
    await toggle("Password changed").waitFor();

    await t.test("only the six requested security/deletion defaults are enabled", async () => {
      assert.equal(await page.getByRole("switch").count(), 9);
      assert.equal(await page.getByRole("switch", { checked: true }).count(), 6);
      assert.equal(await toggle("New sign-in").isChecked(), false);
      assert.equal(await toggle("Email address changed").isChecked(), false);
      assert.match(
        await page.locator("body").innerText(),
        /Verification and password-reset emails you request are still sent/,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    });

    await t.test("a keyboard change updates just that event and survives reload", async () => {
      await toggle("New sign-in").focus();
      await page.keyboard.press("Space");
      await page.getByRole("status").filter({ hasText: "Email preference saved." }).waitFor();
      assert.deepEqual(requests.at(-1).body, { preferences: { new_login: true } });
      await page.getByRole("button", { name: "Reload email preferences" }).click();
      await toggle("New sign-in").waitFor();
      assert.equal(await toggle("New sign-in").isChecked(), true);
      await toggle("Password changed").click();
      await page.getByRole("status").filter({ hasText: "Email preference saved." }).waitFor();
      assert.equal(await toggle("Password changed").isChecked(), false);
    });

    await t.test(
      "an uncertain write requires a fresh read and never silently retries",
      async () => {
        failWrite = true;
        const before = requests.filter((r) => r.method === "PATCH").length;
        await toggle("New sign-in").click();
        await page.getByRole("alert").filter({ hasText: "could not be confirmed" }).waitFor();
        assert.equal(await page.getByRole("switch").count(), 0);
        assert.equal(requests.filter((r) => r.method === "PATCH").length, before + 1);
        assert.doesNotMatch(await page.locator("body").innerText(), /internal delivery/);
        await page.getByRole("button", { name: "Reload email preferences" }).click();
        await toggle("New sign-in").waitFor();
        assert.equal(await toggle("New sign-in").isChecked(), false);
      },
    );

    await t.test("late reads from a previous account cannot restore its switches", async () => {
      holdOwner = "owner-a";
      await page.getByRole("button", { name: "Reload email preferences" }).click();
      await page.getByRole("status").filter({ hasText: "Loading email preferences" }).waitFor();
      await page.waitForFunction(() => true);
      while (!releaseRead) await new Promise((resolve) => setTimeout(resolve, 10));
      await page.evaluate(() => window.showOwner("owner-b"));
      await toggle("Password changed").waitFor();
      assert.equal(await page.getByRole("switch", { checked: true }).count(), 0);
      releaseRead();
      holdOwner = null;
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal(await page.getByRole("switch", { checked: true }).count(), 0);
      assert.equal(requests.at(-1).owner, "owner-b");
    });

    await t.test("a changed session cannot mutate the previously displayed account", async () => {
      await page.evaluate(() => {
        window.fixtureOwner = "owner-a";
      });
      const before = requests.length;
      await toggle("Password changed").click();
      await page.getByRole("alert").waitFor();
      assert.equal(requests.length, before);
      await page.evaluate(() => window.showOwner(null));
      await page.getByText("Sign in to manage account emails.").waitFor();
      assert.equal(await page.getByRole("switch").count(), 0);
    });
    assert.deepEqual(errors, []);
  } finally {
    releaseRead?.();
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
