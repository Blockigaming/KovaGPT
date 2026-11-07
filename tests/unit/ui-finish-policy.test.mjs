import assert from "node:assert/strict";
import test from "node:test";
import { requiresAppAccount } from "../../src/lib/app-access-policy.mjs";
import { DAILY_PLAN_ALLOWANCES, planAllowance } from "../../src/lib/plan-usage-policy.mjs";
import {
  normalizeSidebarLayout,
  readSidebarLayout,
  saveSidebarLayout,
  sidebarLayoutKey,
  sidebarColors,
} from "../../src/lib/sidebar-layout.mjs";
import { normalizeImageRequest } from "../../src/lib/multimodal/image-request-policy.mjs";
import {
  supportsImageEdits,
  validCustomImageSize,
} from "../../src/lib/multimodal/image-size-policy.mjs";
import {
  createShareToken,
  shareTokenHash,
  publicShareSnapshot,
} from "../../src/lib/public-chat-share-policy.mjs";
import { contextualHelp, diagnosticCoverage } from "../../src/lib/help-diagnostics.mjs";

test("account gate covers application tools while public help and shared links remain readable", () => {
  for (const path of [
    "/",
    "/images",
    "/library?q=a",
    "/settings/appearance",
    "/scheduled-tasks",
    "/discovery",
    "/apps",
    "/apps/github/connect",
    "/apps/google-drive/private-action",
    "/writing/paragraph-rewriter",
    "/translate/english-to-french",
    "/projects/one",
    "/work",
    "/omega",
    "/prompt-studio",
    "/write",
    "/sites",
    "/developers/console",
    "/developers/connections",
  ])
    assert.equal(requiresAppAccount(path), true, path);
  for (const path of [
    "/help",
    "/privacy",
    "/terms",
    "/pricing",
    "/share/opaque",
    "/auth/callback",
    "/connect",
    "/ai-writer",
    "/ai-image-generator",
    "/ai-humanizer",
    "/humanize-ai-text",
    "/apps/google-drive",
    "/apps/gmail",
    "/apps/google-calendar",
    "/apps/github",
    "/apps/canva",
    "/apps/powerpoint",
    "/apps/spotify",
  ])
    assert.equal(requiresAppAccount(path), false, path);
});
test("all daily allowances and token quotas follow Free 1/5 and Pro 15x of Plus", () => {
  for (const kind of ["chats", "images", "uploads"]) {
    assert.equal(DAILY_PLAN_ALLOWANCES.free[kind] * 5, DAILY_PLAN_ALLOWANCES.plus[kind]);
    assert.equal(DAILY_PLAN_ALLOWANCES.pro[kind], DAILY_PLAN_ALLOWANCES.plus[kind] * 15);
  }
  assert.equal(planAllowance(50000, "free"), 10000);
  assert.equal(planAllowance(50000, "pro"), 750000);
  assert.equal(planAllowance(50000, "guest"), 0);
  assert.throws(() => planAllowance(50000, "fake"));
});
test("sidebar preferences isolate owners, survive reload, reject CSS injection and clamp resize bounds", () => {
  const values = new Map(),
    storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
  const chosen = normalizeSidebarLayout({
    width: 9999,
    color: "#204030",
    shortcuts: ["library", "work", "evil", "library"],
    searchPosition: "navigation",
    recentChats: false,
  });
  assert.equal(chosen.width, 420);
  assert.deepEqual(chosen.shortcuts, ["library"]);
  assert.equal(saveSidebarLayout(storage, "a", chosen), true);
  assert.deepEqual(readSidebarLayout(storage, "a"), chosen);
  assert.notDeepEqual(readSidebarLayout(storage, "b"), chosen);
  assert.equal(sidebarLayoutKey(null), null);
  assert.deepEqual(sidebarColors("red;url(x)"), {});
  assert.equal(normalizeSidebarLayout({ width: 0, color: "url(x)" }).color, "default");
});
test("five image shapes plus custom sizes reach the authenticated payload with strict pixel bounds", () => {
  for (const ratio of ["1:1", "3:2", "2:3", "16:9", "9:16"]) {
    const settings = normalizeImageRequest(
      { prompt: "A lake", aspectRatio: ratio },
      { provider: "openai", customSizesSupported: true },
    );
    assert.equal(validCustomImageSize(settings.size), true);
  }
  assert.equal(
    normalizeImageRequest(
      { prompt: "A lake", aspectRatio: "custom", size: "2048x1152" },
      { customSizesSupported: true },
    ).size,
    "2048x1152",
  );
  for (const size of [
    "1025x1024",
    "9999x1024",
    "256x256",
    "3840x3840",
    "64x2048",
    "1024x1024;bad",
  ]) {
    assert.equal(validCustomImageSize(size), false, size);
    assert.throws(() =>
      normalizeImageRequest(
        { prompt: "A lake", aspectRatio: "custom", size },
        { customSizesSupported: true },
      ),
    );
  }
  assert.equal(supportsImageEdits("gpt-image-2.5-flare"), true);
  assert.equal(supportsImageEdits("unknown"), false);
});
test("public links use unguessable tokens, store only digests and share a fixed text-only snapshot", async () => {
  const first = createShareToken(),
    second = createShareToken();
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  assert.notEqual(await shareTokenHash(first), first);
  const chat = {
    title: "Review",
    messages: [
      { role: "user", content: "Hello", attachments: [{ secret: "private" }] },
      { role: "assistant", content: "Hi", activities: [{ secret: "private" }] },
    ],
  };
  const snapshot = publicShareSnapshot(chat);
  chat.messages[0].content = "Changed";
  assert.equal(snapshot.snapshot.messages[0].content, "Hello");
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
  assert.throws(() => publicShareSnapshot({ ...chat, temporary: true }));
  assert.throws(() => publicShareSnapshot({ messages: [] }));
});
test("guided diagnostics vary by actual setup without generating duplicate article records", () => {
  const faq = { category: "Chat & modes", answer: "Check your draft." };
  const offline = contextualHelp(faq, {
    environment: "safari-iphone",
    connection: "offline",
    plan: "free",
  });
  const online = contextualHelp(faq, {
    environment: "edge-windows",
    connection: "online",
    plan: "pro",
  });
  assert.notDeepEqual(offline, online);
  assert.match(offline.join(" "), /Reconnect/);
  assert.match(online.join(" "), /3,750 regular messages and 750 Thinking/);
  assert.equal(diagnosticCoverage(100), 115200);
  assert.throws(() =>
    contextualHelp(faq, { environment: "fake", connection: "online", plan: "pro" }),
  );
});

test("browser metadata rejects external previews and stale sessions without inventing activity", async () => {
  const { normalizeBrowserActivity, browserActivityIsFresh } =
    await import("../../src/lib/browser-activity-contract.mjs");
  assert.equal(normalizeBrowserActivity({ tabCount: 5 }), undefined);
  const metadata = normalizeBrowserActivity({
    sessionId: "real-session",
    tabCount: 5,
    observedAt: Date.now(),
    url: "https://example.com/page",
    previewPath: "https://evil.test/image",
  });
  assert.equal(metadata.hostname, "example.com");
  assert.equal(metadata.previewPath, undefined);
  assert.equal(browserActivityIsFresh(metadata), true);
  assert.equal(browserActivityIsFresh({ ...metadata, observedAt: Date.now() - 600000 }), false);
  assert.equal(
    normalizeBrowserActivity({ ...metadata, previewPath: "/api/browser/preview/real-session?v=1" })
      .previewPath,
    "/api/browser/preview/real-session?v=1",
  );
});
