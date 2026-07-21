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
    features: {
      supabaseBrowser: feature(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]),
      supabaseServer: feature([
        "SUPABASE_URL",
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
      ]),
      aiProvider: feature(["OPENAI_API_KEY"]),
      search: feature(["FIRECRAWL_API_KEY"]),
      googleOAuth: feature(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]),
      stripe: feature(["STRIPE_SANDBOX_API_KEY", "STRIPE_LIVE_API_KEY"]),
      emailPreview: feature(["EMAIL_PREVIEW_TOKEN"]),
    },
    migrations: {
      deepResearchRuns: "declared",
      deepResearchEvidence: "declared",
    },
  };
}
