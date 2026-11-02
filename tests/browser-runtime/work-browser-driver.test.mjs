import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createInteractiveBrowser } from "../../work-runner/browser-image/driver.mjs";
const origin = "https://browser-fixture.net";
test("a browser prompt waits for owner takeover and its response stays out of snapshots", async (t) => {
  const driver = await createInteractiveBrowser({
    chromium,
    exchange: async () => ({
      status: 200,
      headers: { "content-type": "text/html" },
      bodyBase64: Buffer.from(
        "<html><body><input id=\"code\"><button onclick=\"document.getElementById('code').value=prompt('Enter sign-in code')\">Continue</button></body></html>",
      ).toString("base64"),
    }),
  });
  t.after(() => driver.close());
  await driver.command({ actor: "owner", sequence: 1, operation: "navigate", url: origin });
  await driver.command({ actor: "owner", sequence: 2, operation: "release" });
  const page = await driver.command({ actor: "agent", sequence: 3, operation: "snapshot" });
  const prompt = await driver.command({
    actor: "agent",
    sequence: 4,
    operation: "click",
    view: page.view,
    target: page.nodes.find((node) => node.label === "Continue").id,
  });
  assert.equal(prompt.handoff, "dialog");
  assert.equal(prompt.nodes.length, 0);
  const owner = await driver.command({ actor: "owner", sequence: 5, operation: "takeover" });
  assert.equal(owner.interaction.prompt, true);
  const response = await driver.command({
    actor: "owner",
    sequence: 6,
    operation: "click",
    view: owner.view,
    target: owner.nodes.find((node) => node.kind === "interaction_allow").id,
    text: "PRIVATE-CODE",
  });
  assert.equal(JSON.stringify(response).includes("PRIVATE-CODE"), false);
  await driver.command({ actor: "owner", sequence: 7, operation: "release" });
  const resumed = await driver.command({ actor: "agent", sequence: 8, operation: "snapshot" });
  assert.equal(JSON.stringify(resumed).includes("PRIVATE-CODE"), false);
});
test("popup navigation has no upstream traffic before approval and keeps its opener for sign-in callbacks", async (t) => {
  const reads = [],
    popupUrl = "https://login-provider.net/start?private=synthetic";
  const driver = await createInteractiveBrowser({
    chromium,
    exchange: async (request) => {
      reads.push(request.url);
      const body = request.url.startsWith("https://login-provider.net")
        ? '<html><body><script>window.opener.postMessage("done","https://browser-fixture.net");window.close();</script></body></html>'
        : `<html><body><p id="status">Signed out</p><button onclick="window.open('${popupUrl}','auth')">Sign in</button><script>window.addEventListener('message',event=>{if(event.origin==='https://login-provider.net')document.getElementById('status').textContent='Signed in';});</script></body></html>`;
      return {
        status: 200,
        headers: { "content-type": "text/html" },
        bodyBase64: Buffer.from(body).toString("base64"),
      };
    },
  });
  t.after(() => driver.close());
  const page = await driver.command({
    actor: "owner",
    sequence: 1,
    operation: "navigate",
    url: origin,
  });
  const popup = await driver.command({
    actor: "owner",
    sequence: 2,
    operation: "click",
    view: page.view,
    target: page.nodes.find((node) => node.label === "Sign in").id,
  });
  assert.equal(popup.handoff, "popup");
  assert.equal(reads.includes(popupUrl), false);
  assert.equal(JSON.stringify(popup).includes("private=synthetic"), false);
  const allowed = await driver.command({
    actor: "owner",
    sequence: 3,
    operation: "click",
    view: popup.view,
    target: popup.nodes.find((node) => node.kind === "interaction_allow").id,
  });
  assert.equal(reads.includes(popupUrl), true);
  assert.match(allowed.text, /Signed in/);
  const next = await driver.command({
    actor: "owner",
    sequence: 4,
    operation: "click",
    view: allowed.view,
    target: allowed.nodes.find((node) => node.label === "Sign in").id,
  });
  const count = reads.length;
  await driver.command({
    actor: "owner",
    sequence: 5,
    operation: "click",
    view: next.view,
    target: next.nodes.find((node) => node.kind === "interaction_deny").id,
  });
  assert.equal(reads.length, count);
});
test("multibyte DOM snapshots fit the actual owner transport and Work effect byte budgets", async (t) => {
  const body =
    "<html><body><p>" +
    "界".repeat(6000) +
    "</p>" +
    Array.from({ length: 60 }, () => "<button>" + "界".repeat(200) + "</button>").join("") +
    "</body></html>";
  const driver = await createInteractiveBrowser({
    chromium,
    exchange: async () => ({
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      bodyBase64: Buffer.from(body).toString("base64"),
    }),
  });
  t.after(() => driver.close());
  const owner = await driver.command({
    actor: "owner",
    sequence: 1,
    operation: "navigate",
    url: origin,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(owner)) <= 50000);
  await driver.command({ actor: "owner", sequence: 2, operation: "release" });
  const agent = await driver.command({ actor: "agent", sequence: 3, operation: "snapshot" });
  assert.ok(Buffer.byteLength(JSON.stringify(agent)) <= 10000);
  assert.ok(agent.text.includes("界"));
});
test("a late owner network response cannot enter the model view after control changes", async (t) => {
  let settle, entered;
  const started = new Promise((resolve) => (entered = resolve));
  const delayed = new Promise((resolve) => (settle = resolve));
  const driver = await createInteractiveBrowser({
    chromium,
    exchange: async (request) => {
      if (request.url.endsWith("/late")) {
        entered();
        return delayed;
      }
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        bodyBase64: Buffer.from(
          '<html><body><p>Initial page</p><script>fetch("/late").then(r=>r.text()).then(text=>document.body.append(text)).catch(()=>{})</script></body></html>',
        ).toString("base64"),
      };
    },
  });
  t.after(() => driver.close());
  const navigating = driver.command({
    actor: "owner",
    sequence: 1,
    operation: "navigate",
    url: origin,
  });
  await started;
  await navigating;
  await driver.command({ actor: "owner", sequence: 2, operation: "release" });
  settle({
    status: 200,
    headers: { "content-type": "text/plain" },
    bodyBase64: Buffer.from("late-private-owner-body").toString("base64"),
  });
  const result = await driver.command({ actor: "agent", sequence: 3, operation: "snapshot" });
  assert.ok(!JSON.stringify(result).includes("late-private-owner-body"));
});
test("real Chromium owner takeover never exposes password values and model requires current DOM targets", async (t) => {
  const reads = [];
  const driver = await createInteractiveBrowser({
    chromium,
    exchange: async (request, authority) => {
      reads.push({ request, authority });
      const body = request.url.endsWith("/app.js")
        ? "window.fixtureLoaded=true;"
        : `<html><title>Browser fixture</title><body><p>Safe page text</p><form><label>Password<input type="password" name="password"></label><button type="button" onclick="this.textContent='Changed'">Continue</button></form><script src="/app.js"></script></body></html>`;
      return {
        status: 200,
        headers: {
          "content-type": request.url.endsWith(".js") ? "application/javascript" : "text/html",
        },
        bodyBase64: Buffer.from(body).toString("base64"),
      };
    },
  });
  t.after(() => driver.close());
  const first = await driver.command({
    actor: "owner",
    sequence: 1,
    operation: "navigate",
    url: origin,
  });
  assert.ok(reads.some((v) => v.request.url.endsWith("/app.js")));
  const password = first.nodes.find((v) => v.inputType === "password");
  assert.ok(password);
  const filled = await driver.command({
    actor: "owner",
    sequence: 2,
    operation: "fill",
    view: first.view,
    target: password.id,
    text: "TOP-SECRET-password",
  });
  assert.ok(!JSON.stringify(filled).includes("TOP-SECRET"));
  await assert.rejects(driver.command({ actor: "agent", sequence: 3, operation: "snapshot" }));
  await driver.command({ actor: "owner", sequence: 4, operation: "release" });
  const model = await driver.command({ actor: "agent", sequence: 5, operation: "snapshot" });
  assert.ok(!JSON.stringify(model).includes("TOP-SECRET"));
  await assert.rejects(
    driver.command({ actor: "agent", sequence: 6, operation: "fill", text: "never" }),
  );
  const button = model.nodes.find((v) => v.label === "Continue");
  await assert.rejects(
    driver.command({
      actor: "agent",
      sequence: 7,
      operation: "click",
      view: first.view,
      target: button.id,
    }),
  );
  const clicked = await driver.command({
    actor: "agent",
    sequence: 8,
    operation: "click",
    view: model.view,
    target: button.id,
  });
  assert.ok(clicked.nodes.some((v) => v.label === "Changed"));
  await assert.rejects(driver.command({ actor: "agent", sequence: 8, operation: "snapshot" }));
});
