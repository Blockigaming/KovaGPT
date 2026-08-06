const SECRET_NAME_PATTERN = /(SECRET|TOKEN|KEY|PASSWORD|PRIVATE|CONNECTION_STRING)/u;

// Publishable/client-side identifiers are designed to ship in browser bundles.
// They match the generic secret-name pattern above, so allow them explicitly.
const PUBLIC_CLIENT_ALLOWLIST = new Set([
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_PAYMENTS_CLIENT_TOKEN",
  "VITE_STRIPE_PUBLISHABLE_KEY",
]);

const publicClientPrefixes = ["VITE_"] as const;
const optionalServerValues = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SANDBOX_API_KEY",
  "STRIPE_LIVE_API_KEY",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_FOUNDRY_ENDPOINT",
  "AZURE_CLIENT_ID",
] as const;

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/iu.test(raw)) return true;
  if (/^(0|false|no|off)$/iu.test(raw)) return false;
  throw new Error(`[env] ${name} must be true or false.`);
}

function missing(names: string[]): string[] {
  return names.filter((name) => !process.env[name] || process.env[name]?.trim() === "");
}

export function validateAzureRuntimeEnv(environment = process.env): void {
  const leakedPublicSecrets = Object.keys(environment).filter(
    (name) =>
      publicClientPrefixes.some((prefix) => name.startsWith(prefix)) &&
      SECRET_NAME_PATTERN.test(name),
  );
  if (leakedPublicSecrets.length > 0) {
    throw new Error(
      `[env] Refusing to start because public VITE_ variables look secret-bearing: ${leakedPublicSecrets.join(
        ", ",
      )}. Move server-only secrets to non-VITE_ variables so they are not bundled for browsers.`,
    );
  }

  const aiGenerationEnabled = booleanEnv("AI_GENERATION_ENABLED", true);
  if (aiGenerationEnabled) {
    const aiProviderReady = Boolean(
      environment.OPENAI_API_KEY || environment.AZURE_OPENAI_ENDPOINT,
    );
    if (!aiProviderReady) {
      throw new Error(
        "[env] AI_GENERATION_ENABLED=true requires OPENAI_API_KEY for the direct OpenAI rollback path or AZURE_OPENAI_ENDPOINT for Azure OpenAI. Set AI_GENERATION_ENABLED=false for Azure staging before model quota is approved.",
      );
    }
  }

  const azureEndpoint = environment.AZURE_OPENAI_ENDPOINT;
  if (azureEndpoint) {
    const requiredAzureOpenAi = missing([
      "AZURE_OPENAI_API_VERSION",
      "AZURE_OPENAI_DEPLOYMENT_CHAT",
      "AZURE_OPENAI_DEPLOYMENT_THINKING",
      "AZURE_OPENAI_DEPLOYMENT_DEEP",
    ]);
    if (requiredAzureOpenAi.length > 0) {
      throw new Error(
        `[env] Azure OpenAI is configured but missing: ${requiredAzureOpenAi.join(", ")}.`,
      );
    }
  }

  for (const name of optionalServerValues) {
    if (name.startsWith("VITE_")) {
      throw new Error(
        `[env] Internal configuration error: ${name} is marked server-only and public.`,
      );
    }
  }
}
