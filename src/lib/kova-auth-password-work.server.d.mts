export class KovaPasswordCapacityError extends Error {
  readonly code: "kova_password_capacity";
  constructor();
}

export function createKovaPasswordWorkLimiter(options: {
  maxActive: number;
  maxQueued: number;
  maxQueueWaitMs?: number;
}): <T>(operation: () => T | PromiseLike<T>) => Promise<T>;
