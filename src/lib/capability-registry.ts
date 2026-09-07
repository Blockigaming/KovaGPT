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

export type CapabilityAvailability =
  "available" | "limited" | "provider-dependent" | "unavailable" | "excluded";

export type CapabilityId =
  | "webSearch"
  | "deepResearch"
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
  voiceScope: "excluded";
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
  pro: "Pro response instructions emphasizing polished, comprehensive answers.",
  kova_5_5: "Previous generation Kova with balanced response instructions.",
  kova_5_4: "Older generation Kova kept for consistency with past work.",
  kova_o3: "Oldest available Kova generation.",
};

const modes: readonly PublishedMode[] = MODES.map((mode) => ({
  id: mode.id,
  label: mode.label,
  description: MODE_PUBLIC_COPY[mode.id],
  minimumTier: mode.tier,
}));

function publishedModesForTier(tier: Tier): readonly PublishedMode[] {
  return modesForTier(tier).map((mode) => modes.find((entry) => entry.id === mode.id)!);
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

function planFeatures(tier: Tier): readonly string[] {
  const allowance = {
    free: {
      chat: "Small message allowance",
      image: "Small image generation allowance",
      upload: "Small file and image upload allowance",
      storage: "Small published storage allowance",
    },
    plus: {
      chat: "Higher message allowance",
      image: "Higher image generation allowance",
      upload: "Higher file and image upload allowance",
      storage: "Higher published storage allowance",
    },
    pro: {
      chat: "Highest message allowance",
      image: "Highest image generation allowance",
      upload: "Highest file and image upload allowance",
      storage: "Highest published storage allowance",
    },
  }[tier];
  const features = [
    `${modesByTier[tier].map((mode) => mode.label).join(", ")} modes`,
    allowance.chat,
    allowance.image,
    allowance.upload,
    allowance.storage,
    "Search and image generation when their configured providers are available",
  ];
  if (tier === "plus" || tier === "pro") {
    features.push("Deep Research and Adaptive Memory when enabled and available");
  }
  return features;
}

export const CAPABILITY_REGISTRY = Object.freeze({
  voiceScope: "excluded",
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
    deepResearch: {
      label: "Deep Research",
      availability: "provider-dependent",
      minimumTier: "plus",
      summary:
        "Deep Research creates a longer source-backed report for signed-in Plus and Pro users when its providers are available.",
      limitation: "Reports and citations still need review.",
    },
    attachments: {
      label: "Files",
      availability: "limited",
      minimumTier: "free",
      summary:
        "Chat accepts text, code, CSV, JSON, and image attachments. Project knowledge indexes supported text-like files.",
      limitation: "PDF, Word, PowerPoint, and Excel extraction is not currently supported.",
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
      availability: "unavailable",
      summary: "Editing an uploaded or generated image is not currently available.",
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
      availability: "excluded",
      summary: "Voice is intentionally outside KovaGPT's current product scope.",
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
      description: "Higher published allowances, High mode, Deep Research, and Adaptive Memory.",
      features: planFeatures("plus"),
    },
    pro: {
      tier: "pro",
      name: PLAN_LABELS.pro,
      monthlyPriceUsd: 89,
      lookupKey: BILLING_PLANS.pro_monthly.lookupKey,
      trialPeriodDays: BILLING_PLANS.pro_monthly.trialPeriodDays,
      description: "The highest published allowances and Pro-only reasoning modes.",
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
      "Requirements and security review",
      "Custom commercial terms where available",
      "Deployment and support scope confirmed before purchase",
    ],
  },
} satisfies CapabilityRegistry);
