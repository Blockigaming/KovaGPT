import {
  DAILY_CHAT_LIMIT_BY_TIER,
  DAILY_IMAGE_LIMIT_BY_TIER,
  DAILY_UPLOAD_LIMIT_BY_TIER,
  MODES,
  STORAGE_LIMITS_BYTES,
  modesForTier,
  type ModeId,
  type Tier,
} from "@/lib/modes";
import { BILLING_PLANS, type BillingLookupKey } from "@/lib/billing-plans";
import { modeDisplayLabel } from "@/lib/mode-display-label";

export type CapabilityAvailability =
  "available" | "limited" | "provider-dependent" | "unavailable" | "excluded";

export type CapabilityId =
  | "webSearch"
  | "attachments"
  | "dataAnalysis"
  | "canvas"
  | "memory"
  | "imageGeneration"
  | "imageEditing"
  | "projects"
  | "apps"
  | "scheduledTasks"
  | "cloudHistory"
  | "library"
  | "mfa"
  | "voice";

export type PublishedCapability = Readonly<{
  label: string;
  availability: CapabilityAvailability;
  minimumTier?: Tier;
  summary: string;
  limitation?: string;
}>;

export type PublishedMode = Readonly<{
  id: ModeId;
  label: string;
  description: string;
  minimumTier: Tier;
}>;

export type PublishedPlan = Readonly<{
  tier: Tier;
  name: string;
  monthlyPriceUsd: number;
  lookupKey: BillingLookupKey | null;
  trialPeriodDays: number;
  description: string;
  features: readonly string[];
}>;

type CapabilityRegistry = Readonly<{
  voiceScope: "required_provider_dependent";
  modes: readonly PublishedMode[];
  modesByTier: Readonly<Record<Tier, readonly PublishedMode[]>>;
  features: Readonly<Record<CapabilityId, PublishedCapability>>;
  plans: Readonly<Record<Tier, PublishedPlan>>;
  workingApps: readonly string[];
  enterprise: Readonly<{
    name: "Enterprise";
    priceLabel: "Custom";
    description: string;
    features: readonly string[];
  }>;
}>;

const PLAN_LABELS: Record<Tier, string> = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
};

const MODE_PUBLIC_COPY: Record<ModeId, string> = {
  instant: "Shortest, speed-focused response instructions.",
  medium: "Balanced response instructions for everyday use.",
  thinking: "Careful, structured response instructions for harder requests.",
  high: "Plus response instructions emphasizing verification and completeness.",
  extra_high: "Pro response instructions emphasizing alternatives and detail.",
  max: "Maximum-depth response instructions emphasizing polished, comprehensive answers.",
  ultra: "The deepest response instructions for exhaustive, carefully verified answers.",
};

// Legacy mode IDs remain readable in history, but unavailable modes must not
// become public product offerings merely because the compatibility catalog has them.
const publishedModeIds = new Set(
  (["free", "plus", "pro"] as const).flatMap((tier) => modesForTier(tier).map((mode) => mode.id)),
);
const modes: readonly PublishedMode[] = MODES.filter((mode) => publishedModeIds.has(mode.id)).map(
  (mode) => ({
    id: mode.id,
    label: mode.label,
    description: MODE_PUBLIC_COPY[mode.id],
    minimumTier: mode.tier,
  }),
);

function publishedModesForTier(tier: Tier): readonly PublishedMode[] {
  return modesForTier(tier).map((mode) => {
    const published = modes.find((entry) => entry.id === mode.id)!;
    return { ...published, label: mode.label };
  });
}

const modesByTier: Record<Tier, readonly PublishedMode[]> = {
  free: publishedModesForTier("free"),
  plus: publishedModesForTier("plus"),
  pro: publishedModesForTier("pro"),
};

