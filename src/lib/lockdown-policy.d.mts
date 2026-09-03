export type LockdownCapability =
  | "live_web"
  | "deep_research"
  | "agent"
  | "connector_read"
  | "connector_write"
  | "canvas_network"
  | "remote_download";

export const LOCKDOWN_CAPABILITIES: readonly LockdownCapability[];

export class LockdownPolicyError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, cause?: unknown);
}

export function lockdownEnabledFromSettings(settings: unknown): boolean;
export function readLockdownMode(client: unknown, userId: string): Promise<boolean>;
export function assertLockdownAllows(
  client: unknown,
  userId: string,
  capability: LockdownCapability,
): Promise<void>;
export function lockdownErrorResponse(error: unknown): Response | null;
export function enforceLockdownCapability(
  client: unknown,
  userId: string,
  capability: LockdownCapability,
): Promise<Response | null>;
