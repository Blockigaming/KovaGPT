export function sealPushSubscription(
  value: unknown,
  ownerId: string,
  id: string,
  secret: string,
): Promise<string>;
export function openPushSubscription(
  value: string,
  ownerId: string,
  id: string,
  secret: string,
): Promise<unknown>;
