export const BROWSER_MODEL = "browserbase-readonly-60s";
export const BROWSER_SESSION_SECONDS = 60;
const invalid = () => {
  throw new Error("developer_browser_invalid");
};
export function developerBrowserUrl(value) {
  if (typeof value !== "string" || value.length > 2048) invalid();
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.href !== value ||
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(url.hostname) ||
    url.hostname.includes("..") ||
    /(?:^|\.)(?:localhost|local|internal|invalid|test|example|onion)$/.test(url.hostname)
  )
    invalid();
  return url;
}
export function developerBrowserOrigins(raw) {
  if (typeof raw !== "string" || raw.length > 16384) invalid();
  const values = JSON.parse(raw);
  if (!Array.isArray(values) || !values.length || values.length > 20) invalid();
  const origins = values.map((value) => {
    if (typeof value !== "string") invalid();
    const url = developerBrowserUrl(value + "/");
    if (url.origin !== value) invalid();
    return value;
  });
  if (new Set(origins).size !== origins.length) invalid();
  return origins;
}
// All navigation is explicitly selected before a quote is issued. No model-directed
// navigation, arbitrary commands or additional origins enter the session.
export function developerBrowserTargets(value) {
  const first = developerBrowserUrl(value?.url);
  const next = value?.navigate;
  if (next === undefined) return [first];
  if (!Array.isArray(next) || next.length < 1 || next.length > 2) invalid();
  const targets = [first, ...next.map(developerBrowserUrl)];
  if (
    targets.some((url) => url.origin !== first.origin) ||
    new Set(targets.map((url) => url.href)).size !== targets.length
  )
    invalid();
  return targets;
}
export function developerBrowserFields(value) {
  const targets = developerBrowserTargets(value);
  return {
    url: targets[0].href,
    ...(targets.length > 1 ? { navigate: targets.slice(1).map((url) => url.href) } : {}),
    session_seconds: BROWSER_SESSION_SECONDS,
  };
}
// Transport-independent sequential execution. Check authority before and after every
// navigation. A partial or canceled plan is never returned as a completed receipt.
export async function executeDeveloperBrowserPlan(body, { check, capture, signal }) {
  if (!validDeveloperBrowserRequest(body)) invalid();
  const snapshots = [];
  for (const target of developerBrowserTargets(body)) {
    signal?.throwIfAborted();
    await check(target);
    signal?.throwIfAborted();
    const snapshot = await capture(target);
    signal?.throwIfAborted();
    await check(target);
    signal?.throwIfAborted();
    if (snapshot?.url !== target.href || typeof snapshot.text !== "string" || !snapshot.text.trim())
      throw new Error("developer_browser_unavailable");
    snapshots.push(snapshot);
  }
  return snapshots;
}
export function validDeveloperBrowserRequest(body) {
  try {
    return (
      body?.model === BROWSER_MODEL &&
      Object.keys(body).length === (body.navigate === undefined ? 3 : 4) &&
      Object.keys(body).every((key) =>
        ["model", "url", "navigate", "session_seconds"].includes(key),
      ) &&
      body.session_seconds === BROWSER_SESSION_SECONDS &&
      developerBrowserTargets(body).length >= 1
    );
  } catch {
    return false;
  }
}
export function developerBrowserReceipt(value) {
  return (
    value?.status === "completed" &&
    value.model === BROWSER_MODEL &&
    typeof value.id === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id) &&
    value.usage?.browser_sessions_60s === 1
  );
}
