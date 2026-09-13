import { readResponseBytesBounded } from "../endpoint-reliability.mjs";
import { waitForPromiseWithSignal } from "../ai/provider-transport.server.mjs";
import { inspectImageBytes } from "./image-bytes.mjs";
import { ImageInputError } from "./image-request-policy.mjs";
const unavailable = () => {
  throw new ImageInputError(
    "The source image is no longer available. Choose an image from your Library.",
    409,
  );
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export async function assertImagePrincipal(auth, signal) {
  signal?.throwIfAborted();
  const [user, fence] = await Promise.all([
    waitForPromiseWithSignal(auth.supabaseUser.auth.getUser(), signal),
    auth.supabaseAdmin
      .from("account_deletion_fences")
      .select("user_id")
      .eq("user_id", auth.userId)
      .abortSignal(signal ?? AbortSignal.timeout(5000))
      .maybeSingle(),
  ]);
  if (
    user.error ||
    user.data?.user?.id !== auth.userId ||
    !user.data.user.email_confirmed_at ||
    user.data.user.deleted_at ||
    (user.data.user.banned_until && Date.parse(user.data.user.banned_until) > Date.now()) ||
    fence.error ||
    fence.data
  )
    unavailable();
  signal?.throwIfAborted();
}
export async function loadOwnedImageSource(
  auth,
  id,
  { supabaseUrl, signal, mask = false, fetchImpl = fetch } = {},
) {
  if (!UUID.test(id ?? "")) unavailable();
  const lookup = () =>
    auth.supabaseUser
      .from("user_library_items")
      .select("id,user_id,item_type,file_url,file_type,file_size,metadata")
      .eq("id", id)
      .eq("user_id", auth.userId)
      .abortSignal(signal ?? AbortSignal.timeout(5000))
      .maybeSingle();
  const result = await lookup(),
    row = result.data;
  const pathPattern = new RegExp(`^${auth.userId}/[0-9a-f-]{36}\\.(?:png|jpe?g|webp)$`, "i");
  if (
    result.error ||
    !row ||
    row.user_id !== auth.userId ||
    row.item_type !== "image" ||
    !pathPattern.test(row.file_url ?? "") ||
    !["image/png", "image/jpeg", "image/webp"].includes(row.file_type) ||
    (mask && row.file_type !== "image/png") ||
    !Number.isSafeInteger(row.file_size) ||
    row.file_size <= 0 ||
    row.file_size > (mask ? 4 : 8) * 1024 * 1024
  )
    unavailable();
  const signed = await waitForPromiseWithSignal(
    auth.supabaseUser.storage.from("library-images").createSignedUrl(row.file_url, 30),
    signal,
  );
  if (signed.error || !signed.data?.signedUrl) unavailable();
  let target, base;
  try {
    target = new URL(signed.data.signedUrl);
    base = new URL(supabaseUrl);
  } catch {
    unavailable();
  }
  const expected = `/storage/v1/object/sign/library-images/${row.file_url}`;
  if (
    target.protocol !== "https:" ||
    target.origin !== base.origin ||
    target.username ||
    target.password ||
    decodeURIComponent(target.pathname) !== expected
  )
    unavailable();
  const response = await fetchImpl(target.href, {
    redirect: "error",
    signal,
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    unavailable();
  }
  const bytes = await readResponseBytesBounded(response, (mask ? 4 : 8) * 1024 * 1024, {
    signal,
    timeoutMs: 10000,
  });
  if (bytes.length !== row.file_size) unavailable();
  const info = inspectImageBytes(bytes, row.file_type, (mask ? 4 : 8) * 1024 * 1024);
  if (mask && !info.alpha)
    throw new ImageInputError(
      "An edit mask must be a PNG with an alpha channel; transparent areas indicate the requested edit region.",
    );
  const fingerprint = JSON.stringify([row.file_url, row.file_type, row.file_size, row.metadata]);
  const recheck = async () => {
    const current = await lookup();
    if (
      current.error ||
      !current.data ||
      current.data.item_type !== "image" ||
      current.data.user_id !== auth.userId ||
      JSON.stringify([
        current.data.file_url,
        current.data.file_type,
        current.data.file_size,
        current.data.metadata,
      ]) !== fingerprint
    )
      unavailable();
  };
  await recheck();
  return { bytes, contentType: row.file_type, info, recheck };
}
