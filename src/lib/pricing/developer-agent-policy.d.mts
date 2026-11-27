export type DeveloperAgentTurn = { agent_id: string; version: number; input: string };
export function parseDeveloperAgentRequest(
  method: string,
  params: URLSearchParams,
  body?: unknown,
): { operation: string; input: Record<string, unknown> };
export function parseDeveloperAgentTurn(value: unknown): DeveloperAgentTurn;
export function expandDeveloperAgentTurn(
  turn: DeveloperAgentTurn,
  saved: unknown,
): Record<string, unknown>;
