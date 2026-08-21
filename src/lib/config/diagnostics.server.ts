export type FeatureStatus = {
  configured: boolean;
  missing: string[];
};

export type SafeDiagnostics = {
  ok: true;
  app: "KovaGPT";
  build: {
    commit: string | null;
    branch: string | null;
  };
  bootRequirements: {
    publicSite: FeatureStatus;
  };
  features: {
    supabaseBrowser: FeatureStatus;
    supabaseServer: FeatureStatus;
    aiProvider: FeatureStatus;
    search: FeatureStatus;
    googleOAuth: FeatureStatus;
    stripe: FeatureStatus;
    emailPreview: FeatureStatus;
  };
  migrations: {
    deepResearchRuns: "declared";
    deepResearchEvidence: "declared";
  };
};

function hasEnv(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function feature(required: string[]): FeatureStatus {
  const missing = required.filter((name) => !hasEnv(name));
  return { configured: missing.length === 0, missing };
}

function oneOf(names: string[]): FeatureStatus {
  const configured = names.some((name) => hasEnv(name));
  return { configured, missing: configured ? [] : [names.join(" or ")] };
}

function oneOfGroups(groups: string[][]): FeatureStatus {
  const configured = groups.some((group) => group.every((name) => hasEnv(name)));
  return {
    configured,
    missing: configured ? [] : [groups.map((group) => group.join(" + ")).join(" or ")],
  };
}

function allGroups(groups: FeatureStatus[]): FeatureStatus {
  const missing = groups.flatMap((group) => group.missing);
  return { configured: missing.length === 0, missing };
}

function aiProviderStatus(): FeatureStatus {
  if (hasEnv("AZURE_OPENAI_ENDPOINT")) {
    return allGroups([
      oneOfGroups([["AZURE_OPENAI_API_KEY"], ["IDENTITY_ENDPOINT", "IDENTITY_HEADER"]]),
      feature([
        "AZURE_OPENAI_DEPLOYMENT_CHAT",
        "AZURE_OPENAI_DEPLOYMENT_THINKING",
        "AZURE_OPENAI_DEPLOYMENT_DEEP",
      ]),
    ]);
  }
  return feature(["OPENAI_API_KEY"]);
}

function nullableEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function safeDiagnostics(): SafeDiagnostics {
  return {
    ok: true,
    app: "KovaGPT",
    build: {
      commit:
        nullableEnv("GITHUB_SHA") ??
        nullableEnv("VERCEL_GIT_COMMIT_SHA") ??
        nullableEnv("CF_PAGES_COMMIT_SHA") ??
        nullableEnv("KOVA_BUILD_COMMIT"),
      branch:
        nullableEnv("GITHUB_REF_NAME") ??
        nullableEnv("VERCEL_GIT_COMMIT_REF") ??
        nullableEnv("CF_PAGES_BRANCH") ??
        nullableEnv("KOVA_BUILD_BRANCH"),
    },
    bootRequirements: {
      publicSite: { configured: true, missing: [] },
    },
    features: {
      supabaseBrowser: allGroups([
        oneOf(["VITE_SUPABASE_URL", "SUPABASE_URL"]),
        oneOf([
          "VITE_SUPABASE_PUBLISHABLE_KEY",
          "VITE_SUPABASE_ANON_KEY",
          "SUPABASE_PUBLISHABLE_KEY",
          "SUPABASE_ANON_KEY",
        ]),
      ]),
      supabaseServer: allGroups([
        oneOf(["SUPABASE_URL"]),
        oneOf(["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]),
        oneOf(["SUPABASE_SERVICE_ROLE_KEY"]),
      ]),
      aiProvider: aiProviderStatus(),
      search: feature(["FIRECRAWL_API_KEY"]),
      googleOAuth: feature([
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "GOOGLE_REDIRECT_URI",
      ]),
      stripe: feature(["STRIPE_SANDBOX_API_KEY", "STRIPE_LIVE_API_KEY"]),
      emailPreview: feature(["EMAIL_PREVIEW_TOKEN"]),
    },
    migrations: {
      deepResearchRuns: "declared",
      deepResearchEvidence: "declared",
    },
  };
}
