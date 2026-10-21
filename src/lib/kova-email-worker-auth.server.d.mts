export type EmailWorkerIdentity = { runId: string; issuedAt: string };
export function signEmailWorkerRequest(identity: EmailWorkerIdentity, secret: string): string;
export function authenticateEmailWorkerRequest(
  request: Request,
  env?: { KOVA_EMAIL_WORKER_SECRET?: string },
  now?: number,
): EmailWorkerIdentity;
