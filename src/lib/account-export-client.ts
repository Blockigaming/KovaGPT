import { supabase } from "@/integrations/supabase/client";
import { SUPABASE_BROWSER_CONFIG } from "@/integrations/supabase/config";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";
import { isUuid } from "@/lib/account-export-policy.mjs";
import {
  parseAccountExportJob,
  parseExportDownload,
  type AccountExportJob,
  type ExportDownload,
} from "./account-export-ui";

export type ExportOperation = "status" | "request" | "cancel" | "download";
export type ExportResult = {
  job: AccountExportJob | null;
  retryAfter: number | null;
  download?: ExportDownload;
};
export class AccountExportRequestError extends Error {
  constructor(
    readonly code: string,
    readonly dispatched: boolean,
    readonly status: number | null = null,
    readonly job: AccountExportJob | null = null,
    readonly retryAfter: number | null = null,
  ) {
    super(code);
    this.name = "AccountExportRequestError";
  }
  get definitelyRejected() {
    return !this.dispatched || (this.status !== null && [400, 401, 403, 429].includes(this.status));
  }
}

export async function requestAccountExport(
  owner: string,
  operation: ExportOperation,
  signal: AbortSignal,
  jobId?: string,
): Promise<ExportResult> {
  if (!isUuid(owner) || ((operation === "cancel" || operation === "download") && !isUuid(jobId)))
    throw new AccountExportRequestError("invalid_export_identity", false);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  let dispatched = false;
  let abort: () => void = () => {};
  try {
    const sessionResult = await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error("export_request_aborted"));
        if (bounded.aborted) abort();
        else bounded.addEventListener("abort", abort, { once: true });
      }),
    ]);
    bounded.throwIfAborted();
    const session = sessionResult.data.session;
    if (sessionResult.error || session?.user.id !== owner || !session.access_token)
      throw new AccountExportRequestError("export_identity_changed", false, 401);
    const method = operation === "request" ? "POST" : operation === "cancel" ? "DELETE" : "GET";
    dispatched = true;
    const response = await fetch(
      `/api/account/export${operation === "download" ? "?download=1" : ""}`,
      {
        method,
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: bounded,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "X-Kova-Owner": owner,
          Accept: "application/json",
          ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
        },
        ...(method === "POST"
          ? { body: "{}" }
          : method === "DELETE"
            ? { body: JSON.stringify({ id: jobId }) }
            : {}),
      },
    );
    const bytes = await readResponseBytesBounded(response, 16384, {
      signal: bounded,
      timeoutMs: 15000,
    });
    const value = JSON.parse(new TextDecoder().decode(bytes));
    bounded.throwIfAborted();
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("invalid_export_status");
    const retryValue = response.headers.get("Retry-After");
    const retryAfter =
      retryValue && /^\d{1,6}$/u.test(retryValue) ? Math.min(86400, Number(retryValue)) : null;
    const parsedJob = Object.hasOwn(value, "job") ? parseAccountExportJob(value.job) : null;
    // DELETE can report cleanup failure before any storage path was recorded.
    const job =
      parsedJob?.status === "canceled" && typeof value.cleanupPending === "boolean"
        ? { ...parsedJob, cleanupPending: value.cleanupPending }
        : parsedJob;
    if ((operation === "cancel" || operation === "download") && job && job.id !== jobId)
      throw Error("invalid_export_status");
    if (!response.ok)
      throw new AccountExportRequestError(
        typeof value.error === "string" ? value.error : "export_request_failed",
        true,
        response.status,
        job,
        retryAfter,
      );
    if (
      !Object.hasOwn(value, "job") ||
      (operation !== "status" && !job) ||
      ((operation === "cancel" || operation === "download") && job?.id !== jobId)
    )
      throw Error("invalid_export_status");
    return {
      job,
      retryAfter,
      ...(operation === "download"
        ? {
            download: parseExportDownload(
              value,
              job!,
              owner,
              window.location.origin,
              SUPABASE_BROWSER_CONFIG.url,
            ),
          }
        : {}),
    };
  } catch (error) {
    if (error instanceof AccountExportRequestError) throw error;
    throw new AccountExportRequestError("export_request_unconfirmed", dispatched);
  } finally {
    bounded.removeEventListener("abort", abort);
  }
}
