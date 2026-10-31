/** Future browser adapters emit this metadata with tool=browser_interact.
 * Preview bytes stay behind the same-origin authenticated browser endpoint. */
export function normalizeBrowserActivity(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(value.sessionId ?? "") ||
    !Number.isSafeInteger(value.tabCount) ||
    value.tabCount < 0 ||
    value.tabCount > 1000 ||
    !Number.isFinite(value.observedAt)
  )
    return undefined;
  let hostname =
    typeof value.hostname === "string" && /^[a-z0-9.-]{1,253}$/iu.test(value.hostname)
      ? value.hostname
      : undefined;
  try {
    const url = new URL(value.url);
    if (url.protocol === "https:" && !url.username && !url.password) hostname = url.hostname;
  } catch {}
  const previewPath =
    typeof value.previewPath === "string" &&
    /^\/api\/(?:cloud-)?browser\/preview\/[A-Za-z0-9_-]{1,128}(?:\?v=\d{1,16})?$/u.test(
      value.previewPath,
    )
      ? value.previewPath
      : undefined;
  return {
    sessionId: value.sessionId,
    tabCount: value.tabCount,
    observedAt: value.observedAt,
    ...(hostname ? { hostname } : {}),
    ...(previewPath ? { previewPath } : {}),
  };
}
export function browserActivityIsFresh(value, now = Date.now()) {
  return Boolean(value && value.observedAt <= now + 30000 && value.observedAt >= now - 300000);
}
