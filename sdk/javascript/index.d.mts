export {
  connectRealtimeSession,
  connectBrowserSession,
  type RealtimeSession,
  type BrowserSession,
  type BrowserAction,
} from "./realtime.mjs";
export type Operation =
  | "responses"
  | "images"
  | "embeddings"
  | "moderations"
  | "search"
  | "chat/completions"
  | "decisions"
  | "agent-turns"
  | "analysis"
  | "computer-use"
  | "browser"
  | "audio/transcriptions"
  | "audio/translations"
  | "audio/speech"
  | "realtime";
export type RealtimeInput = {
  model: string;
  output_modality: "text" | "audio";
  max_output_tokens: number;
} & ({ input: string; audio?: never } | { audio: string; input?: never });
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
  conversation?: { id: string; revision: number };
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
  research?: true;
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
  | AgentTurnInput
  | AnalysisInput
  | ComputerUseInput
  | BrowserSnapshotInput
  | TranscriptionInput
  | NativeTranslationInput
  | SpeechInput;
export interface SpeechInput {
  model: string;
  input: string;
  voice: "default";
  response_format?: "mp3";
}
export interface NativeTranslationInput {
  model: string;
  audio: string;
  target_language: "en" | "es" | "fr" | "de" | "it" | "pt" | "ja" | "ko" | "zh";
}
export interface TranscriptionInput {
  model: string;
  audio: string;
}
export interface BrowserSnapshotInput {
  model: string;
  url: string;
  /** Up to two additional, distinct same-origin HTTPS pages, bound to the same quote. */
  navigate?: string[];
  /** Interactive mode requires a browser session socket. Mutually exclusive with navigate. */
  interactive?: true;
}
export interface ComputerUseInput {
  model: string;
  input: string;
  screenshot: string;
  max_output_tokens: number;
}
export interface AnalysisInput {
  model: string;
  input: string;
  max_output_tokens: number;
  file_ids?: string[];
}
export type BackgroundResponsesInput = Omit<
  ResponsesInput,
  "conversation" | "file_ids" | "stream" | "tools" | "max_tool_calls"
