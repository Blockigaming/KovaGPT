import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createInteractiveBrowser } from "../../work-runner/browser-image/driver.mjs";
const origin = "https://browser-fixture.net";
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
