export function browserOrigin(value: string): string;
export function createBrowserEgress(options: {
  origins: string[];
  assertAuthority: () => void | Promise<void>;
  publicWeb?: boolean;
}): (
  input: { url: string; method: string; headers: Record<string, string>; bodyBase64: string },
  options?: { signal?: AbortSignal; allowWrites?: boolean },
) => Promise<{ status: number; headers: Record<string, string>; bodyBase64: string }>;
