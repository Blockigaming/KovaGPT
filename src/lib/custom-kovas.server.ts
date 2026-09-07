import {
  normalizeKovaConfig,
  normalizeKovaReference,
  kovaId,
  formatKovaContext,
  filterKovaTools,
  kovaAttachmentsAllowed,
  type KovaReference,
  type KovaContext,
} from "./custom-kovas-policy.mjs";
export type KovaAdmin = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): {
    abortSignal(
      signal: AbortSignal,
    ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
  };
};
export class CustomKovaAccessError extends Error {
  readonly code = "custom_kova_unavailable";
  readonly status: number;
  readonly retryable: boolean;
  constructor(status = 403) {
    super(
      "This Kova is unavailable or its published version changed. Refresh it before trying again.",
    );
    this.status = status;
    this.retryable = status >= 500;
  }
}
export async function kovaRpc(
  admin: unknown,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) {
  const result = await (admin as KovaAdmin)
    .rpc(name, args)
    .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(10000)]));
  if (result.error) {
    const code = result.error.code;
    throw Object.assign(
      new Error(
        code === "40001"
          ? "custom_kova_conflict"
          : code === "54000"
            ? "custom_kova_capacity"
            : code === "42501"
              ? "custom_kova_unavailable"
              : code === "22023"
                ? "custom_kova_invalid"
                : "custom_kova_unavailable",
      ),
      {
        status:
          code === "40001"
            ? 409
            : code === "54000"
              ? 413
              : code === "42501"
                ? 403
                : code === "22023"
                  ? 400
                  : 503,
      },
    );
  }
  return result.data;
}
function inspect(value: unknown, ref: KovaReference): KovaContext {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CustomKovaAccessError(503);
  const input = value as KovaContext;
  if (
    kovaId(input.id) !== ref.id ||
    (ref.versionId && input.versionId !== ref.versionId) ||
    !Array.isArray(input.knowledge) ||
    input.knowledge.length > 10
  )
    throw new CustomKovaAccessError(503);
  kovaId(input.versionId);
  kovaId(input.publicationEpoch);
  const config = normalizeKovaConfig(input.config);
  let chars = 0;
  const knowledge = input.knowledge.map((v) => {
    if (
      !v ||
      typeof v.title !== "string" ||
      v.title.length > 200 ||
      typeof v.content !== "string" ||
      v.content.length > 30000
    )
      throw new CustomKovaAccessError(503);
    chars += v.content.length;
    return { title: v.title, content: v.content };
  });
  if (chars > 180000) throw new CustomKovaAccessError(503);
  return { ...input, config, knowledge };
}
export async function resolveCustomKova(
  admin: unknown,
  actor: string,
  reference: KovaReference,
  signal: AbortSignal,
) {
  const ref = normalizeKovaReference(reference);
  const load = async (checkSignal: AbortSignal) =>
    inspect(
      await kovaRpc(
        admin,
        "resolve_custom_kova",
        { p_actor: actor, p_id: ref.id, p_version: ref.versionId ?? null },
        checkSignal,
      ),
      ref,
    );
  const context = await load(signal);
  return {
    ...context,
    block: formatKovaContext(context),
    allows: (tool: string) => context.config.tools.includes(tool),
    attachmentsAllowed: (messages: { attachments?: unknown[] }[]) =>
      kovaAttachmentsAllowed(context, messages),
    filterTools: <T>(tools: T[]) => filterKovaTools(tools, context),
    async assertCurrent(checkSignal: AbortSignal) {
      const now = await load(checkSignal);
      if (now.versionId !== context.versionId || now.publicationEpoch !== context.publicationEpoch)
        throw new CustomKovaAccessError();
    },
  };
}
export function kovaError(error: unknown) {
  const value = error as { status?: number; message?: string };
  const status =
    value.status && [400, 401, 403, 409, 413, 429, 503, 504].includes(value.status)
      ? value.status
      : value.message === "custom_kova_too_large"
        ? 413
        : value.message === "custom_kova_invalid"
          ? 400
          : 503;
  return Response.json(
    {
      error:
        status === 400
          ? "custom_kova_invalid"
          : status === 409
            ? "custom_kova_conflict"
            : status === 413
              ? "custom_kova_capacity"
              : "custom_kova_unavailable",
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
export async function hashKovaToken(token: unknown) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(token))
    throw Object.assign(Error("custom_kova_invalid"), { status: 400 });
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
