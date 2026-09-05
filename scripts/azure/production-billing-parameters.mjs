import { createHash } from "node:crypto";

const LIVE_ACCOUNT = "acct_1UAeDgAEZlsb6DBY";
const PORTAL_CONFIGURATION = "bpc_1UB2ZxAEZlsb6DBYU3PoJJPU";
const SECRET_PARAMETERS = [
  "stripeLiveApiKeySecretUri",
  "stripeLiveWebhookSecretUri",
  "stripeSandboxApiKeySecretUri",
  "stripeSandboxWebhookSecretUri",
];

function parameterValue(parameters, name, fallback) {
  if (!Object.hasOwn(parameters, name)) return fallback;
  const entry = parameters[name];
  if (!entry || typeof entry !== "object" || typeof entry.value !== "string") {
    throw new Error(`The protected ${name} parameter must have a string value`);
  }
  return entry.value;
}

// Pure source validation: never resolves Key Vault, reads a credential, or calls Stripe.
export function validateProductionBillingParameters({
  parameters,
  provenance,
  stripePublishableKey = "",
}) {
  const runtime = parameterValue(parameters, "stripeBillingRuntime", "disabled");
  if (!["disabled", "durable"].includes(runtime)) {
    throw new Error("The production billing runtime must be disabled or durable");
  }
  const account = parameterValue(parameters, "stripeLiveAccountId", LIVE_ACCOUNT);
  const portal = parameterValue(
    parameters,
    "stripeBillingPortalConfigurationId",
    PORTAL_CONFIGURATION,
  );
  if (account !== LIVE_ACCOUNT || portal !== PORTAL_CONFIGURATION) {
    throw new Error("The production Stripe account or Portal configuration is not approved");
  }
  if (
    typeof stripePublishableKey !== "string" ||
    (stripePublishableKey !== "" && !/^pk_live_[A-Za-z0-9]{16,}$/u.test(stripePublishableKey))
  ) {
    throw new Error("The production Stripe browser key must be an approved live publishable key");
  }
  const expectedFingerprint = stripePublishableKey
    ? createHash("sha256").update(stripePublishableKey).digest("hex")
    : null;
  // Require the explicit null as well: older artifacts did not check for a stale
  // Stripe browser key and cannot establish this contract.
  if (provenance?.stripePublishableKeySha256 !== expectedFingerprint) {
    throw new Error("The candidate Stripe browser-key fingerprint does not match production");
  }

  const vaultName = parameterValue(parameters, "keyVaultName", "");
  const secretValues = {};
  for (const name of SECRET_PARAMETERS) {
    const value = parameterValue(parameters, name, "");
    if (value !== "") {
      // Only pinned references to an existing secret in the selected production
      // vault. No raw key, cross-vault reference, query, alias, or unversioned URL.
      const parsed =
        /^https:\/\/([a-zA-Z0-9-]{3,24})\.vault\.azure\.net\/secrets\/[a-zA-Z0-9-]{1,127}\/([a-fA-F0-9]{32})$/u.exec(
          value,
        );
      if (!parsed || parsed[1].toLowerCase() !== vaultName.toLowerCase()) {
        throw new Error(
          `The protected ${name} must be a versioned secret URI in the selected vault`,
        );
      }
    }
    secretValues[name] = value;
  }
  if (
    runtime === "durable" &&
    (!stripePublishableKey ||
      !secretValues.stripeLiveApiKeySecretUri ||
      !secretValues.stripeLiveWebhookSecretUri)
  ) {
    throw new Error(
      "Durable billing requires the verified browser key and both live secret references",
    );
  }
  return {
    stripeBillingRuntime: { value: runtime },
    stripeLiveAccountId: { value: account },
    stripeBillingPortalConfigurationId: { value: portal },
    ...Object.fromEntries(Object.entries(secretValues).map(([name, value]) => [name, { value }])),
  };
}
