export type PushSubscriptionData = { endpoint: string; p256dh: string; auth: string };
export type QuietHours = { start: string; end: string; timeZone: string };
export function pushEndpoint(value: unknown): URL;
export function decodePushKey(value: unknown, size: number): Uint8Array;
export function encodePushKey(bytes: Uint8Array): string;
export function normalizePushSubscription(value: unknown): PushSubscriptionData;
export function normalizeQuietHours(value: unknown): QuietHours | null;
export function isPushQuiet(value: unknown, now?: number): boolean;
