export class KovaPasswordCapacityError extends Error {
  constructor() {
    super("Password processing is temporarily unavailable");
    this.name = "KovaPasswordCapacityError";
    this.code = "kova_password_capacity";
  }
}

// Each limiter belongs to one server process. Distributed endpoint rate limits
// remain necessary; this bounds this process's simultaneous memory-hard work.
export function createKovaPasswordWorkLimiter({ maxActive, maxQueued, maxQueueWaitMs = 2000 }) {
  if (
    !Number.isSafeInteger(maxActive) ||
    maxActive < 1 ||
    !Number.isSafeInteger(maxQueued) ||
    maxQueued < 0 ||
    !Number.isSafeInteger(maxQueueWaitMs) ||
    maxQueueWaitMs < 1
  ) {
    throw new RangeError("Invalid password work limits");
  }
  let active = 0;
  const waiters = [];

  async function acquire() {
    if (active < maxActive) {
      active += 1;
      return;
    }
    if (waiters.length >= maxQueued) throw new KovaPasswordCapacityError();
    // A completed operation transfers its occupied slot directly to the next
    // waiter, so a new arrival cannot jump ahead or exceed the active limit.
    await new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        deadline: Date.now() + maxQueueWaitMs,
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index < 0) return;
        waiters.splice(index, 1);
        reject(new KovaPasswordCapacityError());
      }, maxQueueWaitMs);
      waiters.push(waiter);
    });
  }

  function release() {
    for (let next = waiters.shift(); next; next = waiters.shift()) {
      clearTimeout(next.timer);
      if (Date.now() >= next.deadline) {
        next.reject(new KovaPasswordCapacityError());
        continue;
      }
      next.resolve();
      return;
    }
    active -= 1;
  }

  return async function runPasswordWork(operation) {
    if (typeof operation !== "function") throw new TypeError("Invalid password work operation");
    await acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  };
}
