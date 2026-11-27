import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  browserActivityIsFresh,
  normalizeBrowserActivity,
} from "../../src/lib/browser-activity-contract.mjs";
import {
  chatBrowserDestination,
  chatBrowserEvidence,
  MAX_BROWSER_EVIDENCE_BYTES,
  requestsChatBrowser,
} from "../../src/lib/chat-browser-policy.mjs";

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

async function queueDatabase(t, fixedQuotaClock = false) {
  const db = new PGlite();
  await t.after(() => db.close());
  await db.exec("create role service_role bypassrls; create role anon; create role authenticated;");
  if (fixedQuotaClock) {
    // The quota test must not depend on how many minutes remain before UTC midnight.
    // Shift the isolated quota clock to noon yesterday; elapsed time still advances.
    await db.exec(`
      create table public.test_quota_clock_offset (delta interval not null);
      insert into public.test_quota_clock_offset
        select ((clock_timestamp() at time zone 'UTC')::date - 1 + time '12:00')
          at time zone 'UTC' - clock_timestamp();
      create function public.test_quota_clock() returns timestamptz
        language sql volatile as
          'select clock_timestamp() + delta from public.test_quota_clock_offset';
      grant select on public.test_quota_clock_offset to service_role;
    `);
  }
  for (const migration of [
    "20261118150000_kova_browserbase_priority_queue.sql",
    "20261119131500_kova_chat_browser_daily_time.sql",
  ]) {
    const sql = await readFile(
      new URL(`../../supabase/migrations/${migration}`, import.meta.url),
      "utf8",
    );
    await db.exec(
      fixedQuotaClock && migration.includes("daily_time")
        ? sql.replaceAll("clock_timestamp()", "public.test_quota_clock()")
        : sql,
    );
  }
  await db.exec("set role service_role");
  return db;
}

function browserRequest() {
  return { owner: crypto.randomUUID(), request: crypto.randomUUID() };
}

function queueClient(db) {
  return {
    async claim({ owner, request }, tier, capacity = 1) {
      const { rows } = await db.query(
        "select public.claim_browserbase_slot_with_quota($1,$2,$3,$4) as result",
        [owner, request, tier, capacity],
      );
      return rows[0].result;
    },
    release({ owner, request }, opened = false) {
      return db.query("select public.release_browserbase_slot_with_quota($1,$2,$3)", [
        owner,
        request,
        opened,
      ]);
    },
  };
}

test("only the first eligible waiter can claim its own slot, in tier then arrival order", async (t) => {
  const db = await queueDatabase(t);
  const users = Array.from({ length: 5 }, browserRequest);
  const [active, plus, firstPro, secondPro, free] = users;
  const queue = queueClient(db);
  const claim = async (user, tier) => (await queue.claim(user, tier)).status === "admitted";
  const { release } = queue;
  assert.equal(await claim(active, "plus"), true);
  assert.equal(await claim(free, "free"), false);
  assert.equal(await claim(plus, "plus"), false);
  assert.equal(await claim(firstPro, "pro"), false);
  assert.equal(await claim(secondPro, "pro"), false);
  // PGlite can enqueue both requests in the same millisecond. Give the
  // waiters distinct timestamps so this exercises arrival order, not a tie.
  await db.query(
    `update public.browserbase_queue as first
     set queued_at = second.queued_at - interval '1 millisecond'
     from public.browserbase_queue as second
     where first.owner_id = $1 and second.owner_id = $2`,
    [firstPro.owner, secondPro.owner],
  );
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

test("reserves and settles UTC daily time for Free and Plus and leaves Pro uncapped", async (t) => {
  const db = await queueDatabase(t, true);
  await db.exec("set time zone 'America/Los_Angeles'");
  const { claim, release } = queueClient(db);
  const [free, plus, pro] = Array.from({ length: 3 }, browserRequest);
  const used = async ({ owner }) =>
    (
      await db.query(
        "select reserved_ms from public.browserbase_daily_usage where owner_id=$1 and usage_day=(public.test_quota_clock() at time zone 'UTC')::date",
        [owner],
      )
    ).rows[0]?.reserved_ms;
  const seed = ({ owner }, milliseconds, daysAgo = 0) =>
    db.query(
      `insert into public.browserbase_daily_usage (owner_id,usage_day,reserved_ms)
     values ($1,(public.test_quota_clock() at time zone 'UTC')::date - $3::int,$2)
     on conflict (owner_id,usage_day) do update set reserved_ms=excluded.reserved_ms`,
      [owner, milliseconds, daysAgo],
    );
  await seed(free, 600_000, 1);
  assert.equal((await claim(free, "free")).status, "admitted");
  assert.equal(await used(free), 600_000);
  assert.equal(
    (await claim({ ...free, request: crypto.randomUUID() }, "free", 3)).status,
    "waiting",
  );
  await release(free, true);
  const consumed = await used(free);
  assert.ok(consumed > 0 && consumed < 600_000);
  await release(free, true);
  assert.equal(await used(free), consumed);
  await seed(free, 600_000);
  assert.equal((await claim(free, "free")).status, "daily_limit");

  await seed(plus, 3_580_000);
  const admission = await claim(plus, "plus");
  assert.equal(admission.status, "admitted");
  const { rows } = await db.query("select public.test_quota_clock() as now");
  assert.ok(Date.parse(admission.deadline) > Date.parse(rows[0].now));
  assert.equal(await used(plus), 3_600_000);
  await release(plus);
  assert.equal(await used(plus), 3_580_000);
  await seed(plus, 3_600_000);
  assert.equal((await claim(plus, "plus")).status, "daily_limit");

  assert.deepEqual(await claim(pro, "pro"), { status: "admitted", deadline: null });
  assert.equal(await used(pro), undefined);
  await release(pro, true);
  await db.exec("set role authenticated");
  await assert.rejects(() => used(free), /permission denied/);
});

test("browser evidence fits the prepaid model reservation, even with escaped text", async () => {
  const url = new URL("https://example.com/");
  const source = "\u0000🚲".repeat(3333);
  const evidence = chatBrowserEvidence(url, "Example", source);
  assert.ok(new TextEncoder().encode(evidence).byteLength <= MAX_BROWSER_EVIDENCE_BYTES);
  const page = JSON.parse(evidence.slice(evidence.lastIndexOf("\n") + 1));
  assert.equal(page.origin, url.origin);
  assert.ok(page.content.length > 0 && source.startsWith(page.content));
});

test("chat reserves model usage before automating the browser, and manual opening shares only browser time", async () => {
  const chat = await readFile(new URL("../../src/routes/api/chat.ts", import.meta.url), "utf8");
  const manual = await readFile(
    new URL("../../src/routes/api/browser/open.ts", import.meta.url),
    "utf8",
  );
  const browser = await readFile(
    new URL("../../src/lib/chat-browser.server.ts", import.meta.url),
    "utf8",
  );
  assert.ok(chat.indexOf("acquireGeneration({") < chat.indexOf("return readChatBrowserPage({"));
  assert.match(chat, /browserUsageHeaders\(quota\)/);
  assert.match(manual, /await requireVerifiedUser\(request\)/);
  assert.match(manual, /await readLockdownMode\(caller\.supabaseAdmin, caller\.userId\)/);
  assert.match(manual, /openManualChatBrowser\(\{ caller, tier, url, signal \}\)/);
  assert.doesNotMatch(manual, /acquireGeneration|enforceDailyMessageQuota|chatCompletions/);
  assert.match(browser, /await openChatBrowser\(input, true\)/);
  assert.match(browser, /\.rpc\("claim_browserbase_slot_with_quota"/);
});
