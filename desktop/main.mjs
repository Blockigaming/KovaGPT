import { app, BrowserWindow, dialog, Menu, session, shell } from "electron";
import { join } from "node:path";
import { KOVA_URL, isKovaUrl, isOpenAppLink, externalUrl, WEB_PREFERENCES } from "./policy.mjs";

// The remote page gets no preload, IPC bridge, filesystem, shell, or Node access.
app.enableSandbox();
app.setName("KovaGPT");
let mainWindow = null;
let ready = false;
const confirmExternal = async (value) => {
  const url = externalUrl(value);
  if (!url || !mainWindow || mainWindow.isDestroyed()) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Open in your browser?",
    message: `Open ${new URL(url).hostname} in your default browser?`,
    detail: url,
    buttons: ["Cancel", "Open browser"],
    defaultId: 0,
    cancelId: 0,
  });
  if (result.response === 1) await shell.openExternal(url);
};
const openApp = () => {
  if (!ready) return;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
};
const loadHome = async (window) => {
  try {
    await window.loadURL(KOVA_URL);
  } catch {
    if (window.isDestroyed()) return;
    const { response } = await dialog.showMessageBox(window, {
      type: "warning",
      title: "Couldn't load KovaGPT",
      message: "Check your internet connection, then try again.",
      buttons: ["Try again", "Close"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) void loadHome(window);
    else window.close();
  }
};
function createWindow() {
  const window = new BrowserWindow({
    title: "KovaGPT",
    width: 1280,
    height: 850,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: "#202020",
    autoHideMenuBar: true,
    icon: join(process.resourcesPath, "kova-logo.png"),
    webPreferences: { ...WEB_PREFERENCES },
  });
  mainWindow = window;
  window.webContents.setUserAgent(
    `${window.webContents.getUserAgent()} KovaGPTDesktop/${app.getVersion()}`,
  );
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event, url) => {
    if (isKovaUrl(url)) return;
    event.preventDefault();
    // A navigation needs a second explicit confirmation before leaving the app.
    void confirmExternal(url);
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isKovaUrl(url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isKovaUrl(url)) void window.loadURL(url).catch(() => {});
    else void confirmExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("render-process-gone", () => {
    if (!window.isDestroyed()) void loadHome(window);
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  void loadHome(window);
  return window;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // Register before ready: macOS can deliver a protocol link while launching.
  app.on("open-url", (event, value) => {
    event.preventDefault();
    if (isOpenAppLink(value)) openApp();
  });
  app.on("second-instance", (_event, argv) => {
    if (argv.some(isOpenAppLink) || !argv.some((arg) => arg.startsWith("kovagpt:"))) openApp();
  });
  app.whenReady().then(() => {
    ready = true;
    app.setAppUserModelId("com.kovagpt.desktop");
    if (app.isPackaged) app.setAsDefaultProtocolClient("kovagpt");
    const appSession = session.fromPartition(WEB_PREFERENCES.partition);
    // Requests must come from Kova's main frame and still require a user choice.
    appSession.setPermissionCheckHandler(
      (contents, permission, origin) =>
        contents === mainWindow?.webContents &&
        isKovaUrl(origin) &&
        ["media", "notifications"].includes(permission),
    );
    appSession.setPermissionRequestHandler(async (contents, permission, callback, details) => {
      if (
        contents !== mainWindow?.webContents ||
        !isKovaUrl(contents.getURL()) ||
        !isKovaUrl(details.requestingUrl) ||
        details.isMainFrame !== true ||
        !["media", "notifications"].includes(permission)
      )
        return callback(false);
      const target = mainWindow;
      const { response } = await dialog.showMessageBox(target, {
        type: "question",
        title: "KovaGPT permission",
        message:
          permission === "media"
            ? `Allow access to your ${(details.mediaTypes || []).join(" and ") || "camera or microphone"}?`
            : "Allow KovaGPT to show notifications?",
        buttons: ["Don't allow", "Allow"],
        defaultId: 0,
        cancelId: 0,
      });
      callback(
        response === 1 &&
          mainWindow === target &&
          !target.isDestroyed() &&
          isKovaUrl(contents.getURL()),
      );
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
    createWindow();
  });
  app.on("activate", openApp);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
