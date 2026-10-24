/** Stable, server-derived fingerprints share one UTC-day upload allowance across chat and Library. */
export async function uploadFingerprint({ kind, name, content, dataUrl }) {
  const source = kind === "image" ? `image:${dataUrl}` : `text:${name}\n${content}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function reserveUploads(caller, attachments, limit, signal) {
  const uploads = attachments.filter((item) => item.kind !== "library_file");
  if (!uploads.length) return true;
  const fingerprints = [...new Set(await Promise.all(uploads.map(uploadFingerprint)))];
  signal?.throwIfAborted();
  const query = caller.supabaseAdmin.rpc("try_reserve_daily_uploads", {
    _user_id: caller.userId,
    _fingerprints: fingerprints,
    _limit: limit,
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error || typeof data !== "boolean") throw new Error("upload_quota_unavailable");
  return data;
}
