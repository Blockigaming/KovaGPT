import type { AuthedCaller } from "./api-auth.server";
export function uploadFingerprint(attachment: {
  kind: string;
  name?: string;
  content?: string;
  dataUrl?: string;
}): Promise<string>;
export function reserveUploads(
  caller: Pick<AuthedCaller, "userId" | "supabaseAdmin">,
  attachments: readonly { kind: string; name?: string; content?: string; dataUrl?: string }[],
  limit: number,
  signal?: AbortSignal,
): Promise<boolean>;
