import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const templates = [
  "signup.tsx",
  "invite.tsx",
  "magic-link.tsx",
  "recovery.tsx",
  "email-change.tsx",
  "reauthentication.tsx",
  "help-contact-autoreply.tsx",
  "help-contact-notification.tsx",
];

test("email brand system is light-default and dark-mode adaptive", async () => {
  const brand = await readFile(new URL("src/lib/email-templates/_brand.tsx", root), "utf8");

  assert.match(brand, /backgroundColor: brandColors\.bg/);
  assert.match(brand, /name="color-scheme" content="light dark"/);
  assert.match(brand, /@media \(prefers-color-scheme: dark\)/);
  assert.match(brand, /\[data-ogsc\]/);
  assert.match(brand, /mailto:support@kovagpt\.com/);
  assert.match(brand, /KovaGPT will never ask/);
  assert.doesNotMatch(brand, />\\s*Kova\\s*</);
  assert.match(brand, /\/privacy/);
  assert.match(brand, /\/terms/);
});

test("every KovaGPT email uses the shared brand system", async () => {
  for (const template of templates) {
    const source = await readFile(new URL(`src/lib/email-templates/${template}`, root), "utf8");
    assert.match(source, /from "\.\/_brand"/, `${template} must import the shared brand system`);
    assert.doesNotMatch(source, /const LOGO_URL/, `${template} must not define a separate logo`);
  }
});
