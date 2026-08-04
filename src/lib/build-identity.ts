const UNKNOWN_BUILD = "unknown";

export const BUILD_IDENTITY = Object.freeze({
  sha: import.meta.env.VITE_KOVA_BUILD_SHA || UNKNOWN_BUILD,
  builtAt: import.meta.env.VITE_KOVA_BUILD_TIME || UNKNOWN_BUILD,
  version: import.meta.env.VITE_KOVA_APP_VERSION || "0.0.0",
});
