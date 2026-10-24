export type EmailWorkerConfig = {
  publicOrigin: string;
  databaseOrigin: string;
  serviceKey: string;
  resendKey: string;
  authEnabled: boolean;
  accountEnabled: boolean;
  maxSends: number;
};
export function productionEmailWorkerConfiguration(env?: NodeJS.ProcessEnv): EmailWorkerConfig;
export function createProductionEmailWorkerRpc(
  config: EmailWorkerConfig,
  fetcher?: typeof fetch,
): (name: string, args: Record<string, unknown>) => Promise<unknown>;
export function runProductionEmailWorker(
  run: { runId: string; issuedAt: string },
  config: EmailWorkerConfig,
  dependencies?: Record<string, unknown>,
): Promise<{ claimed: boolean; attempted: number; auth?: unknown; account?: unknown }>;
