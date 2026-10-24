// Browser-safe catalogue. Verification and requested recovery are operational
// messages, deliberately absent from these optional event preferences.
export const ACCOUNT_EMAIL_EVENTS = Object.freeze(
  [
    {
      key: "password_changed",
      label: "Password changed",
      description: "When your password is changed or reset.",
      defaultEnabled: true,
    },
    {
      key: "security_method_added",
      label: "Security method added",
      description: "When an authenticator or passkey is added.",
      defaultEnabled: true,
    },
    {
      key: "security_method_changed",
      label: "Security method changed",
      description: "When a security method or recovery codes are changed.",
      defaultEnabled: true,
    },
    {
      key: "security_method_removed",
      label: "Security method removed",
      description: "When an authenticator or passkey is removed.",
      defaultEnabled: true,
    },
    {
      key: "account_deletion_scheduled",
      label: "Account deletion scheduled",
      description: "When deletion is scheduled, with the recovery deadline.",
      defaultEnabled: true,
    },
    {
      key: "account_deleted",
      label: "Account deleted",
      description: "After account deletion has been completed and verified.",
      defaultEnabled: true,
    },
    {
      key: "new_login",
      label: "New sign-in",
      description: "When a successful sign-in creates a session.",
      defaultEnabled: true,
    },
    {
      key: "email_changed",
      label: "Email address changed",
      description: "When your verified account email address changes.",
      defaultEnabled: true,
    },
    {
      key: "account_recovered",
      label: "Account deletion canceled",
      description: "When a scheduled account deletion is canceled.",
      defaultEnabled: true,
    },
  ].map((event) => Object.freeze(event)),
);

export const DEFAULT_ACCOUNT_EMAIL_PREFERENCES = Object.freeze(
  Object.fromEntries(ACCOUNT_EMAIL_EVENTS.map((event) => [event.key, event.defaultEnabled])),
);

const KEYS = new Set(ACCOUNT_EMAIL_EVENTS.map((event) => event.key));
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function parseAccountEmailPreferencePatch(value) {
  if (!record(value)) return null;
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > KEYS.size) return null;
  if (entries.some(([key, enabled]) => !KEYS.has(key) || typeof enabled !== "boolean")) return null;
  return Object.fromEntries(entries);
}

export function parseAccountEmailPreferences(value) {
  const parsed = parseAccountEmailPreferencePatch(value);
  return parsed && Object.keys(parsed).length === KEYS.size ? parsed : null;
}
