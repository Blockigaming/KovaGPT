import { createHash } from "node:crypto";

export type UploadState =
  | "selected"
  | "validating"
  | "uploading"
  | "processing"
  | "ready"
  | "unsupported"
  | "failed"
  | "retry"
  | "removed";
export type FileCategory =
  | "pdf"
  | "text"
  | "markdown"
  | "csv"
  | "spreadsheet"
  | "image"
  | "code"
  | "json"
  | "other_text"
  | "unsupported";
export type FileValidationInput = {
  name: string;
  mimeType?: string | null;
  sizeBytes: number;
  signature?: Uint8Array;
  planLimitBytes: number;
  perChatLimitBytes: number;
};
export type FileValidationResult = {
  ok: boolean;
  category: FileCategory;
  state: UploadState;
  reason?: string;
  fingerprint: string;
};
const TEXT_EXT =
  /\.(txt|md|markdown|json|jsonl|ya?ml|toml|xml|html?|css|js|jsx|ts|tsx|py|sql|log)$/i;
const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|sql|sh)$/i;

export function classifyFile(name: string, mimeType?: string | null): FileCategory {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || mimeType === "text/csv") return "csv";
  if (lower.endsWith(".xlsx")) return "spreadsheet";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".json") || lower.endsWith(".jsonl") || mimeType === "application/json")
    return "json";
  if (/^image\//.test(mimeType ?? "")) return "image";
  if (CODE_EXT.test(lower)) return "code";
  if (TEXT_EXT.test(lower) || /^text\//.test(mimeType ?? "")) return "text";
  return "unsupported";
}

export function validateFileForUpload(input: FileValidationInput): FileValidationResult {
  const category = classifyFile(input.name, input.mimeType);
  const fingerprint = createHash("sha256")
    .update(`${input.name}:${input.sizeBytes}:${input.mimeType ?? ""}`)
    .digest("hex");
  if (input.sizeBytes <= 0)
    return { ok: false, category, state: "failed", reason: "Empty file.", fingerprint };
  if (input.sizeBytes > input.planLimitBytes || input.sizeBytes > input.perChatLimitBytes)
    return {
      ok: false,
      category,
      state: "failed",
      reason: "File exceeds the active size limit.",
      fingerprint,
    };
  if (category === "unsupported")
    return {
      ok: false,
      category,
      state: "unsupported",
      reason: "This file type is not supported for extraction.",
      fingerprint,
    };
  if (category === "spreadsheet" && !input.name.toLowerCase().endsWith(".xlsx"))
    return {
      ok: false,
      category,
      state: "unsupported",
      reason: "Only CSV and XLSX spreadsheet formats are supported.",
      fingerprint,
    };
  return { ok: true, category, state: "validating", fingerprint };
}

export type ReusableFileRef = {
  assetId: string;
  ownerId: string;
  storagePath: string;
  category: FileCategory;
  sourceProjectId?: string | null;
  deleted?: boolean;
};
export function canReuseFile(
  ref: ReusableFileRef,
  userId: string,
  projectIds: string[] = [],
): boolean {
  if (ref.deleted) return false;
  if (ref.ownerId !== userId) return false;
  if (ref.sourceProjectId && !projectIds.includes(ref.sourceProjectId)) return false;
  return true;
}
