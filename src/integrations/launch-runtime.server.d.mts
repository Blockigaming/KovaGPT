type Principal = { ownerId: string; sessionId: string; connector: string };
export type LaunchRead = Principal & {
  accountId: string;
  operation: string;
  args?: Record<string, unknown>;
  cursor?: string | null;
};
export type LaunchRuntime = {
  begin(input: Principal & { browserNonce: string; origin: string; returnPath?: string }): Promise<{
    url: string;
    consent: { provider: string; mode: string; scopes: readonly string[] };
  }>;
  complete(input: {
    connector: string;
    state: string;
    code: string;
    browserNonce: string;
    origin: string;
  }): Promise<{ account: unknown; returnPath: string }>;
  execute(
    input: LaunchRead,
  ): Promise<{ items: unknown[]; nextCursor: string | null; contentIsUntrusted: boolean }>;
  disconnect(input: { ownerId: string; connector: string; accountId: string }): Promise<{
    localDisconnected: boolean;
    providerRevoked: boolean;
    remoteStatus: string;
    cleanupRecorded: boolean;
  }>;
};
export function createLaunchRuntime(dependencies: {
  db: unknown;
  encrypt: (value: string) => Promise<string>;
  decrypt: (value: string) => Promise<string>;
  assertSession: (ownerId: string, sessionId: string) => Promise<void>;
  assertAllowed: (
    ownerId: string,
    capability: "connector_read" | "connector_write",
  ) => Promise<unknown>;
  env?: Record<string, string | undefined>;
  transport?: { signal?: AbortSignal; fetchImpl?: typeof fetch };
  assertCertified?: (id: string) => void;
}): LaunchRuntime;
