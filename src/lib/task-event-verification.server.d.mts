export type VerifiedTaskEvent = {
  provider: "gmail" | "slack" | "github";
  eventKey: string;
  scopeKey: string;
  resource: string;
  occurredAt: string;
  reference: Record<string, unknown>;
};
export function verifyGooglePushToken(
  token: string,
  config: { audience: string; serviceAccount: string },
  options?: { fetchImpl?: typeof fetch; now?: number },
): Promise<boolean>;
export function verifyTaskProviderEvent(
  provider: string,
  request: Request,
  config: {
    slackSecret?: string;
    slackAppId?: string;
    githubSecret?: string;
    gmailAudience?: string;
    gmailServiceAccount?: string;
    gmailSubscription?: string;
  },
  options?: { fetchImpl?: typeof fetch; now?: number },
): Promise<VerifiedTaskEvent | { ignored: true } | { challenge: string }>;
