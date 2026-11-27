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
export function developerBrowserFields(value) {
  return {
    url: developerBrowserUrl(value?.url).href,
    session_seconds: BROWSER_SESSION_SECONDS,
  };
}
export function validDeveloperBrowserRequest(body) {
  try {
    return (
      body?.model === BROWSER_MODEL &&
      Object.keys(body).length === 3 &&
      body.session_seconds === BROWSER_SESSION_SECONDS &&
      developerBrowserUrl(body.url).href === body.url
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
