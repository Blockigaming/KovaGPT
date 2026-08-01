export const AGENT_TEAM_CREATE_BODY_LIMIT_BYTES: number;
export const AGENT_RUN_CONTROL_BODY_LIMIT_BYTES: number;
export const AGENT_TEAM_CONTROL_BODY_LIMIT_BYTES: number;
export const AGENT_TEAM_MAX_TASKS: number;

export type AgentTeamTask = {
  key: string;
  role: "planner" | "research" | "browser" | "file" | "coding" | "writing" | "review";
  title: string;
  instructions: string;
  dependencies: string[];
  checkpoint?: boolean;
  reusableSubplan?: string;
};

export class AgentRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly publicMessage: string;
  constructor(code: string, status: number);
}

export function readAgentJsonRequest(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>>;

export function parseAgentTeamCreatePayload(value: unknown): {
  objective: string;
  projectId?: string;
  idempotencyKey: string;
  tasks: AgentTeamTask[];
  context: string[];
};

export function parseAgentRunControlPayload(value: unknown): {
  runId: string;
  command: "pause" | "resume" | "cancel" | "delete" | "deny";
  approvalId?: string;
};

export function parseAgentTeamControlPayload(value: unknown): {
  runId: string;
  command: "pause" | "resume" | "cancel" | "retry" | "approve" | "deny";
  taskId?: string;
};

export function parseAgentRunQuery(searchParams: URLSearchParams): {
  runId?: string;
};

export type AgentProjectAuthorizationClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: unknown,
      ) => {
        maybeSingle: () => Promise<{
          data: { id?: unknown } | null;
          error?: unknown;
        }>;
      };
    };
  };
};

export function authorizeAgentProject(input: {
  supabaseUser: AgentProjectAuthorizationClient;
  projectId?: string;
}): Promise<string | undefined>;
