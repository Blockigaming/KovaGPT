export type HostedInternalUsage = {
  input: number;
  output: number;
  reasoning: number;
  cachedInput: number;
};
export function requestHostedEffort(input: {
  request: Record<string, unknown>;
  mode: string;
  freeChat?: boolean;
  token?: string;
  signal?: AbortSignal;
  onUsage?: (usage: HostedInternalUsage) => void;
  beforeSend?: () => Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<Response>;
