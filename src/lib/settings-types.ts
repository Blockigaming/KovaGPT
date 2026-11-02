// Lightweight persisted settings and navigation contract. Import this module
// from startup/runtime code so the settings UI can remain lazy.
import { DEFAULT_THEME, type ThemeColors, type ThemeMode } from "@/lib/theme";
import type { TimeFormatPreference } from "@/lib/time-format";
import { APPEARANCE_DEFAULTS } from "@/lib/appearance-preferences.mjs";

export type Mood = "neutral" | "friendly" | "professional" | "concise";

export type Settings = {
  displayName: string;
  email: string;
  extraFacts: string;
  customInstructions: string;
  mood: Mood;
  responseLength: "short" | "medium" | "long";
  responseFormat: "automatic" | "plain" | "markdown";
  responseTone: "direct" | "formal" | "conversational";
  readingSize: 16 | 18 | 20;
  readingWidth: 680 | 760 | 900;
  density: "comfortable" | "compact";
  motion: "full" | "reduced";
  rememberAcross: boolean;
  automaticMemory?: boolean;
  webSearch: boolean;
  sendOnEnter: boolean;
  mode: ThemeMode;
  timeFormat: TimeFormatPreference;
  // Notifications
  notifyEmail?: boolean;
  notifyProduct?: boolean;
  // Parental controls
  parentalMode?: boolean;
  // Deprecated local-only value retained so old device exports still import safely.
  // It is not exposed as an account- or provider-level training control.
  trainingOptOut?: boolean;
  // deprecated fields kept so old localStorage payloads still load
  preferredPronouns?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  language?: string;
  showTimestamps?: boolean;
  theme?: ThemeColors;
};

export const DEFAULT_SETTINGS: Settings = {
  displayName: "",
  email: "",
  extraFacts: "",
  customInstructions: "",
  mood: "neutral",
  responseLength: "medium",
  responseFormat: "automatic",
  responseTone: "direct",
  ...APPEARANCE_DEFAULTS,
  timeFormat: "system",
  rememberAcross: false,
  automaticMemory: false,
  webSearch: true,
  sendOnEnter: true,
  notifyEmail: true,
  notifyProduct: false,
  parentalMode: false,
  trainingOptOut: false,
  theme: DEFAULT_THEME,
};

export const SETTINGS_SECTIONS = {
  profile: "personalization",
  appearance: "appearance",
  responses: "general",
  notifications: "notifications",
  connections: "linked",
  "cloud-browser": "cloud-browser",
  privacy: "data",
  usage: "usage",
  billing: "billing",
  memory: "memory",
  security: "security",
  storage: "storage",
  shortcuts: "shortcuts",
  email: "email",
  parental: "parental",
  report: "report",
  help: "help",
  about: "about",
  location: "location",
  family: "family",
  logout: "logout",
} as const;
export function settingsSectionForTab(tab?: string) {
  return Object.entries(SETTINGS_SECTIONS).find(([, value]) => value === tab)?.[0] ?? "profile";
}
