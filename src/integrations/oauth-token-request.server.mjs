// Notion's token endpoint uses HTTP Basic client authentication and a JSON
// payload, unlike the form-encoded exchanges used by the other adapters.
// https://developers.notion.com/reference/create-a-token
export function oauthTokenRequest({
  providerId,
  clientId,
  clientSecret,
  code,
  redirectUri,
  verifier,
}) {
  if (!clientId || !clientSecret) throw new Error("provider_not_configured");
  const fields = { grant_type: "authorization_code", code, redirect_uri: redirectUri };
  if (providerId === "notion") {
    return {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: JSON.stringify(fields),
    };
  }
  const body = new URLSearchParams({ ...fields, client_id: clientId, client_secret: clientSecret });
  if (verifier) body.set("code_verifier", verifier);
  return {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
  };
}
