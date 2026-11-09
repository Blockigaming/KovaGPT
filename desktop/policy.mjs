export const KOVA_URL = "https://kovagpt.com/";
export function isKovaUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://kovagpt.com" && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function isOpenAppLink(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "kovagpt:" &&
      url.hostname === "open" &&
      ["", "/"].includes(url.pathname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export function externalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export const WEB_PREFERENCES = Object.freeze({
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  navigateOnDragDrop: false,
  partition: "persist:kovagpt",
});

/** Only fixed, reviewed global accelerators can be saved. */
export const COMPANION_SHORTCUTS = Object.freeze([
  "Alt+Space",
  "CommandOrControl+Shift+Space",
  "CommandOrControl+Shift+K",
  "Disabled",
]);
export function defaultCompanionShortcut(platform) {
  return platform === "darwin" || platform === "win32"
    ? "Alt+Space"
    : "CommandOrControl+Shift+Space";
}
export function validatedCompanionShortcut(value, platform) {
  return typeof value === "string" && COMPANION_SHORTCUTS.includes(value)
    ? value
    : defaultCompanionShortcut(platform);
}
