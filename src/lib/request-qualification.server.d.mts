export type CapturePlan = {
  version: 1;
  operationId: string;
  ownerId: string;
  chatId: string;
  source: { commit: string; tree: string };
  authMode: "supabase" | "kova";
  evidenceKind: "actual-account-request-capture" | "synthetic-fixture";
  notBefore: string;
  expiresAt: string;
};
export type RequestCapture = {
  plan: CapturePlan;
  planSha256: string;
  directory: string;
  validate: () => void;
};
export class RequestCaptureError extends Error {
  status: number;
}
export function readRequestCapturePlan(input: {
  request: Request;
  getEnv: (name: string) => string | undefined;
  buildSha: string;
  now?: () => number;
}): RequestCapture | null;
export function authorizeRequestCapture(input: {
  capture: RequestCapture;
  auth: unknown;
  ingress: unknown;
  signal: AbortSignal;
}): Promise<void>;
export function boundedCaptureBody(body: Record<string, unknown>): Record<string, unknown>;
export function captureConstructedRequest(input: {
  capture: RequestCapture;
  body: Record<string, unknown>;
  authMode: string;
  signal: AbortSignal;
  now?: () => number;
}): Promise<Record<string, unknown>>;
