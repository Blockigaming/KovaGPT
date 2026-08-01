export type ResearchAuthorizationRow = Record<string, unknown>;

export type ResearchAuthorizationQuery = {
  select: (columns: string) => ResearchAuthorizationQuery;
  eq: (column: string, value: unknown) => ResearchAuthorizationQuery;
  maybeSingle: () => Promise<{
    data: ResearchAuthorizationRow | null;
    error?: unknown;
  }>;
};

export type ResearchAuthorizationClient = {
  from: (table: string) => ResearchAuthorizationQuery;
};

export type AuthorizedResearchReferences = {
  chatId?: string;
  projectId?: string;
};

export class ResearchPersistenceAuthorizationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly publicMessage: string;
  constructor(code: string, status: number, publicMessage: string);
}

export function authorizeResearchPersistence(input: {
  supabaseUser: ResearchAuthorizationClient;
  chatId?: string;
  projectId?: string;
}): Promise<AuthorizedResearchReferences>;
