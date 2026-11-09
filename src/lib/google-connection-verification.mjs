// One authenticated, read-only provider operation is the minimum verification
// proof. OAuth state, saved grants and local status refresh are not API reads.
// Only the success/failure boolean leaves this function; results stay private.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function verifyGoogleServiceRead(id, connectionId, api) {
  if (!["gmail", "google-calendar", "google-drive"].includes(id))
    throw new Error("unsupported_google_verification");
  if (typeof connectionId !== "string" || !UUID.test(connectionId))
    throw new Error("invalid_google_connection");
  if (!api || typeof api !== "object") throw new Error("google_verification_unavailable");

  let result;
  let key;
  if (id === "gmail") {
    if (typeof api.gmailSearch !== "function") throw new Error("google_verification_unavailable");
    result = await api.gmailSearch("in:anywhere", 1, connectionId);
    key = "messages";
  } else if (id === "google-calendar") {
    if (typeof api.calendarList !== "function") throw new Error("google_verification_unavailable");
    result = await api.calendarList({ maxResults: 1, connectionId });
    key = "events";
  } else {
    if (typeof api.driveSearch !== "function") throw new Error("google_verification_unavailable");
    result = await api.driveSearch("Kova connection verification", 1, connectionId);
    key = "files";
  }
  if (!result || typeof result !== "object" || !Array.isArray(result[key]))
    throw new Error("google_verification_invalid_response");
  return { service: id, verified: true };
}
