const fail = () => {
  throw Error("cloud_browser_rules_invalid");
};
export function cloudBrowserOrigin(value) {
  if (typeof value !== "string" || value.length > 512) fail();
  let url;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    fail();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(url.hostname) ||
    /(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/i.test(url.hostname)
  )
    fail();
  return url.origin;
}
export function parseCloudBrowserRules(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "sites") ||
    !Array.isArray(value.sites) ||
    value.sites.length > 50
  )
    fail();
  const seen = new Set();
  return {
    sites: value.sites.map((site) => {
      if (
        !site ||
        typeof site !== "object" ||
        Array.isArray(site) ||
        Object.keys(site).some((key) => !["origin", "access"].includes(key)) ||
        !["ask", "block"].includes(site.access)
      )
        fail();
      const origin = cloudBrowserOrigin(site.origin);
      if (seen.has(origin)) fail();
      seen.add(origin);
      return { origin, access: site.access };
    }),
  };
}
export function assertCloudBrowserDestination(rules, destination) {
  const url = new URL(destination);
  if (url.protocol !== "https:" || url.username || url.password || url.port) fail();
  if (
    parseCloudBrowserRules(rules).sites.some(
      (site) => site.origin === url.origin && site.access === "block",
    )
  )
    throw Error("cloud_browser_site_denied");
}
