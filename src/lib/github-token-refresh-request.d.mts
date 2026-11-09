export function githubTokenRefreshRequest(
  clientId: string | undefined,
  clientSecret: string | undefined,
  refreshToken: string,
): {
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    body: URLSearchParams;
    redirect: "error";
    signal: AbortSignal;
  };
};

export function selectRotatedGithubTokens(value: unknown): {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};
