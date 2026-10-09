import { DEFAULT_THEME, type ThemeColors, type ThemeMode } from "./theme";

export type Mood = "neutral" | "friendly" | "professional" | "concise";

export type Settings = {
  displayName: string;
  email: string;
  extraFacts: string;
  customInstructions: string;
  mood: Mood;
  responseLength: "short" | "medium" | "long";
  rememberAcross: boolean;
  webSearch: boolean;
  sendOnEnter: boolean;
  mode: ThemeMode;
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
  rememberAcross: false,
  webSearch: true,
  sendOnEnter: true,
  mode: "dark",
  notifyEmail: true,
  notifyProduct: true,
  parentalMode: false,
  trainingOptOut: false,
  theme: DEFAULT_THEME,
};
