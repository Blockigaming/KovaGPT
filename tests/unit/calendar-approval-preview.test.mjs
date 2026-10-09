import assert from "node:assert/strict";
import test from "node:test";
import { validateSupportedGoogleWrite } from "../../src/lib/google-write-validation.server.mjs";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

const { summarizeWriteTool } = loadUiModule("src/lib/google-tools.server.ts", {
  "@supabase/supabase-js": {
    createClient() {
      throw new Error("Preview must not access a database");
    },
  },
  "@/lib/google-oauth.server": {},
  "@/lib/google-write-validation.server.mjs": {},
  "@/lib/google-account-policy.mjs": {},
  "@/lib/connectors.server": {},
  "@/lib/lockdown-policy.mjs": {},
});

const event = validateSupportedGoogleWrite("calendar_create_event", {
  summary: `${"Planning details ".repeat(12)}FINAL TITLE`,
  description: `${"Complete review details. ".repeat(45)}FINAL DESCRIPTION`,
  location: `${"Building and floor details ".repeat(9)}FINAL LOCATION`,
  start: "2026-10-12T09:00:00-04:00",
  end: "2026-10-12T10:00:00-04:00",
  timezone: "America/New_York",
  attendees: Array.from({ length: 13 }, (_, index) => `attendee-${index + 1}@example.com`),
});

test("Calendar approval preserves every validated field and all recipients after the tenth", () => {
  const { preview } = summarizeWriteTool("calendar_create_event", event);
  for (const field of ["summary", "description", "location", "start", "end", "timezone"])
    assert.equal(preview[field], event[field], `${field} must not be shortened or omitted`);
  assert.equal(preview.calendar, "Primary calendar");
  assert.deepEqual(Array.from(preview.attendees), event.attendees);
  assert.notEqual(preview.attendees, event.attendees);
});

for (const decision of ["confirm", "cancel"]) {
  test(`Calendar card renders complete details and sends only the staged action's ${decision}`, async () => {
    const hooks = createHookHarness();
    const calls = [];
    const updates = [];
    const { ToolConfirmCard } = loadUiModule("src/components/ToolConfirmCard.tsx", {
      react: hooks.react,
      "lucide-react": new Proxy({}, { get: (_, name) => String(name) }),
      sonner: { toast: { success() {}, error() {}, warning() {} } },
      "@/lib/auth-fetch": {
        async authFetch(url, options) {
          calls.push({ url, options });
          return { ok: true, json: async () => ({ ok: true, result_text: "Fixture result" }) };
        },
      },
    });
    const summary = summarizeWriteTool("calendar_create_event", event);
    const confirmation = {
      tool: "calendar_create_event",
      actionId: "11111111-1111-4111-8111-111111111111",
      status: "pending",
      summary: summary.summary,
      argsPreview: { ...summary.preview, google_account: "selected-owner@example.com" },
    };
    const tree = hooks.render(ToolConfirmCard, {
      confirm: confirmation,
      onUpdate: (value) => updates.push(value),
    });
    const visible = text(tree);
    for (const value of [
      event.summary,
      event.description,
      event.location,
      event.start,
      event.end,
      event.timezone,
      ...event.attendees,
      "Primary calendar",
      "selected-owner@example.com",
    ])
      assert.ok(visible.includes(value), `Missing approval detail: ${value}`);
    assert.equal(calls.length, 0, "Rendering must never approve an action");
    const button = elements(
      tree,
      (element) =>
        element.type === "button" &&
        text(element).trim() === (decision === "confirm" ? "Confirm" : "Cancel"),
    )[0];
    assert.ok(button);
    await button.props.onClick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/chat/confirm");
    assert.equal(calls[0].options.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      action_id: confirmation.actionId,
      decision,
    });
    assert.equal(updates.at(-1).status, decision === "confirm" ? "confirmed" : "cancelled");
  });
}
