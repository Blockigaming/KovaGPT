export type Operation = "responses" | "images" | "embeddings";
export interface Quote {
  quoteToken: string;
  pricingVersion: string;
  currency: string;
  maximumCharge: number;
  expiresAt: number;
}
export interface Budget {
  currency: string;
  maximumCharge: number;
  idempotencyKey: string;
  signal?: AbortSignal;
}
export interface FunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict: true;
}
export interface ResponsesInput {
  file_ids?: string[];
  model: string;
  input: string | Record<string, unknown>[];
  instructions?: string;
  max_output_tokens: number;
  stream?: boolean;
  tools?: FunctionTool[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; name: string };
  parallel_tool_calls?: boolean;
  text?: {
    format: {
      type: "json_schema";
      name: string;
      strict: true;
      schema: Record<string, unknown>;
      description?: string;
    };
  };
}
export interface ImagesInput {
  model: string;
  prompt: string;
  n?: number;
  size: string;
  quality: "low" | "medium" | "high";
}
export interface EmbeddingsInput {
  model: string;
  input: string | string[];
  dimensions?: number;
}
export class KovaError extends Error {
  code: string;
  status: number;
  requestMayHaveStarted: boolean;
}
export class KovaGPT {
  readonly files: {
    upload(
      input: {
        filename: string;
        mimeType: "text/plain" | "text/markdown" | "text/csv" | "application/json";
        text: string;
      },
      options: { idempotencyKey: string; signal?: AbortSignal },
    ): Promise<DeveloperFile>;
    list(options?: {
      page?: number;
      signal?: AbortSignal;
    }): Promise<{ data: DeveloperFile[]; page: number; hasMore: boolean }>;
    retrieve(
      id: string,
      options?: { signal?: AbortSignal },
    ): Promise<DeveloperFile & { content: string }>;
    delete(
      id: string,
      options?: { signal?: AbortSignal },
    ): Promise<{ id: string; deleted: boolean }>;
  };
  constructor(options: {
    apiKey: string;
    baseURL?: string;
    fetch?: typeof fetch;
    timeoutMs?: number;
  });
  readonly responses: { create(input: ResponsesInput, options: Budget): Promise<Response> };
  readonly images: { generate(input: ImagesInput, options: Budget): Promise<Response> };
  readonly embeddings: { create(input: EmbeddingsInput, options: Budget): Promise<Response> };
  models(options?: { signal?: AbortSignal }): Promise<{
    object: "list";
    data: { id: string; capability: string }[];
    pricingVersion: string;
  }>;
  quote(
    kind: Operation,
    input: ResponsesInput | ImagesInput | EmbeddingsInput,
    options?: { signal?: AbortSignal },
  ): Promise<Quote>;
  execute(
    kind: Operation,
    input: ResponsesInput | ImagesInput | EmbeddingsInput,
    options: Budget & { quote: Quote },
  ): Promise<Response>;
  run(
    kind: Operation,
    input: ResponsesInput | ImagesInput | EmbeddingsInput,
    options: Budget,
  ): Promise<Response>;
}
export interface DeveloperFile {
  id: string;
  project_id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  content_digest: string;
  created_at: string;
  expires_at: string;
}
export function responseEvents(
  response: Response,
  options?: { maximumEventBytes?: number },
): AsyncGenerator<Record<string, unknown>>;
