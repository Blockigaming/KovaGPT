import type OpenAI from "openai";
export class OpenAiServiceError extends Error {
  status: number;
  constructor(code: string, status?: number);
}
export type DecisionQuestion = {
  name: string;
  type: "predicate" | "choice";
  instructions: string;
  choices?: { value: string; description: string }[];
};
export type ServiceResult = {
  text?: string;
  answers?: unknown[];
  results?: unknown[];
  usage?: Record<string, unknown>;
  toolCalls?: number;
};
export type ServiceOptions = { signal?: AbortSignal };
export function normalizeBrowserDomains(domains: unknown): string[];
export function createOpenAiServiceClient(
  apiKey: string | undefined,
  fetchImpl?: typeof fetch,
): OpenAI;
export function webSearchSources(
  response: unknown,
  limit?: number,
): { url: string; title: string }[];
export function createOpenAiServices(input: {
  client: OpenAI;
  model: string;
  agentModel?: string;
  maxOutputTokens?: number;
  instructions?: string;
  browserDomains?: string[];
  reportCleanupFailure?: (resources: { kind: string; id: string }[]) => void;
}): {
  search(
    query: string,
    options?: ServiceOptions & { limit?: number },
  ): Promise<{
    sources: { url: string; title: string }[];
    summary: string;
    usage?: Record<string, unknown>;
  }>;
  decisions(
    input: string,
    questions: DecisionQuestion[],
    options?: ServiceOptions,
  ): Promise<ServiceResult>;
  moderate(input: string, options?: ServiceOptions): Promise<ServiceResult>;
  analyze(input: string, options?: ServiceOptions): Promise<ServiceResult>;
  searchFiles(
    question: string,
    documents: { name: string; text: string }[],
    options?: ServiceOptions,
  ): Promise<ServiceResult>;
  agent(input: string, options?: ServiceOptions): Promise<ServiceResult>;
  browser(input: string, options?: ServiceOptions): Promise<ServiceResult>;
};
