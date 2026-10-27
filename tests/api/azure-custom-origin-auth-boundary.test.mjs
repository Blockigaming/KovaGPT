import assert from "node:assert/strict";
import test from "node:test";
import { authHttp } from "../helpers/kova-auth-http.mjs";
import { createOpenAiServiceHandler } from "../../src/lib/ai/openai-service-handler.server.mjs";
import {
  enforceAzureProductionOriginBoundary,
  normalizeAzureProductionRequest,
} from "../../src/lib/origin-boundary.server.ts";

const environment = {
  AZURE_ENVIRONMENT: "production",
  KOVA_PRODUCTION_ORIGIN_MODE: "azure-direct",
  CONTAINER_APP_NAME: "kovagpt-prod-web",
  KOVA_AZURE_PUBLIC_ORIGIN: "https://kovagpt-prod-web.fixture.eastus.azurecontainerapps.io",
  KOVA_AZURE_CUSTOM_PUBLIC_ORIGIN: "https://kovagpt.com",
};

for (const mode of ["supabase", "dual"]) {
  test(`custom canonical ingress preserves actual protected-route anonymous 401 in ${mode} mode`, async () => {
    const unexpected = () =>
      assert.fail("Anonymous requests must not reach Auth, data, quotas or providers");
    const fixture = authHttp({
      mode,
      env: {},
      modules: {
        "@tanstack/react-router": { createFileRoute: () => (options) => options },
        "@supabase/supabase-js": { createClient: unexpected },
        "@/lib/billing-entitlement.server": { resolveEffectiveBillingTier: unexpected },
        "@/lib/ai/openai-admission-runtime.server": {
          consumeOpenAiApplicationAdmission: unexpected,
        },
        "@/lib/runtime-env.server": { runtimeEnv: unexpected },
        "@/lib/ai/openai-service-runtime.server": { openAiServices: unexpected },
        "@/lib/ai/openai-service-handler.server.mjs": { createOpenAiServiceHandler },
        "@/lib/upload-quota.server.mjs": { reserveUploads: unexpected },
        "@/lib/modes": { DAILY_UPLOAD_LIMIT_BY_TIER: {} },
      },
    });
    fixture.loadModule("@/lib/api-auth.server", "src/lib/api-auth.server.ts");
    const route = fixture.loadModule("services-route", "src/routes/api/ai/services.ts").Route;
    for (const method of ["GET", "POST"]) {
      const incoming = new Request("http://kovagpt.com/api/ai/services", {
        method,
        headers: { "x-forwarded-proto": "https", origin: "https://kovagpt.com" },
      });
      assert.equal(enforceAzureProductionOriginBoundary(incoming, environment), null);
      const normalized = normalizeAzureProductionRequest(incoming, environment);
      const response = await route.server.handlers[method]({ request: normalized });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { error: "Unauthorized" });
    }
    assert.deepEqual(fixture.calls, []);
  });
}
