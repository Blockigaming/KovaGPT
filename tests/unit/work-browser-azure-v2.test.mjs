import assert from "node:assert/strict";
import test from "node:test";
import {
  synthesizeBrowserResearch,
  validateBrowserManagedIdentityBoundary,
} from "../../browser-worker/src/azure-openai.mjs";

const environment = {
  KOVA_RUNTIME_PLATFORM: "azure-container-apps",
  AZURE_OPENAI_USE_MANAGED_IDENTITY: "true",
  AZURE_OPENAI_ENDPOINT: "https://kova.openai.azure.com",
  AZURE_OPENAI_DEPLOYMENT_DEEP: "gpt-5.6-sol-deployment",
  IDENTITY_ENDPOINT: "http://127.0.0.1:40342/msi/token",
  IDENTITY_HEADER: "fixture-header",
  AZURE_CLIENT_ID: "fixture-client-id",
};

test("browser synthesis rejects non-Azure platforms and every direct-key path", () => {
  assert.throws(
    () => validateBrowserManagedIdentityBoundary({ ...environment, KOVA_RUNTIME_PLATFORM: "local" }),
    /browser_runtime_platform_invalid/u,
  );
  assert.throws(
    () => validateBrowserManagedIdentityBoundary({ ...environment, OPENAI_API_KEY: "forbidden" }),
    /browser_direct_api_key_forbidden/u,
  );
  assert.throws(
    () =>
      validateBrowserManagedIdentityBoundary({
        ...environment,
        AZURE_OPENAI_API_KEY: "forbidden",
      }),
    /browser_direct_api_key_forbidden/u,
  );
});

test("invalid Azure endpoints are rejected before any request", () => {
  for (const endpoint of [
    "http://kova.openai.azure.com",
    "https://example.com",
    "https://kova.openai.azure.com:8443",
    "https://user:pass@kova.openai.azure.com",
  ]) {
    assert.throws(
      () => validateBrowserManagedIdentityBoundary({ ...environment, AZURE_OPENAI_ENDPOINT: endpoint }),
      /browser_azure_openai_endpoint_invalid/u,
    );
  }
});

test("research synthesis obtains managed identity and calls the Azure Responses boundary", async () => {
  const requests = [];
  const result = await synthesizeBrowserResearch(
    {
      objective: "Compare the supplied source evidence.",
      sources: [
        {
          title: "Fixture source",
          url: "https://example.com/report",
          text: "The fixture contains a supported factual statement.",
        },
      ],
      tokenBudget: 12_000,
      signal: AbortSignal.timeout(5_000),
    },
    environment,
    async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).startsWith(environment.IDENTITY_ENDPOINT)) {
        assert.equal(init.headers["X-IDENTITY-HEADER"], "fixture-header");
        return Response.json({
          access_token: "fixture-managed-identity-token",
          expires_on: Math.floor(Date.now() / 1000) + 3600,
        });
      }
      assert.equal(
        String(url),
        "https://kova.openai.azure.com/openai/v1/responses",
      );
      assert.equal(init.headers.Authorization, "Bearer fixture-managed-identity-token");
      const body = JSON.parse(init.body);
      assert.equal(body.model, "gpt-5.6-sol-deployment");
      assert.match(body.input, /only the supplied source captures/u);
      assert.match(body.input, /https:\/\/example\.com\/report/u);
      return Response.json(
        {
          output_text: "# Fixture report\n\nSupported finding [1].",
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        },
        { headers: { "x-request-id": "fixture-request" } },
      );
    },
  );

  assert.equal(requests.length, 2);
  assert.match(result.report, /Supported finding \[1\]/u);
  assert.deepEqual(result.usage, {
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
  });
  assert.equal(result.providerRequestId, "fixture-request");
});

test("provider failures are classified without reading or leaking their body", async () => {
  let canceled = false;
  await assert.rejects(
    synthesizeBrowserResearch(
      {
        objective: "Fixture objective",
        sources: [{ title: "Source", url: "https://example.com", text: "Evidence" }],
        tokenBudget: 1_000,
        signal: AbortSignal.timeout(5_000),
      },
      environment,
      async (url) => {
        if (String(url).startsWith(environment.IDENTITY_ENDPOINT)) {
          return Response.json({
            access_token: "fixture-managed-identity-token-2",
            expires_on: Math.floor(Date.now() / 1000) + 3600,
          });
        }
        return {
          ok: false,
          status: 503,
          body: {
            cancel: async () => {
              canceled = true;
            },
          },
        };
      },
    ),
    (error) => error.message === "browser_research_provider_temporary" && error.retryable === true,
  );
  assert.equal(canceled, true);
});
