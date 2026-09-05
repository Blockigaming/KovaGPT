export type MeterRequest = { provider: string; capability: string; body: Record<string, unknown> };
export type PreparedDeveloperQuote = {
  quote: Record<string, unknown>;
  options: Record<string, unknown>;
  contract: {
    meter: string;
    expectedResponseModels?: string[];
    maximumUsage: Record<string, number>;
  };
};
export type DeveloperAdmission = { decision: string; request_id: string; lease_token: string };
export function prepareDeveloperQuote(
  config: { version: Record<string, unknown>; registry: Record<string, unknown>[] },
  request: MeterRequest,
  at?: Date,
): PreparedDeveloperQuote;
export function authoritativeUsage(
  value: unknown,
  meter: string,
  fallbackId?: string | null,
  expectedModels?: string[],
): { dimensions: Record<string, number>; providerResponseId: string } | null;
export function settleDeveloperQuote(
  prepared: PreparedDeveloperQuote,
  actual: { dimensions: Record<string, number>; providerResponseId: string },
): Record<string, unknown>;
export function createUsageCollector(): {
  push(text: string): void;
  value(): Record<string, unknown> | null;
};
export function runMeteredProvider(input: {
  prepared: PreparedDeveloperQuote;
  admit: () => Promise<DeveloperAdmission>;
  dispatch: (admission: DeveloperAdmission) => Promise<boolean>;
  finish: (
    admission: DeveloperAdmission,
    outcome: string,
    result?: Record<string, unknown>,
  ) => Promise<void>;
  send: () => Promise<Response>;
  signal?: AbortSignal;
}): Promise<Response>;
