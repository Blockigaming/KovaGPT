import { PUBLIC_STRIPE_ACCOUNT_ID } from "@/config/public-config";
import { runtimeEnv } from "@/lib/runtime-env.server";

export type CapabilityState =
  | "ready"
  | "degraded"
  | "unavailable"
  | "misconfigured"
  | "migration-required"
  | "schema-drift"
  | "database-timeout";

export type Capability = { state: CapabilityState; optional: boolean };
export type ReadinessReport = {
  status: "ready" | "degraded" | "unavailable";
  checkedAt: string;
  capabilities: Record<string, Capability>;
};

const present = (...names: string[]) => names.every((name) => Boolean(runtimeEnv(name)));
const any = (...names: string[]) => names.some((name) => Boolean(runtimeEnv(name)));
const capability = (configured: boolean, optional = true): Capability => ({
  state: configured ? "ready" : optional ? "unavailable" : "misconfigured",
  optional,
});

function supabaseConfigured(): boolean {
  return (
    present("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") &&
    any("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY")
  );
}

function stripeAccountConfigured(): boolean {
  return runtimeEnv("STRIPE_LIVE_ACCOUNT_ID") === PUBLIC_STRIPE_ACCOUNT_ID;
}

function stripeServerKeyConfigured(): boolean {
  return /^(?:rk|sk)_live_[A-Za-z0-9]+$/u.test(runtimeEnv("STRIPE_LIVE_API_KEY") ?? "");
}

function stripeWebhookConfigured(): boolean {
  return (
    stripeAccountConfigured() &&
    stripeServerKeyConfigured() &&
    /^whsec_[A-Za-z0-9]+$/u.test(runtimeEnv("PAYMENTS_LIVE_WEBHOOK_SECRET") ?? "")
  );
}

function stripeCheckoutConfigured(): boolean {
  return (
    stripeAccountConfigured() &&
    stripeServerKeyConfigured() &&
    /^pk_live_[A-Za-z0-9]+$/u.test(runtimeEnv("VITE_PAYMENTS_CLIENT_TOKEN") ?? "")
  );
}

function stripePortalConfigured(): boolean {
  return (
    stripeAccountConfigured() &&
    stripeServerKeyConfigured() &&
    /^bpc_[A-Za-z0-9]+$/u.test(runtimeEnv("STRIPE_BILLING_PORTAL_CONFIGURATION_ID") ?? "")
  );
}

function aiProviderConfigured(): boolean {
  if (runtimeEnv("AZURE_OPENAI_ENDPOINT")) {
    const authenticated =
      Boolean(runtimeEnv("AZURE_OPENAI_API_KEY")) ||
      present("IDENTITY_ENDPOINT", "IDENTITY_HEADER");
    return (
      authenticated &&
      present(
        "AZURE_OPENAI_DEPLOYMENT_CHAT",
        "AZURE_OPENAI_DEPLOYMENT_THINKING",
        "AZURE_OPENAI_DEPLOYMENT_DEEP",
      )
    );
  }
  return Boolean(runtimeEnv("OPENAI_API_KEY"));
}

export function structuralReadiness(): ReadinessReport {
  const capabilities: Record<string, Capability> = {
    productionUrl: capability(any("KOVA_PUBLIC_URL", "APP_URL", "SITE_URL"), false),
    auth: capability(supabaseConfigured(), false),
    supabase: capability(supabaseConfigured(), false),
    aiProvider: capability(aiProviderConfigured()),
    agentRunner: capability(present("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")),
    stripe: capability(
      stripeWebhookConfigured() && stripeCheckoutConfigured() && stripePortalConfigured(),
    ),
    stripeWebhook: capability(stripeWebhookConfigured()),
    stripeCheckout: capability(stripeCheckoutConfigured()),
    stripePortal: capability(stripePortalConfigured()),
    email: capability(any("RESEND_API_KEY", "EMAIL_API_KEY")),
    google: capability(
      present("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"),
    ),
    github: capability(
      present("GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET", "CONNECTOR_ENCRYPTION_KEY"),
    ),
    scheduledTasks: capability(any("CRON_SECRET", "SCHEDULED_TASK_SECRET")),
    accountExports: capability(any("ACCOUNT_EXPORT_WORKER_SECRET", "CRON_SECRET")),
    images: capability(aiProviderConfigured()),
    research: capability(any("FIRECRAWL_API_KEY")),
    storage: capability(present("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")),
    migrations: { state: "migration-required", optional: false },
  };
  const required = Object.values(capabilities).filter((entry) => !entry.optional);
  const unavailable = required.some((entry) => entry.state === "misconfigured");
  return {
    status: unavailable ? "unavailable" : "degraded",
    checkedAt: new Date().toISOString(),
    capabilities,
  };
}

let cached: { expires: number; report: ReadinessReport } | undefined;
export async function runtimeReadiness(timeoutMs = 1500): Promise<ReadinessReport> {
  if (cached && cached.expires > Date.now()) return structuredClone(cached.report);
  const report = structuralReadiness();
  if (report.capabilities.supabase.state !== "ready") return report;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = runtimeEnv("SUPABASE_URL")!;
    const key = runtimeEnv("SUPABASE_SERVICE_ROLE_KEY")!;
    const response = await fetch(`${url}/rest/v1/rpc/kovagpt_schema_health`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal,
    });
    const contract = response.ok
      ? ((await response.json()) as { ready?: boolean; version?: string })
      : null;
    report.capabilities.migrations = {
      state: !response.ok
        ? response.status === 404
          ? "migration-required"
          : "degraded"
        : contract?.version !== "20260803120000-v1" || !contract.ready
          ? "schema-drift"
          : "ready",
      optional: false,
    };
    report.status = report.capabilities.migrations.state === "ready" ? "ready" : "unavailable";
  } catch {
    report.capabilities.supabase.state = controller.signal.aborted
      ? "database-timeout"
      : "degraded";
    report.capabilities.auth.state = report.capabilities.supabase.state;
    report.status = "unavailable";
  } finally {
    clearTimeout(timer);
  }
  cached = { expires: Date.now() + 15_000, report: structuredClone(report) };
  return report;
}
