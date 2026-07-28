export type ChatGptParityApp = {
  canonicalName: string;
  provider: string;
  officialCategory: string;
  publicIdentifier: string | null;
  plans: string[];
  regions: string[];
  connectionType: "oauth" | "admin_oauth" | "app";
  oauth: { required: boolean; scopes: string[] };
  capabilities: { search: boolean; sync: boolean; deepResearch: boolean; write: boolean };
  workspaceAdminSetup: boolean;
  kovaSupported: boolean;
  implementationStatus: "operational" | "credential_ready" | "blocked_provider";
  blockedReason: string | null;
  verifiedAt: string;
  source: string;
};

// This list intentionally fails closed. The official live directory could not be fetched from the
// release environment on 2026-07-27 (the network proxy returned 403), so no unverified name is
// allowed into the exact-parity collection. Kova connector adapters are maintained separately.
export const CHATGPT_PARITY_VERIFICATION = {
  attemptedAt: "2026-07-27T20:30:29Z",
  status: "official_directory_unavailable" as const,
  sources: [
    "https://chatgpt.com/apps",
    "https://help.openai.com/en/articles/11487775-apps-in-chatgpt",
  ],
};
export const CHATGPT_PARITY_APPS: readonly ChatGptParityApp[] = [];
export const KOVA_EXTENSION_PROVIDER_IDS = [
  "google",
  "microsoft",
  "github",
  "slack",
  "notion",
  "linear",
  "dropbox",
  "box",
] as const;
export const parityCounts = {
  total: CHATGPT_PARITY_APPS.length,
  operational: CHATGPT_PARITY_APPS.filter((app) => app.implementationStatus === "operational")
    .length,
  credentialReady: CHATGPT_PARITY_APPS.filter(
    (app) => app.implementationStatus === "credential_ready",
  ).length,
  blockedProvider: CHATGPT_PARITY_APPS.filter(
    (app) => app.implementationStatus === "blocked_provider",
  ).length,
  lastVerifiedAt: null,
};
