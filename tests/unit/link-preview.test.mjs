import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanLinkTitle,
  COMPOSER_LINK_MARKER,
  firstLinkPreviewToken,
  toComposerLinkDisplay,
  fromComposerLinkDisplay,
  fallbackLinkTitle,
  firstLinkPreviewUrl,
  isOnlyLink,
  normalizeLinkPreviewUrl,
  readPageLinkMetadata,
  siteNameForLink,
} from "../../src/lib/link-preview.mjs";
import { resolveLinkPreview } from "../../src/lib/link-preview.server.mjs";

test("composer extracts a specific YouTube video and preserves its canonical URL", () => {
  const url = "https://www.youtube.com/watch?v=Qwerty12345";
  assert.equal(firstLinkPreviewUrl("Please summarize " + url + "."), url);
  assert.equal(siteNameForLink(url), "YouTube");
  assert.equal(isOnlyLink(url, url), true);
  assert.equal(isOnlyLink("Summarize " + url, url), false);
});

test("GitHub repository links keep their owner and repository even before metadata loads", () => {
  const url = "https://github.com/Blockigaming/KovaGPT";
  assert.equal(firstLinkPreviewUrl("Look at " + url), url);
  assert.equal(fallbackLinkTitle(url), "Blockigaming/KovaGPT");
});

test("rejects credentials, local hosts, address literals, http, and non-default ports", () => {
  for (const value of [
    "http://example.org/page",
    "https://user:pass@example.org",
    "https://localhost/private",
    "https://service.internal/secret",
    "https://127.0.0.1/private",
    "https://[::1]/",
    "https://example.org:8443/page",
    "javascript:alert(1)",
  ]) {
    assert.equal(normalizeLinkPreviewUrl(value), null, value);
  }
});

test("metadata uses actual document title, decoded entities, site name, and same-host favicon", () => {
  const html = [
    "<html><head>",
    '<meta content="My &amp; Your Article" property="og:title">',
    '<meta property="og:site_name" content="Publishing Site">',
    '<link rel="shortcut icon" href="/assets/icon.ico">',
    "<title>Ignored default title</title>",
    "</head></html>",
  ].join("");
  assert.deepEqual(readPageLinkMetadata(html, "https://news.example.org/story"), {
    title: "My & Your Article",
    siteName: "Publishing Site",
    iconUrl: "https://news.example.org/assets/icon.ico",
  });
  assert.equal(cleanLinkTitle("<script>alert(1)</script>Hello &mdash; there"), "alert(1)Hello — there");
});

test("favicon URLs on unrelated hosts are not selected", () => {
  const result = readPageLinkMetadata(
    '<head><link rel="icon" href="https://tracker.invalid/icon.png"><title>Story</title></head>',
    "https://news.example.org/story",
  );
  assert.equal(result.iconUrl, null);
  assert.equal(result.title, "Story");
});

test("YouTube oEmbed resolves the specific video title, not the YouTube homepage", async () => {
  const calls = [];
  const read = async (input) => {
    calls.push(input);
    return {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      bodyBase64: Buffer.from(JSON.stringify({ title: "Build a Handwriting Plotter" })).toString(
        "base64",
      ),
    };
  };
  const result = await resolveLinkPreview("https://youtu.be/zkMitXDo5es", undefined, read);
  assert.equal(result?.title, "Build a Handwriting Plotter");
  assert.equal(result?.siteName, "YouTube");
  assert.equal(result?.iconUrl, "https://www.youtube.com/favicon.ico");
  assert.ok(calls[0].url.startsWith("https://www.youtube.com/oembed?"));
  assert.equal(calls[0].headers.authorization, undefined);
});

test("general public pages return the actual Open Graph page title", async () => {
  const html = '<html><head><meta property="og:title" content="A repository issue page"></head></html>';
  const read = async () => ({
    status: 200,
    headers: { "content-type": "text/html" },
    bodyBase64: Buffer.from(html).toString("base64"),
  });
  const result = await resolveLinkPreview("https://github.com/example/repo/issues/12", undefined, read);
  assert.equal(result?.title, "A repository issue page");
  assert.equal(result?.siteName, "GitHub");
});

test("unsafe redirect does not fetch a local network destination", async () => {
  let count = 0;
  const read = async () => {
    count += 1;
    return {
      status: 302,
      headers: { location: "http://127.0.0.1/latest/meta-data" },
      bodyBase64: "",
    };
  };
  const result = await resolveLinkPreview("https://example.org/start", undefined, read);
  assert.equal(count, 1);
  assert.equal(result?.title, "example.org");
});

test("pasted page links render as one invisible editor position, retaining canonical URL", () => {
  const url = "https://www.youtube.com/watch?v=zkMitXDo5es";
  const canonical = "Explain this " + url + " please";
  const token = firstLinkPreviewToken(canonical);
  assert.equal(token?.raw, url);
  assert.equal(token?.start, "Explain this ".length);
  assert.equal(token?.end, "Explain this ".length + url.length);
  const compact = toComposerLinkDisplay(canonical, token.raw);
  assert.equal(compact, "Explain this " + COMPOSER_LINK_MARKER + " please");
  assert.equal(fromComposerLinkDisplay(compact, token.raw), canonical);
  // One Backspace on the marker removes every URL character in one operation.
  const afterBackspace = compact.replace(COMPOSER_LINK_MARKER, "");
  assert.equal(afterBackspace, "Explain this  please");
  // Keeping the marker while typing leaves the original URL untouched.
  assert.equal(
    fromComposerLinkDisplay(compact + " next", token.raw),
    canonical + " next",
  );
});

test("unmodified nonlink drafts never get an atomic marker", () => {
  assert.equal(firstLinkPreviewToken("ordinary text"), null);
  assert.equal(toComposerLinkDisplay("ordinary text", ""), "ordinary text");
});
