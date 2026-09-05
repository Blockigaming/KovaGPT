import type { PushSubscriptionData } from "./push-policy.mjs";
export type VapidConfig = { publicKey: string; privateKey: string; subject: string };
export function encryptPushPayload(
  subscription: PushSubscriptionData,
  payload: Uint8Array,
  options?: { keyPair?: CryptoKeyPair; salt?: Uint8Array },
): Promise<Uint8Array>;
export function vapidAuthorization(
  endpoint: string,
  config: VapidConfig,
  now?: number,
): Promise<string>;
export function sendWebPush(
  subscription: PushSubscriptionData & {
    id: string;
    eventId: string;
    eventSource: "application" | "agent";
    eventAt: string;
  },
  config: VapidConfig,
  options: { assertCurrent: () => Promise<void>; signal: AbortSignal; fetchImpl?: typeof fetch },
): Promise<"sent" | "expired" | "retry">;