> & {
  stream?: false;
  tools?: FunctionTool[];
};
export type BatchInvocation = {
  id: string;
  quote_token: string;
} & (
  | {
      operation?: "chat/completions";
      input: Omit<ChatCompletionInput, "max_tokens" | "max_completion_tokens" | "stream"> & {
        max_completion_tokens: number;
        stream?: false;
      };
    }
  | { operation: "agent-turns"; input: AgentTurnInput }
  | {
      operation: "responses";
      input: BackgroundResponsesInput;
    }
  | { operation: "moderations"; input: ModerationsInput }
  | { operation: "embeddings"; input: EmbeddingsInput & { dimensions: number } }
  | { operation: "decisions"; input: DecisionInput }
  | {
      operation: "search";
      input: { model: string; query: string; max_output_tokens: number; max_tool_calls: number };
    }
  | { operation: "analysis"; input: { model: string; input: string; max_output_tokens: number } }
);
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
  conversation?: { id: string; revision: number };
}
export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
}
export interface PromptDefinition {
  name: string;
  description: string;
  prompt: string;
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
  transcription_seconds: number | null;
  speech_character_credits: number | null;
  translation_seconds: number | null;
  realtime_text_input_tokens: number | null;
  realtime_cached_text_tokens: number | null;
  realtime_audio_input_tokens: number | null;
  realtime_cached_audio_tokens: number | null;
  realtime_text_output_tokens: number | null;
  realtime_audio_output_tokens: number | null;
}
export class KovaError extends Error {
  code: string;
  status: number;
  requestMayHaveStarted: boolean;
  retryAfter: number | null;
}
export class KovaGPT {
  readonly realtime: {
    create(input: RealtimeInput, options: Budget): Promise<Response>;
    sessions: {
      create(
        input?: { origin?: string },
        options?: { signal?: AbortSignal },
      ): Promise<Record<string, unknown>>;
      retrieve(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
      close(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    };
  };
  readonly decisions: { create(input: DecisionInput, options: Budget): Promise<Response> };
  readonly analysis: { create(input: AnalysisInput, options: Budget): Promise<Response> };
  readonly computerUse: { propose(input: ComputerUseInput, options: Budget): Promise<Response> };
  readonly browser: {
    snapshot(input: BrowserSnapshotInput, options: Budget): Promise<Response>;
    sessions: {
      create(
        input?: { origin?: string },
        options?: { signal?: AbortSignal },
      ): Promise<Record<string, unknown>>;
      retrieve(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
      close(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    };
  };
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
  readonly prompts: {
    create(
      input: { id: string; definition: PromptDefinition },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    update(
      input: { id: string; definition: PromptDefinition; expected_version: number },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieve(
      id: string,
      options?: { version?: number; signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    delete(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  };
  readonly uploads: {
    create(
      input: {
        id: string;
        filename: string;
        mime_type: "text/plain" | "text/markdown" | "text/csv" | "application/json";
        total_bytes: number;
        sha256: string;
      },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    append(
      input: { id: string; offset: number; data: string },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    complete(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    cancel(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieve(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  };
  readonly webhooks: {
    create(
      input: { id: string; url: string; events: ("request.settled" | "request.rejected")[] },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    rotate(
      input: { id: string; expected_generation: number },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    test(
      input: { id: string; event_id: string },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieve(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retry(
      input: { id: string; event_id: string; expected_attempts: number },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    deliveries(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    delete(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  };
  readonly batches: {
    create(
      input: {
        id: string;
        currency: string;
        maximum_charge: number;
        items: BatchInvocation[];
      },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    cancel(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieve(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieveItem(
      id: string,
      item: string,
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
  };
  readonly mcpConnections: {
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    invoke(
      input: { id: string; tool: string; query: string; approved: true },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
  };
  readonly researchRuns: {
    prepareAutonomous(
      input: {
        id: string;
        currency: string;
        maximum_charge: number;
        model: string;
        question: string;
        max_output_tokens: number;
        max_tool_calls: 2 | 3;
      },
      options?: { signal?: AbortSignal },
    ): Promise<{
      id: string;
      currency: string;
      maximum_charge: number;
      items: Extract<BatchInvocation, { operation: "search" }>[];
    }>;
    prepare(
      input: {
        id: string;
        currency: string;
        maximum_charge: number;
        model: string;
        queries: { id: string; query: string }[];
        max_output_tokens: number;
        max_tool_calls: 1 | 2 | 3;
      },
      options?: { signal?: AbortSignal },
    ): Promise<{
      id: string;
      currency: string;
      maximum_charge: number;
      items: Extract<BatchInvocation, { operation: "search" }>[];
    }>;
    plan(
      input: { model: string; question: string; max_output_tokens: number },
      options: Budget,
    ): Promise<{ queries: string[]; response_id: string | null }>;
    synthesize(
      id: string,
      input: {
        model: string;
        question: string;
        max_output_tokens: number;
        allow_partial?: boolean;
      },
      options: Budget,
    ): Promise<Response>;
    create(
      input: {
        id: string;
        currency: string;
        maximum_charge: number;
        items: Extract<BatchInvocation, { operation: "search" }>[];
      },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    cancel(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieve(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  };
  readonly responseJobs: {
    create(
      input: {
        id: string;
        currency: string;
        maximum_charge: number;
        quote_token: string;
        input: BackgroundResponsesInput;
      },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    cancel(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieve(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  };
  readonly automations: {
    create(
      input: {
        id: string;
        currency: string;
        maximum_charge: number;
        items: (BatchInvocation & { run_at: string })[];
      },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    cancel(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    pause(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    resume(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieve(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieveItem(
      id: string,
      item: string,
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
  };
  readonly conversations: {
    create(
      input: { id: string; title: string },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
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
    retrieveItem(
      id: string,
      item: string,
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    delete(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  };
  readonly vectorStores: {
    create(
      input: { name: string; model: string; dimensions: number },
      options: { idempotencyKey: string; signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    upsert(
      input: {
        store_id: string;
        entry_id: string;
        model: string;
        vector: number[];
        text: string;
        file_id?: string;
      },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    upsertBatch(
      input: {
        store_id: string;
        model: string;
        entries: { entry_id: string; vector: number[]; text: string; file_id?: string }[];
      },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    search(
      input: { store_id: string; model: string; vector: number[]; limit?: number },
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    list(options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    retrieve(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    listEntries(
      id: string,
      options?: { page?: number; signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    retrieveEntry(
      id: string,
      entry: string,
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
    delete(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
    deleteEntry(
      id: string,
      entry: string,
      options?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>>;
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
    uploadMultipart(
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
  readonly audio: {
    speech: { create(input: SpeechInput, options: Budget): Promise<Response> };
    transcriptions: { create(input: TranscriptionInput, options: Budget): Promise<Response> };
    translations: {
      native(input: NativeTranslationInput, options: Budget): Promise<Response>;
      /** Separate metered Responses translation of a completed transcription. */
      create(
        input: {
          model: string;
          transcription: {
            id: string;
            status: "completed";
            text: string;
            usage: { type: "duration"; seconds: number };
          };
          target_language: string;
          max_output_tokens: number;
        },
        options: Budget,
      ): Promise<Response>;
    };
  };
  readonly moderations: { create(input: ModerationsInput, options: Budget): Promise<Response> };
  readonly usage: {
    list(options?: { limit?: number; offset?: number; signal?: AbortSignal }): Promise<{
      object: "list";
      data: DeveloperUsage[];
      has_more: boolean;
      next_offset: number | null;
      amount_unit: "currency_minor_unit";
    }>;
    retrieve(
      id: string,
      options?: { signal?: AbortSignal },
    ): Promise<{
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
  quote(kind: Operation, input: OperationInput, options?: { signal?: AbortSignal }): Promise<Quote>;
  execute(
    kind: Operation,
    input: OperationInput,
    options: Budget & { quote: Quote },
  ): Promise<Response>;
  run(kind: Operation, input: OperationInput, options: Budget): Promise<Response>;
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

export function verifyWebhookSignature(value: {
  secret: string;
  eventId: string;
  timestamp: number | string;
  body: string | Uint8Array;
  signature: string;
  now?: number;
}): boolean;
