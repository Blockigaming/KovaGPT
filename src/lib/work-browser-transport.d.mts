export type BrowserBinding = {
  phase: "check" | "admit_agent" | "catalog";
  ownerId: string;
  runId: string;
  sessionId: string;
  actor: "owner" | "agent";
  sequence?: number;
  epoch?: number;
  stepId?: string;
  inputHash?: string;
  approvalId?: string;
};
export type BrowserCommand = {
  ownerId: string;
  runId: string;
  sessionId: string;
  actor: "owner";
  sequence: number;
  expiresAt: number;
  operation:
    | "open"
    | "navigate"
    | "snapshot"
    | "click"
    | "fill"
    | "press"
    | "scroll"
    | "takeover"
    | "release"
    | "close";
  url?: string;
  view?: string;
  target?: string;
  text?: string;
  key?: string;
  delta?: number;
};
export type BrowserResult = {
  sessionId: string;
  runId: string;
  sequence: number;
  mode?: "takeover" | "agent";
  closed?: boolean;
  view?: string;
  url?: string;
  title?: string;
  text?: string;
  nodes?: Array<{
    id: string;
    label: string;
    kind: string;
    inputType: string;
    editable: boolean;
    disabled: boolean;
  }>;
};
export function verifyBrowserInvocation(
  configuration: unknown,
  raw: string,
  signature: string | null,
): Promise<{ requestId: string; payload: BrowserBinding }>;
export function browserRunnerCommand(
  configuration: unknown,
  input: BrowserCommand,
  signal?: AbortSignal,
  fetcher?: typeof fetch,
): Promise<BrowserResult>;
export function browserRunnerCapabilities(
  configuration: unknown,
  signal?: AbortSignal,
  fetcher?: typeof fetch,
): Promise<{
  protocol: "kova-browser-v1";
  available: true;
  origins: string[];
  maxSessionSeconds: 300;
}>;
export function createBrowserBackendAuthority(
  configuration: unknown,
  rawOrigin: string,
  fetcher?: typeof fetch,
): (
  payload: BrowserBinding,
  signal?: AbortSignal,
) => Promise<{ allowed: true; sequence: number; expiresAt: number }>;
