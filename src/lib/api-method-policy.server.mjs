/**
 * @typedef {"GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS"} ApiMethod
 */

/**
 * @param {string} path
 * @param {readonly ApiMethod[]} methods
 */
function apiRoute(path, methods) {
  return Object.freeze({ path, methods: Object.freeze([...methods]) });
}

/**
 * This is the fail-closed method inventory for every TanStack API route.
 * Keep it in sync with the route handlers; the source contract test enforces
 * complete coverage and exact method parity.
 */
export const API_METHOD_POLICY_ROUTES = Object.freeze([
  apiRoute("/api/account", ["DELETE"]),
  apiRoute("/api/agents/runs", ["GET", "POST", "PATCH"]),
  apiRoute("/api/agents/teams", ["GET", "POST", "PATCH"]),
  apiRoute("/api/chat", ["POST"]),
  apiRoute("/api/chat/confirm", ["POST"]),
  apiRoute("/api/finances/exchange", ["POST"]),
  apiRoute("/api/finances/link-token", ["POST"]),
  apiRoute("/api/finances/webhook", ["POST"]),
  apiRoute("/api/generate-image", ["POST"]),
  apiRoute("/api/github/auth", ["GET"]),
  apiRoute("/api/github/callback", ["GET"]),
  apiRoute("/api/github/tool", ["POST"]),
  apiRoute("/api/github/webhook", ["POST"]),
  apiRoute("/api/google/auth", ["GET"]),
  apiRoute("/api/google/calendar", ["POST"]),
  apiRoute("/api/google/callback", ["GET"]),
  apiRoute("/api/google/disconnect", ["POST"]),
  apiRoute("/api/google/drive", ["POST"]),
  apiRoute("/api/google/gmail", ["POST"]),
  apiRoute("/api/google/status", ["GET"]),
  apiRoute("/api/health", ["GET"]),
  apiRoute("/api/integrations/accounts", ["GET"]),
  apiRoute("/api/integrations/oauth/callback/$provider", ["GET"]),
  apiRoute("/api/integrations/oauth/disconnect", ["POST"]),
  apiRoute("/api/integrations/oauth/start", ["POST"]),
  apiRoute("/api/memory", ["GET", "POST", "DELETE"]),
  apiRoute("/api/project-suggest", ["POST"]),
  apiRoute("/api/public/help-submit", ["POST"]),
  apiRoute("/api/public/payments/webhook", ["POST"]),
  apiRoute("/api/title", ["POST"]),
  apiRoute("/api/write", ["POST"]),
]);

const DYNAMIC_OAUTH_CALLBACK_PATH = "/api/integrations/oauth/callback/$provider";
const DYNAMIC_OAUTH_CALLBACK_PATTERN = /^\/api\/integrations\/oauth\/callback\/[^/]+$/u;
const dynamicOAuthCallbackRoute = API_METHOD_POLICY_ROUTES.find(
  ({ path }) => path === DYNAMIC_OAUTH_CALLBACK_PATH,
);

if (!dynamicOAuthCallbackRoute) {
  throw new Error("Dynamic OAuth callback method policy is missing");
}
const dynamicOAuthCallbackMethods = dynamicOAuthCallbackRoute.methods;

const staticApiMethods = new Map(
  API_METHOD_POLICY_ROUTES.filter(({ path }) => path !== DYNAMIC_OAUTH_CALLBACK_PATH).map(
    ({ path, methods }) => [path, methods],
  ),
);

/**
 * Returns only methods declared by the matching route handler. HEAD is handled
 * as the HTTP-safe counterpart of GET when requests are evaluated.
 *
 * @param {string} pathname
 * @returns {readonly ApiMethod[] | null}
 */
export function getDeclaredApiMethodsForPath(pathname) {
  const exact = staticApiMethods.get(pathname);
  if (exact) return exact;
  if (DYNAMIC_OAUTH_CALLBACK_PATTERN.test(pathname)) {
    return dynamicOAuthCallbackMethods;
  }
  return null;
}

/**
 * @param {readonly ApiMethod[]} declaredMethods
 * @returns {readonly ApiMethod[]}
 */
function effectiveAllowedMethods(declaredMethods) {
  if (!declaredMethods.includes("GET")) return declaredMethods;
  /** @type {ApiMethod[]} */
  const methods = [];
  for (const method of declaredMethods) {
    methods.push(method);
    if (method === "GET") methods.push("HEAD");
  }
  return methods;
}

/**
 * Returns a deterministic 405 for a known API route with an unsupported
 * method. Unknown paths and supported methods continue to TanStack unchanged.
 *
 * @param {Request} request
 * @returns {Response | null}
 */
export function rejectUnsupportedApiMethod(request) {
  const pathname = new URL(request.url).pathname;
  const declaredMethods = getDeclaredApiMethodsForPath(pathname);
  if (!declaredMethods) return null;

  const allowedMethods = effectiveAllowedMethods(declaredMethods);
  if (allowedMethods.includes(/** @type {ApiMethod} */ (request.method))) {
    return null;
  }

  return Response.json(
    { error: "method_not_allowed" },
    {
      status: 405,
      headers: {
        Allow: allowedMethods.join(", "),
        "Cache-Control": "no-store",
      },
    },
  );
}
