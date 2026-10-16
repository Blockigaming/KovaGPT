import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderMagicLink } from "../../scripts/email/render-magic-link.mjs";

test("hosted email output preserves Supabase's exact confirmation variable and existing brand assets", async () => {
  const html = await renderMagicLink();
  assert.equal((await readFile("supabase/templates/magic-link.html", "utf8")).trim(), html);
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(links.filter((link) => link === "{{ .ConfirmationURL }}").length, 2);
  assert.deepEqual(
    links.filter((link) => link !== "{{ .ConfirmationURL }}"),
    ["mailto:support@kovagpt.com", "https://kovagpt.com/privacy", "https://kovagpt.com/terms"],
  );
  assert.match(html, /https:\/\/kovagpt.com\/kova-logo.png/);
  assert.match(html.replaceAll("<!-- -->", ""), /Continue to KovaGPT/);
  assert.match(html, /works once/);
  assert.match(html, /padding:16px 26px/);
  assert.doesNotMatch(html, /<script|onClick|\.TokenHash|\.RedirectTo|\.SiteURL/);
  assert.doesNotMatch(
    html,
    />\{\{ \.ConfirmationURL \}\}</,
    "do not display an unreadable credential URL",
  );
});
