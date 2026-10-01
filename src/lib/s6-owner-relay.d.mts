export const S6_ORIGIN: string;
export const S6_CHECKS: string[];
export function createS6OwnerRelay(options?: {
  env?: Record<string, string | undefined>;
  clock?: () => number;
}): ((request: Request) => Promise<Response>) & {
  googleIdentityAllowed: (email: string) => boolean;
};
export const handleS6OwnerRelay: (request: Request) => Promise<Response>;
export function s6GoogleIdentityAllowed(email: string): boolean;
