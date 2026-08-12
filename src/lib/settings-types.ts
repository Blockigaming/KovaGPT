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
  notifyEmail?: boolean;
  notifyProduct?: boolean;
  parentalMode?: boolean;
  trainingOptOut?: boolean;
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
  mode: "system",
  notifyEmail: true,
  notifyProduct: true,
  parentalMode: false,
  trainingOptOut: false,
  theme: DEFAULT_THEME,
};
