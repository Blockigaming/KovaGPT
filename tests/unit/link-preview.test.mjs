import assert from "node:assert/strict";
import test from "node:test";
import {
  extractLinkPreviewUrls,
  normalizeLinkPreviewUrl,
  fallbackLinkTitle,
} from "../../src/lib/link-preview.mjs";
import {
  isPublicPreviewIpv4,
  safePreviewTarget,
  extractHtmlLinkPreview,
} from "../../src/lib/link-preview.server.mjs";

test("detects distinct links in a draft, including a YouTube short and GitHub file", () => {
  assert.deepEqual(
    extractLinkPreviewUrls("Look: https://www.youtube.com/shorts/ABC123, and https://github.com/o/r/blob/main/app.ts."),
    ["https://www.youtube.com/shorts/ABC123", "https://github.com/o/r/blob/main/app.ts"],
  );
  assert.deepEqual(extractLinkPreviewUrls("https://example.com https://example.com"), ["https://example.com/"]);
  assert.equal(fallbackLinkTitle("https://www.github.com/o/r"), "github.com");
});

test("previews only supported HTTPS links without credentials, custom ports, or fragments", () => {
  assert.equal(normalizeLinkPreviewUrl("http://example.com"), null);
  assert.equal(normalizeLinkPreviewUrl("https://user:pass@example.com/private"), null);
  assert.equal(normalizeLinkPreviewUrl("https://example.com:9999/a"), null);
  assert.equal(normalizeLinkPreviewUrl("https://example.com/page#secret"), "https://example.com/page");
  assert.equal(safePreviewTarget("https://localhost/"), null);
  assert.equal(safePreviewTarget("https://sub.internal/"), null);
  assert.equal(safePreviewTarget("https://127.0.0.1/"), null);
});

test("blocks private, special-use and reserved IPv4 addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.1", "169.254.169.254", "100.64.1.2", "0.0.0.0", "198.18.0.1", "203.0.113.3"]) {
    assert.equal(isPublicPreviewIpv4(ip), false, ip);
  }
  assert.equal(isPublicPreviewIpv4("8.8.8.8"), true);
});

test("extracts specific page title, safely decodes entities and restricts icon to same-origin", () => {
  const page = new URL("https://github.com/org/repo");
  const html = '<head><title>Generic</title><meta property="og:title" content="A repo &amp; its code"><link rel="icon" href="/assets/mark.svg"></head>';
  assert.deepEqual(extractHtmlLinkPreview(html, page), {
    title: "A repo & its code",
    faviconUrl: "https://github.com/assets/mark.svg",
  });
  const hostileIcon = '<head><title>Example page</title><link rel="icon" href="http://localhost/internal"></head>';
  assert.deepEqual(extractHtmlLinkPreview(hostileIcon, page), {
    title: "Example page",
    faviconUrl: "https://github.com/favicon.ico",
  });
});
