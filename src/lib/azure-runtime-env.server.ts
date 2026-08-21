const SECRET_NAME_PATTERN = /(SECRET|TOKEN|KEY|PASSWORD|PRIVATE|CONNECTION_STRING)/u;

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
  "AZURE_OPENAI_API_KEY",
  "AZURE_FOUNDRY_ENDPOINT",
  "AZURE_CLIENT_ID",
] as const;

function booleanEnv(environment: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = environment[name];
  if (raw == null || raw.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/iu.test(raw)) return true;
  if (/^(0|false|no|off)$/iu.test(raw)) return false;
  throw new Error(`[env] ${name} must be true or false.`);
}

function missing(environment: NodeJS.ProcessEnv, names: string[]): string[] {
  return names.filter((name) => !environment[name] || environment[name]?.trim() === "");
}

function azureIdentityReady(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(environment.IDENTITY_ENDPOINT?.trim() && environment.IDENTITY_HEADER?.trim());
}

export function validateAzureRuntimeEnv(environment = process.env): void {
  const leakedPublicSecrets = Object.keys(environment).filter(
    (name) =>
      publicClientPrefixes.some((prefix) => name.startsWith(prefix)) &&
      SECRET_NAME_PATTERN.test(name) &&
      !PUBLIC_CLIENT_ALLOWLIST.has(name),
  );
  if (leakedPublicSecrets.length > 0) {
    throw new Error(
      `[env] Refusing to start because public VITE_ variables look secret-bearing: ${leakedPublicSecrets.join(
        ", ",
      )}. Move server-only secrets to non-VITE_ variables so they are not bundled for browsers.`,
    );
  }

  const aiGenerationEnabled = booleanEnv(environment, "AI_GENERATION_ENABLED", false);
  const azureEndpoint = environment.AZURE_OPENAI_ENDPOINT?.trim();
  const azureCredentialsReady = Boolean(
    environment.AZURE_OPENAI_API_KEY?.trim() || azureIdentityReady(environment),
  );
  const directOpenAiReady = Boolean(environment.OPENAI_API_KEY?.trim());

  if (aiGenerationEnabled && !directOpenAiReady && !(azureEndpoint && azureCredentialsReady)) {
    throw new Error(
      "[env] AI_GENERATION_ENABLED=true requires OPENAI_API_KEY, or AZURE_OPENAI_ENDPOINT with AZURE_OPENAI_API_KEY or Container Apps managed identity. Set AI_GENERATION_ENABLED=false before model access is approved.",
    );
  }

  if (azureEndpoint) {
    let endpoint: URL;
    try {
      endpoint = new URL(azureEndpoint);
    } catch {
      throw new Error("[env] AZURE_OPENAI_ENDPOINT must be a valid HTTPS Azure OpenAI endpoint.");
    }
    const allowedHost =
      endpoint.hostname.endsWith(".openai.azure.com") ||
      endpoint.hostname.endsWith(".services.ai.azure.com") ||
      endpoint.hostname.endsWith(".cognitiveservices.azure.com");
    if (
      endpoint.protocol !== "https:" ||
      !allowedHost ||
      endpoint.username ||
      endpoint.password ||
      endpoint.port ||
      endpoint.search ||
      endpoint.hash
    ) {
      throw new Error("[env] AZURE_OPENAI_ENDPOINT must use an approved Azure OpenAI hostname.");
    }

    const requiredAzureOpenAi = missing(environment, [
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