function formatStorage(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${Number.isInteger(gib) ? gib : gib.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export const PLAN_ALLOWANCE_COPY = {
  free: {
    chat: `${DAILY_CHAT_LIMIT_BY_TIER.free} messages per day · one fifth of Plus usage`,
    image: `${DAILY_IMAGE_LIMIT_BY_TIER.free} image generations per day`,
    upload: `${DAILY_UPLOAD_LIMIT_BY_TIER.free} file uploads per day`,
    storage: "Small published storage allowance",
  },
  plus: {
    chat: `${DAILY_CHAT_LIMIT_BY_TIER.plus} messages per day · baseline usage`,
    image: `${DAILY_IMAGE_LIMIT_BY_TIER.plus} image generations per day`,
    upload: `${DAILY_UPLOAD_LIMIT_BY_TIER.plus} file uploads per day`,
    storage: "Higher published storage allowance",
  },
  pro: {
    chat: `${DAILY_CHAT_LIMIT_BY_TIER.pro} messages per day · 15× Plus usage`,
    image: `${DAILY_IMAGE_LIMIT_BY_TIER.pro} image generations per day`,
    upload: `${DAILY_UPLOAD_LIMIT_BY_TIER.pro} file uploads per day`,
    storage: "Highest published storage allowance",
  },
} as const;

function planFeatures(tier: Tier): readonly string[] {
  const allowance = PLAN_ALLOWANCE_COPY[tier];
  // Public plan wording uses Instant; compatibility mode labels and routing stay intact.
  const modeLabels = modesByTier[tier].map(modeDisplayLabel);
  const features = [
    `${modeLabels
      .join(modeLabels.length === 2 ? " and " : ", ")
      .replace(/, ([^,]+)$/, ", and $1")} ${modeLabels.length === 1 ? "mode" : "modes"}`,
    allowance.chat,
    allowance.image,
    allowance.upload,
    allowance.storage,
    "Search and image generation when their configured providers are available",
  ];
  if (tier === "plus" || tier === "pro")
    features.push("Adaptive Memory when enabled and available");
  return features;
}

export const CAPABILITY_REGISTRY = Object.freeze({
  voiceScope: "required_provider_dependent",
  modes,
  modesByTier,
  features: {
    webSearch: {
      label: "Search",
      availability: "provider-dependent",
      minimumTier: "free",
      summary:
        "Search can retrieve current web sources when the configured search and AI providers are available.",
      limitation: "Open cited links and verify that each source supports the answer.",
    },
    attachments: {
      label: "Files",
      availability: "limited",
      minimumTier: "free",
      summary:
        "Chat accepts text, code, CSV, JSON, and image attachments, and extracts readable text from supported PDF, DOCX, XLSX, and PPTX files. Project knowledge indexes supported text-like files.",
      limitation:
        "Document extraction is limited to 10 MB and may omit formatting, scanned content, or unreadable pages. Library original PDF preview is separate from extracted text; Office originals can be downloaded but are not rendered.",
    },
    dataAnalysis: {
      label: "Data analysis",
      availability: "limited",
      minimumTier: "free",
      summary:
        "KovaGPT can reason over supported text, CSV, JSON, and image attachments and can present tables or charts.",
      limitation: "It does not provide a general spreadsheet or uploaded-code execution sandbox.",
    },
    canvas: {
      label: "Canvas",
      availability: "limited",
      minimumTier: "free",
      summary:
        "Generated writing, code, and website artifacts can open in an editor with export and session-only versions.",
      limitation: "Versions are not durable after the editor closes.",
    },
    memory: {
      label: "Adaptive Memory",
      availability: "available",
      minimumTier: "plus",
      summary:
        "Signed-in Plus and Pro users can use cross-chat memory when it is enabled. Temporary Chat does not use or update it.",
    },
    imageGeneration: {
      label: "Image generation",
      availability: "provider-dependent",
      minimumTier: "free",
      summary:
        "Signed-in users can generate images when the configured image provider is available and their daily allowance remains.",
    },
    imageEditing: {
      label: "Image editing",
      availability: "provider-dependent",
      minimumTier: "free",
      summary:
        "Edit a Library image with a supported configured image model. An optional transparent PNG mask can guide the change. Image allowances apply.",
    },
    projects: {
      label: "Projects",
      availability: "available",
      minimumTier: "free",
      summary:
        "Projects organize chats, supported files, images, notes, tasks, project memory, and instructions.",
    },
    apps: {
      label: "Apps",
      availability: "provider-dependent",
      minimumTier: "free",
      summary:
        "KovaGPT can connect Google, Gmail, Google Drive, Google Calendar, and GitHub from the Apps page.",
      limitation:
        "Each connection and action depends on configured credentials, granted scopes, and service availability.",
    },
    scheduledTasks: {
      label: "Scheduled tasks",
      availability: "unavailable",
      summary:
        "Background scheduled execution is unavailable in this deployment. Previously saved task records can still be managed.",
    },
    cloudHistory: {
      label: "Conversation history",
      availability: "limited",
      summary:
        "Signed-in ordinary chats synchronize with your account when chat sync is available. Offline edits stay on this device until acknowledged; Temporary Chat stays out of history.",
    },
    library: {
      label: "Library",
      availability: "limited",
      summary:
        "Library contains items that you explicitly save or upload; it is not an automatic copy of every conversation.",
    },
    mfa: {
      label: "Multi-factor authentication",
      availability: "available",
      summary:
        "Signed-in users can manage multi-factor authentication from Settings when their sign-in method supports it.",
    },
    voice: {
      label: "Voice",
      availability: "provider-dependent",
      summary:
        "Transcription, speech synthesis, voice conversion, and saved-response Read aloud depend on configured voice access and remaining usage allowances.",
      limitation:
        "Microphone conversations require explicit Start and Finish turn. Provider access, commercial entitlement, browser permission, and actual playback must be qualified for the deployed runtime.",
    },
  },
  plans: {
    free: {
      tier: "free",
      name: PLAN_LABELS.free,
      monthlyPriceUsd: 0,
      lookupKey: null,
      trialPeriodDays: 0,
      description: "Core KovaGPT chat with published daily allowances.",
      features: planFeatures("free"),
    },
    plus: {
      tier: "plus",
      name: PLAN_LABELS.plus,
      monthlyPriceUsd: 16,
      lookupKey: BILLING_PLANS.plus_monthly.lookupKey,
      trialPeriodDays: BILLING_PLANS.plus_monthly.trialPeriodDays,
      description:
        "Default, Medium, Thinking, High, and Adaptive Memory. Operational usage limits still apply.",
      features: planFeatures("plus"),
    },
    pro: {
      tier: "pro",
      name: PLAN_LABELS.pro,
      monthlyPriceUsd: 80,
      lookupKey: BILLING_PLANS.pro_monthly.lookupKey,
      trialPeriodDays: BILLING_PLANS.pro_monthly.trialPeriodDays,
      description:
        "Default, Medium, Thinking, High, Extra high, Max, and Ultra. Operational token and premium-request limits still apply.",
      features: planFeatures("pro"),
    },
  },
  workingApps: ["Google", "Gmail", "Google Drive", "Google Calendar", "GitHub"],
  enterprise: {
    name: "Enterprise",
    priceLabel: "Custom",
    description:
      "Discuss organizational requirements with Kova. Availability and commercial terms are confirmed in writing before purchase.",
    features: [
      "Custom access determined through sales",
      "Requirements and security review",
      "Custom commercial terms where available",
      "Deployment and support scope confirmed before purchase",
    ],
  },
} satisfies CapabilityRegistry);
