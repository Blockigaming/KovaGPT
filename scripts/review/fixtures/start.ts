export const useServerFn = <T>(fn: T): T => fn;
export function createServerFn() {
  const chain = {
    inputValidator: () => chain,
    validator: () => chain,
    middleware: () => chain,
    handler: () => async () => {
      throw new Error("Server action unavailable in this offline review.");
    },
  };
  return chain;
}
export function createMiddleware() {
  const chain = {
    middleware: () => chain,
    validator: () => chain,
    server: () => chain,
    client: () => chain,
  };
  return chain;
}
