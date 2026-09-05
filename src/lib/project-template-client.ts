import {
  parseProjectTemplateMutation,
  type ProjectTemplateMutation,
  type ProjectTemplateSnapshot,
} from "./project-template-policy.mjs";

type WithoutMutationId<T> = T extends { mutationId: string } ? Omit<T, "mutationId"> : never;
export type ProjectTemplateDraftMutation = WithoutMutationId<ProjectTemplateMutation>;
export type ProjectTemplateSummary = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  currentVersion: number;
  revision: number;
  archivedAt: string | null;
  canCopy: boolean;
  versions: { version: number; createdAt: string }[];
  grants: { granteeUserId: string; canCopy: boolean; revokedAt: string | null }[];
};
export type ProjectTemplateVersion = {
  templateId: string;
  ownerId: string;
  name: string;
  description: string | null;
  version: number;
  currentVersion: number;
  revision: number;
  canCopy: boolean;
  snapshot: ProjectTemplateSnapshot;
};
export type ProjectTemplateOperation = {
  readonly action: ProjectTemplateMutation["action"];
  readonly body: string;
};
export type ProjectTemplateResult = { templateId: string; version?: number; projectId?: string };

export class ProjectTemplateRequestError extends Error {
  readonly status: number;
  readonly uncertain: boolean;
  constructor(status: number, uncertain: boolean) {
    super("Project templates request failed");
    this.name = "ProjectTemplateRequestError";
    this.status = status;
    this.uncertain = uncertain;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && uuidPattern.test(value);
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const nullableText = (value: unknown): value is string | null =>
  value === null || typeof value === "string";
function invalid(): never {
  throw new ProjectTemplateRequestError(503, false);
}

export function prepareProjectTemplateOperation(
  input: ProjectTemplateDraftMutation,
  mutationId = crypto.randomUUID(),
): ProjectTemplateOperation {
  const normalized = parseProjectTemplateMutation({ ...input, mutationId });
  // A retry sends these exact bytes and mutation UUID, even after form edits.
  return Object.freeze({ action: normalized.action, body: JSON.stringify(normalized) });
}

function parseSummary(value: unknown, userId: string): ProjectTemplateSummary {
  if (
    !record(value) ||
    !uuid(value.id) ||
    !uuid(value.ownerId) ||
    typeof value.name !== "string" ||
    !nullableText(value.description) ||
    !positive(value.currentVersion) ||
    !positive(value.revision) ||
    !nullableText(value.archivedAt) ||
    typeof value.canCopy !== "boolean" ||
    !Array.isArray(value.versions) ||
    !Array.isArray(value.grants)
  )
    invalid();
  const versions = value.versions.map((entry: unknown) => {
    if (!record(entry) || !positive(entry.version) || typeof entry.createdAt !== "string")
      invalid();
    return { version: entry.version, createdAt: entry.createdAt };
  });
  if (!versions.some((entry) => entry.version === value.currentVersion)) invalid();
  const grants =
    value.ownerId === userId
      ? value.grants.map((entry: unknown) => {
          if (
            !record(entry) ||
            !uuid(entry.granteeUserId) ||
            typeof entry.canCopy !== "boolean" ||
            !nullableText(entry.revokedAt)
          )
            invalid();
          return {
            granteeUserId: entry.granteeUserId,
            canCopy: entry.canCopy,
            revokedAt: entry.revokedAt,
          };
        })
      : [];
  return {
    id: value.id,
    ownerId: value.ownerId,
    name: value.name,
    description: value.description,
    currentVersion: value.currentVersion,
    revision: value.revision,
    archivedAt: value.archivedAt,
    canCopy: value.canCopy,
    versions,
    grants,
  };
}

function parseVersion(value: unknown, templateId: string, version: number): ProjectTemplateVersion {
  if (
    !record(value) ||
    value.templateId !== templateId ||
    value.version !== version ||
    !uuid(value.ownerId) ||
    typeof value.name !== "string" ||
    !nullableText(value.description) ||
    !positive(value.currentVersion) ||
    !positive(value.revision) ||
    typeof value.canCopy !== "boolean" ||
    !record(value.snapshot)
  )
    invalid();
  const snapshot = value.snapshot;
  if (
    typeof snapshot.projectName !== "string" ||
    !nullableText(snapshot.projectDescription) ||
    !nullableText(snapshot.systemPrompt) ||
    typeof snapshot.color !== "string"
  )
    invalid();
  return {
    templateId,
    version,
    ownerId: value.ownerId,
    name: value.name,
    description: value.description,
    currentVersion: value.currentVersion,
    revision: value.revision,
    canCopy: value.canCopy,
    snapshot: {
      projectName: snapshot.projectName,
      projectDescription: snapshot.projectDescription,
      systemPrompt: snapshot.systemPrompt,
      color: snapshot.color,
    },
  };
}

export function projectTemplateFailureMessage(error: unknown, action?: string): string {
  if (!(error instanceof ProjectTemplateRequestError))
    return "Check the template fields and try again.";
  if (error.uncertain)
    return "The result could not be confirmed. Retry the same request to safely check whether it completed.";
  if (error.status === 409)
    return "This template changed elsewhere. Refresh before trying again; your draft is kept.";
  if (error.status === 401) return "Your session changed. Sign in again to use templates.";
  if (error.status === 403 || error.status === 404)
    return "This template is no longer available to you, or your access changed. Refresh the list.";
  if (error.status === 429) return "Too many requests. Wait a moment, then try again.";
  if (error.status === 400 && action === "copy")
    return "The project could not be copied. Check your active-project limit and template access.";
  if (error.status === 400)
    return "The change was not accepted. Check the fields and refresh the template.";
  return "Saved templates are unavailable right now. Try again shortly.";
}

type SessionResult = {
  data: { session: { access_token: string; user: { id: string } } | null };
  error?: unknown;
};

export function createProjectTemplateClient({
  userId,
  getSession,
  fetcher = fetch,
  timeoutMs = 15_000,
}: {
  userId: string;
  getSession: () => Promise<SessionResult>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}) {
  async function request(path: string, operation?: ProjectTemplateOperation, signal?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let startedWrite = false;
    const interrupted = new Promise<never>((_, reject) => {
      const fail = () => reject(new ProjectTemplateRequestError(503, startedWrite));
      if (controller.signal.aborted) fail();
      else controller.signal.addEventListener("abort", fail, { once: true });
    });
    try {
      return await Promise.race([
        interrupted,
        (async () => {
          if (controller.signal.aborted) throw new ProjectTemplateRequestError(503, false);
          const session = await getSession();
          if (controller.signal.aborted) throw new ProjectTemplateRequestError(503, false);
          // Bind the credential to the rendered account. Do not re-read another
          // session between this check and dispatch; server authorization remains
          // authoritative for every template, grant and mutation.
          if (
            session.error ||
            session.data.session?.user.id !== userId ||
            !session.data.session.access_token
          ) {
            throw new ProjectTemplateRequestError(401, false);
          }
          startedWrite = Boolean(operation);
          const response = await fetcher(`/api/project-templates${path}`, {
            method: operation ? "POST" : "GET",
            cache: "no-store",
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${session.data.session.access_token}`,
              ...(operation ? { "Content-Type": "application/json" } : {}),
            },
            ...(operation ? { body: operation.body } : {}),
          });
          if (!response.ok)
            throw new ProjectTemplateRequestError(
              response.status,
              Boolean(operation) && response.status >= 500,
            );
          return (await response.json()) as unknown;
        })(),
      ]);
    } catch (error) {
      if (error instanceof ProjectTemplateRequestError) throw error;
      throw new ProjectTemplateRequestError(503, startedWrite);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.abort();
    }
  }
  return {
    async list(signal?: AbortSignal): Promise<ProjectTemplateSummary[]> {
      const value = await request("?limit=50", undefined, signal);
      if (!record(value) || !Array.isArray(value.templates) || value.templates.length > 50)
        invalid();
      return value.templates.map((entry) => parseSummary(entry, userId));
    },
    async version(
      templateId: string,
      version: number,
      signal?: AbortSignal,
    ): Promise<ProjectTemplateVersion> {
      if (!uuid(templateId) || !positive(version)) invalid();
      const value = await request(
        `?templateId=${encodeURIComponent(templateId)}&version=${version}`,
        undefined,
        signal,
      );
      return parseVersion(value, templateId, version);
    },
    async mutate(
      operation: ProjectTemplateOperation,
      signal?: AbortSignal,
    ): Promise<ProjectTemplateResult> {
      const value = await request("", operation, signal);
      const expected = JSON.parse(operation.body) as ProjectTemplateMutation;
      if (
        !record(value) ||
        !record(value.result) ||
        !uuid(value.result.templateId) ||
        (expected.action !== "create" && value.result.templateId !== expected.templateId) ||
        (expected.action === "copy" &&
          expected.version !== null &&
          value.result.version !== expected.version) ||
        (operation.action === "copy" && !uuid(value.result.projectId))
      ) {
        // A malformed successful response may follow a committed write.
        throw new ProjectTemplateRequestError(503, true);
      }
      return {
        templateId: value.result.templateId,
        ...(positive(value.result.version) ? { version: value.result.version } : {}),
        ...(uuid(value.result.projectId) ? { projectId: value.result.projectId } : {}),
      };
    },
  };
}
