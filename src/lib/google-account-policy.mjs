// Each Connect action requests only the selected service. Google identity scopes
// are shared so the existing owner/account binding remains intact.
export const GOOGLE_CONNECTOR_SCOPES = Object.freeze({
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
  "google-calendar": ["https://www.googleapis.com/auth/calendar.events"],
  "google-drive": ["https://www.googleapis.com/auth/drive.readonly"],
});
export function googleConnectorScopes(
  connector = "gmail",
  access = connector === "google-drive" ? "read" : "read-write",
) {
  if (!Object.hasOwn(GOOGLE_CONNECTOR_SCOPES, connector))
    throw new Error("google_invalid_connector");
  if (access !== "read" && access !== "read-write") throw new Error("google_invalid_access");
  const scopes =
    access === "read" && connector === "gmail"
      ? [GOOGLE_CONNECTOR_SCOPES.gmail[0]]
      : access === "read" && connector === "google-calendar"
        ? ["https://www.googleapis.com/auth/calendar.events.readonly"]
        : access === "read-write" && connector === "google-drive"
          ? [...GOOGLE_CONNECTOR_SCOPES[connector], "https://www.googleapis.com/auth/drive.file"]
          : GOOGLE_CONNECTOR_SCOPES[connector];
  return ["openid", "email", "profile", ...scopes].join(" ");
}

export const GOOGLE_CAPABILITY_SCOPES = {
  "gmail.modify": ["https://www.googleapis.com/auth/gmail.modify"],
  "gmail.read": [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
  "gmail.write": [
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
  "gmail.draft": [
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
  "calendar.read": [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar",
  ],
  "calendar.write": [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar",
  ],
  "drive.write": [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive",
  ],
  "drive.read": [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ],
};
export function hasGoogleCapability(scopes, capability) {
  const list = typeof scopes === "string" ? scopes.split(/\s+/u) : scopes;
  return (
    Array.isArray(list) &&
    Boolean(GOOGLE_CAPABILITY_SCOPES[capability]?.some((scope) => list.includes(scope)))
  );
}
export function parseGoogleBinding(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("google_invalid_account_selection");
  const result = {};
  for (const key of ["connectionId", "grantId"]) {
    if (value[key] == null) continue;
    if (
      typeof value[key] !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value[key])
    )
      throw new Error("google_invalid_account_selection");
    result[key] = value[key];
  }
  if (value.expectedGoogleSub != null) {
    if (
      typeof value.expectedGoogleSub !== "string" ||
      value.expectedGoogleSub.length < 1 ||
      value.expectedGoogleSub.length > 255
    )
      throw new Error("google_invalid_account_selection");
    result.expectedGoogleSub = value.expectedGoogleSub;
  }
  if (value.capability != null) {
    if (!Object.hasOwn(GOOGLE_CAPABILITY_SCOPES, value.capability))
      throw new Error("google_invalid_account_selection");
    result.capability = value.capability;
  }
  return result;
}
export function googleConnectionHealth(connection, now = Date.now()) {
  const scopes = (connection?.scopes ?? "").split(/\s+/u).filter(Boolean);
  const has = {
    gmail: hasGoogleCapability(scopes, "gmail.read"),
    gmailWrite: hasGoogleCapability(scopes, "gmail.write"),
    calendar: hasGoogleCapability(scopes, "calendar.read"),
    calendarWrite: hasGoogleCapability(scopes, "calendar.write"),
    drive: hasGoogleCapability(scopes, "drive.read"),
    driveWrite: hasGoogleCapability(scopes, "drive.write"),
  };
  if (!connection) return { connected: false, state: "disconnected", scopes, has };
  const expiry = Date.parse(connection.expires_at);
  const reauthorize =
    connection.reauthorization_required ||
    !connection.google_sub ||
    !Number.isFinite(expiry) ||
    (expiry <= now + 5000 && !connection.has_refresh_token);
  return {
    id: connection.id,
    connectionRevision: connection.credential_revision,
    email: connection.email,
    connected: !reauthorize,
    state: reauthorize
      ? "reauthorization_required"
      : has.gmail && has.gmailWrite && has.calendar && has.calendarWrite && has.drive
        ? "connected"
        : "permission_incomplete",
    scopes,
    has,
  };
}
export function googleToolCapability(name) {
  if (name === "gmail_create_draft") return "gmail.draft";
  if (name === "gmail_send") return "gmail.write";
  if (name.startsWith("gmail_")) return "gmail.read";
  if (name === "calendar_create_event") return "calendar.write";
  if (name.startsWith("calendar_")) return "calendar.read";
  if (name.startsWith("drive_")) return "drive.read";
  throw new Error("google_unknown_tool");
}
