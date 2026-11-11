import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notificationDefinition } from "../../src/lib/notification-catalog.mjs";

test("authentication notices use actionable responsive sheets, not inert inline errors", () => {
  for (const id of ["sign_in_required", "session_expired"]) {
    assert.equal(notificationDefinition(id)?.surface, "sheet");
  }
  const host = readFileSync("src/components/KovaNotificationSurface.tsx", "utf8");
  assert.match(host, /useClerkSafe\(\)/);
  assert.match(host, /authenticationNeeded \? openSignIn/);
  assert.match(host, /await primaryAction\(\)/);
  assert.match(host, /primaryActionLabel/);
});

test("signed-in auth context contains the global notification host", () => {
  const root = readFileSync("src/routes/__root.tsx", "utf8");
  const open = root.indexOf("<ClerkProvider>");
  const host = root.indexOf("<RootNotificationCenter />");
  const close = root.indexOf("</ClerkProvider>");
  assert.ok(open >= 0 && host > open && host < close);
});
