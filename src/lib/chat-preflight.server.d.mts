export type ChatPreflightMilestone = {
  stage: string;
  state: "started" | "completed" | "timed_out" | "failed" | "aborted";
  required: boolean;
  durationMs: number;
  code?: string;
  status?: number;
};

export class ChatPreflightError extends Error {
  readonly stage: string;
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  constructor(options: {
    stage: string;
    code: string;
    status: number;
    retryable: boolean;
    cause?: unknown;
  });
  toEnvelope(): {
    error: string;
    code: string;
    category: "server";
    retryable: boolean;
    stage: string;
  };
}

export function createChatPreflightRunner(options?: {
  signal?: AbortSignal;
  requiredTimeoutMs?: number;
  optionalTimeoutMs?: number;
  totalTimeoutMs?: number;
  onMilestone?: (event: ChatPreflightMilestone) => void;
  now?: () => number;
}): {
  run<T>(
    stage: string,
    operation: (signal: AbortSignal) => Promise<T> | T,
    options?: { required?: true; timeoutMs?: number },
  ): Promise<T>;
  run<T>(
    stage: string,
    operation: (signal: AbortSignal) => Promise<T> | T,
    options: { required: false; timeoutMs?: number },
  ): Promise<T | undefined>;
  close(): void;
};
