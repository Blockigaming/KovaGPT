import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  browserActivityIsFresh,
  normalizeBrowserActivity,
} from "../../src/lib/browser-activity-contract.mjs";
import { chatBrowserDestination, requestsChatBrowser } from "../../src/lib/chat-browser-policy.mjs";

test("only explicit browse requests with one public HTTPS link get a browser destination", () => {
  assert.equal(
    requestsChatBrowser("Use Cloud Browser to read https://en.wikipedia.org/wiki/Chromium"),
    true,
  );
  assert.equal(requestsChatBrowser("How does a cloud browser work?"), false);
  assert.equal(requestsChatBrowser("Do not use Cloud Browser for https://example.com"), false);
  assert.equal(
    chatBrowserDestination("Open (https://en.wikipedia.org/wiki/Chromium).")?.hostname,
    "en.wikipedia.org",
  );
  for (const input of [
    "http://example.com",
    "https://127.0.0.1",
    "https://name:pass@example.com",
    "https://example.com and https://example.org",
  ]) {
    assert.equal(chatBrowserDestination(input), null);
  }
});

test("browser activity carries a 15-minute idle expiry without changing legacy metadata", () => {
  const observedAt = Date.now();
  const legacy = { sessionId: "test-session", tabCount: 1, observedAt };
  const current = normalizeBrowserActivity({ ...legacy, expiresAt: observedAt + 900000 });
  assert.equal(browserActivityIsFresh(current, observedAt + 899999), true);
  assert.equal(browserActivityIsFresh(current, observedAt + 900000), false);
  assert.equal(
    browserActivityIsFresh(normalizeBrowserActivity(legacy), observedAt + 300001),
    false,
  );
});

test("only the first eligible waiter can claim its own slot, in tier then arrival order", async (t) => {
  const db = new PGlite();
  await t.after(() => db.close());
  await db.exec("create role service_role; create role anon; create role authenticated;");
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261118150000_kova_browserbase_priority_queue.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const users = Array.from({ length: 5 }, () => ({
    owner: crypto.randomUUID(),
    request: crypto.randomUUID(),
  }));
  const [active, plus, firstPro, secondPro, free] = users;
  const claim = async ({ owner, request }, tier) =>
    (
      await db.query("select public.claim_browserbase_slot($1,$2,$3,1) as allowed", [
        owner,
        request,
        tier,
      ])
    ).rows[0].allowed;
  const release = (user) =>
    db.query("delete from public.browserbase_queue where request_id=$1", [user.request]);
  assert.equal(await claim(active, "plus"), true);
  assert.equal(await claim(free, "free"), false);
  assert.equal(await claim(plus, "plus"), false);
  assert.equal(await claim(firstPro, "pro"), false);
  assert.equal(await claim(secondPro, "pro"), false);
  await release(active);
  assert.equal(await claim(free, "free"), false);
  assert.equal(await claim(plus, "plus"), false);
  assert.equal(await claim(secondPro, "pro"), false);
  assert.equal(await claim(firstPro, "pro"), true);
  await release(firstPro);
  assert.equal(await claim(secondPro, "pro"), true);
  await release(secondPro);
  assert.equal(await claim(free, "free"), false);
  assert.equal(await claim(plus, "plus"), true);
  await db.exec("set role authenticated");
  await assert.rejects(() => claim(free, "pro"), /permission denied/);
  await assert.rejects(() => release(plus), /permission denied/);
  await db.exec("reset role");
  await release(plus);
  assert.equal(await claim(free, "free"), true);
});
