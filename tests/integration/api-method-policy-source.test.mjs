import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { API_METHOD_POLICY_ROUTES } from "../../src/lib/api-method-policy.server.mjs";

const HTTP_METHOD_PATTERN = /^\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS):\s*(?:async\s*)?\(/gmu;

test("the centralized inventory exactly covers every generated server route handler", async () => {
  const routeTree = await readFile("src/routeTree.gen.ts", "utf8");
  const routeIds = [...routeTree.matchAll(/from ["']\.\/routes\/([^"']+)["']/gu)].map(
    (match) => match[1],
  );
  const uniqueRouteIds = [...new Set(routeIds)];

  const auditedRoutes = (
    await Promise.all(
      uniqueRouteIds.map(async (routeId) => {
        const source = await readFile(`src/routes/${routeId}.ts`, "utf8");
        if (!/server:\s*\{\s*handlers:\s*\{/u.test(source)) return null;
        const methods = [...source.matchAll(HTTP_METHOD_PATTERN)].map((match) => match[1]);
        assert.ok(methods.length > 0, `${routeId} must expose at least one HTTP method`);
        return { path: `/${routeId}`, methods };
      }),
    )
  ).filter(Boolean);
  assert.equal(auditedRoutes.length, 38);

  const sortByPath = (left, right) => left.path.localeCompare(right.path);
  const actual = API_METHOD_POLICY_ROUTES.map(({ path, methods }) => ({
    path,
    methods: [...methods],
  })).sort(sortByPath);

  assert.deepEqual(actual, auditedRoutes.sort(sortByPath));
});

test("the server rejects unsupported known API methods before TanStack dispatch", async () => {
  const source = await readFile("src/server.ts", "utf8");
  assert.match(
    source,
    /import \{ rejectUnsupportedApiMethod \} from "\.\/lib\/api-method-policy\.server\.mjs"/u,
  );
  assert.match(source, /if \(methodRejected\) return hardenResponse\(methodRejected\)/u);

  const policyCheck = source.indexOf("rejectUnsupportedApiMethod(request)");
  const crossSiteCheck = source.indexOf("rejectCrossSiteRequest(request)");
  const tanstackLoad = source.indexOf("const handler = await getServerEntry()");
  assert.ok(policyCheck >= 0);
  assert.ok(policyCheck < crossSiteCheck);
  assert.ok(policyCheck < tanstackLoad);
});
