import assert from "node:assert/strict";
import test from "node:test";
import { verifiedConnectionReadDates } from "../../src/integrations/verified-reads.mjs";

const flows = {
  outlook: { provider: "microsoft", label: "Outlook" },
  onedrive: { provider: "microsoft", label: "OneDrive" },
  calendly: { provider: "calendly", label: "Calendly" },
};
const account = {
  id: "account-1",
  provider_id: "microsoft",
  updated_at: "2026-11-08T22:00:00Z",
  last_success_at: "2026-11-08T22:00:00Z",
};
const read = (label, created_at = "2026-11-08T22:01:00Z") => ({
  linked_account_id: "account-1",
  event_type: "read",
  result: "success",
  safe_summary: `Read ${label} search results`,
  created_at,
});

test("OAuth success and another service never verify an Outlook read", () => {
  const dates = verifiedConnectionReadDates(
    [account],
    [
      { ...read("Outlook"), event_type: "connect" },
      read("OneDrive"),
      { ...read("Outlook"), result: "failure" },
      { ...read("Calendly"), linked_account_id: "account-2" },
    ],
    flows,
  );
  assert.equal(dates["account-1"]?.outlook, undefined);
  assert.equal(dates["account-1"]?.onedrive, "2026-11-08T22:01:00Z");
  assert.equal(dates["account-2"], undefined);
});

test("verification is invalidated when the grant was refreshed or reconnected", () => {
  const dates = verifiedConnectionReadDates(
    [{ ...account, updated_at: "2026-11-08T22:05:00Z" }],
    [read("Outlook"), read("Outlook", "2026-11-08T22:06:00Z")],
    flows,
  );
  assert.equal(dates["account-1"].outlook, "2026-11-08T22:06:00Z");
});

test("unknown accounts, malformed timestamps and other providers do not count", () => {
  const dates = verifiedConnectionReadDates(
    [account],
    [
      { ...read("Outlook"), linked_account_id: "unknown" },
      { ...read("Calendly"), created_at: "not-a-date" },
      { ...read("Calendly"), linked_account_id: "account-1" },
    ],
    flows,
  );
  assert.equal(dates["account-1"], undefined);
});
