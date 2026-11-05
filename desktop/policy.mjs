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
