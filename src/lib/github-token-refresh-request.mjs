// GitHub user-to-server tokens can expire after 8 hours. Refresh tokens
// rotate: do not reuse a grant while another worker is refreshing it.
export function githubTokenRefreshRequest(clientId, clientSecret, refreshToken) {
  if (
    typeof clientId !== "string" ||
    !clientId ||
    typeof clientSecret !== "string" ||
    !clientSecret ||
    typeof refreshToken !== "string" ||
    !refreshToken
  )
    throw new Error("github_refresh_not_configured");

  return {
    url: "https://github.com/login/oauth/access_token",
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    },
  };
}

export function selectRotatedGithubTokens(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.error ||
    typeof value.access_token !== "string" ||
    !value.access_token ||
    typeof value.refresh_token !== "string" ||
    !value.refresh_token ||
    value.token_type !== "bearer" ||
    !Number.isSafeInteger(value.expires_in) ||
    value.expires_in <= 0 ||
    value.expires_in > 86_400
  )
    throw new Error("github_refresh_invalid_response");
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresIn: value.expires_in,
  };
}
