export type Operation =
  | "responses"
  | "images"
  | "embeddings"
  | "moderations"
  | "search"
  | "chat/completions"
  | "decisions"
  | "agent-turns";
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
  tools?: FunctionTool[] | [{ type: "web_search"; search_context_size: "low" }];
  max_tool_calls?: 1 | 2 | 3;
  reasoning?: { effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" };
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
export interface SearchInput {
  model: string;
  query: string;
  max_output_tokens: number;
  max_tool_calls: 1 | 2 | 3;
}
export type ChatCompletionInput = {
  model: string;
  messages: { role: "system" | "developer" | "user" | "assistant"; content: string }[];
  stream?: boolean;
  reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
} & (
  | { max_completion_tokens: number; max_tokens?: never }
  | { max_tokens: number; max_completion_tokens?: never }
);
export type OperationInput =
  | ResponsesInput
  | ImagesInput
  | (ImagesInput & { image: string })
  | EmbeddingsInput
  | ModerationsInput
  | SearchInput
  | ChatCompletionInput
  | DecisionInput
  | AgentTurnInput;
export interface AgentDefinition {
  name: string;
  model: string;
  instructions: string;
  max_output_tokens: number;
}
export interface AgentTurnInput {
  agent_id: string;
  version: number;
  input: string;
  skills?: { id: string; version: number }[];
}
export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
}
export type DecisionQuestion = {
  name: string;
  instructions: string;
} & (
  | { type: "predicate" }
  | { type: "choice"; choices: { value: string | boolean; description?: string }[] }
  | { type: "score"; levels: { label: string; description?: string }[] }
);
export interface DecisionInput {
  model: string;
  input: string;
  questions: DecisionQuestion[];
}
export interface ModerationsInput {
  model: string;
  input: string;
}
export interface DeveloperModel {
  id: string;
  capability: string;
  reasoning_efforts: string[];
  web_search: boolean;
  inline_image_input: boolean;
  image_edits: boolean;
}
export interface DeveloperUsage {
  id: string;
  public_model: string;
  capability: string;
  currency: string;
  settlement_state: string;
  maximum_reserved_charge: number | string | null;
  final_customer_charge: number | string | null;
  created_at: string;
  settled_at: string | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  image_input_tokens: number | null;
  output_tokens: number | null;
  web_search_calls: number | null;
  moderation_requests: number | null;
}
export class KovaError extends Error {
  code: string;
  status: number;
  requestMayHaveStarted: boolean;
}
export class KovaGPT {
  readonly decisions: { create(input: DecisionInput, options: Budget): Promise<Response> };
  readonly agents: {
    create(
      input: { id: string; definition: AgentDefinition },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    update(
      input: { id: string; definition: AgentDefinition; expected_version: number },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieve(
      id: string,
      options?: { version?: number; signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    delete(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    turn(input: AgentTurnInput, options: Budget): Promise<Response>;
  };
  readonly skills: {
    create(
      input: { id: string; definition: SkillDefinition },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    update(
      input: { id: string; definition: SkillDefinition; expected_version: number },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieve(
      id: string,
      options?: { version?: number; signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    delete(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  };
  readonly webhooks: {
    create(input: { id: string; url: string; events: ("request.settled" | "request.rejected")[] }, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    rotate(input: { id: string; expected_generation: number }, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    test(input: { id: string; event_id: string }, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieve(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    deliveries(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    delete(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  };
  readonly conversations: {
    create(input: { id: string; title: string }, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    append(
      input: {
        id: string;
        expected_revision: number;
        item: { id: string; role: "user" | "assistant" | "developer" | "system"; content: string };
      },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    remove(
      input: { id: string; item_id: string; expected_revision: number },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieve(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieveItem(id: string, item: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    delete(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  };
  readonly vectorStores: {
    create(input: { name: string; model: string; dimensions: number }, options: { idempotencyKey: string; signal?: AbortSignal }): Promise<Record<string, unknown>>;
    upsert(input: { store_id: string; entry_id: string; model: string; vector: number[]; text: string; file_id?: string }, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    search(input: { store_id: string; model: string; vector: number[]; limit?: number }, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieve(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    listEntries(id: string, options?: { page?: number; signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieveEntry(id: string, entry: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    delete(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    deleteEntry(id: string, entry: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  };
  readonly files: {
    search(
      input: { query: string; file_ids: string[]; limit?: number },
      options?: { signal?: AbortSignal },
    ): Promise<{
      object: "list";
      search_type: "lexical";
      offset_unit: "unicode_code_point";
      data: {
        file_id: string;
        filename: string;
        content_digest: string;
        start: number;
        end: number;
        score: number;
        snippet: string;
      }[];
    }>;
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
  readonly chat: {
    completions: { create(input: ChatCompletionInput, options: Budget): Promise<Response> };
  };
  search(input: SearchInput, options: Budget): Promise<Response>;
  readonly images: {
    generate(input: ImagesInput, options: Budget): Promise<Response>;
    edit(input: ImagesInput & { image: string }, options: Budget): Promise<Response>;
  };
  readonly embeddings: { create(input: EmbeddingsInput, options: Budget): Promise<Response> };
  readonly moderations: { create(input: ModerationsInput, options: Budget): Promise<Response> };
  readonly usage: {
    list(options?: { limit?: number; offset?: number; signal?: AbortSignal }): Promise<{
      object: "list";
      data: DeveloperUsage[];
      has_more: boolean;
      next_offset: number | null;
      amount_unit: "currency_minor_unit";
    }>;
    retrieve(id: string, options?: { signal?: AbortSignal }): Promise<{
      object: "usage";
      data: DeveloperUsage;
      amount_unit: "currency_minor_unit";
    }>;
  };
  models(options?: { id?: string; signal?: AbortSignal }): Promise<{
    object: "list";
    data: DeveloperModel[];
    pricingVersion: string;
  }>;
  quote(
    kind: Operation,
    input: OperationInput,
    options?: { signal?: AbortSignal },
  ): Promise<Quote>;
  execute(
    kind: Operation,
    input: OperationInput,
    options: Budget & { quote: Quote },
  ): Promise<Response>;
  run(
    kind: Operation,
    input: OperationInput,
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

export function chatCompletionEvents(
  response: Response,
  options?: { maximumEventBytes?: number },
): AsyncGenerator<Record<string, unknown>>;
