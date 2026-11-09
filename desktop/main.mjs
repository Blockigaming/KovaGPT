import { app, BrowserWindow, dialog, globalShortcut, Menu, session, shell } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  KOVA_URL,
  isKovaUrl,
  isOpenAppLink,
  externalUrl,
  WEB_PREFERENCES,
  COMPANION_SHORTCUTS,
  defaultCompanionShortcut,
  validatedCompanionShortcut,
} from "./policy.mjs";

// The remote page gets no preload, IPC bridge, filesystem, shell, or Node access.
app.enableSandbox();
app.setName("KovaGPT");
let mainWindow = null;
let companionWindow = null;
let ready = false;
let selectedCompanionShortcut = defaultCompanionShortcut(process.platform);
let registeredCompanionShortcut = null;
const preferencesPath = () => join(app.getPath("userData"), "desktop-preferences.json");
function loadCompanionShortcut() {
  try {
    const saved = JSON.parse(readFileSync(preferencesPath(), "utf8"));
    return validatedCompanionShortcut(saved?.companionShortcut, process.platform);
  } catch {
    return defaultCompanionShortcut(process.platform);
  }
}
function saveCompanionShortcut(value) {
  try {
    writeFileSync(preferencesPath(), JSON.stringify({ companionShortcut: value }) + "\n", {
      mode: 0o600,
    });
    return true;
  } catch {
    return false;
  }
}

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

const openCompanion = () => {
  if (!ready) return;
  if (!companionWindow || companionWindow.isDestroyed()) createWindow(true);
  else {
    if (companionWindow.isMinimized()) companionWindow.restore();
    companionWindow.show();
    companionWindow.focus();
  }
};
function registerCompanionShortcut(shortcut) {
  if (shortcut !== "Disabled" && shortcut !== registeredCompanionShortcut) {
    if (!globalShortcut.register(shortcut, openCompanion)) return false;
  }
  if (registeredCompanionShortcut && registeredCompanionShortcut !== shortcut)
    globalShortcut.unregister(registeredCompanionShortcut);
  registeredCompanionShortcut = shortcut === "Disabled" ? null : shortcut;
  selectedCompanionShortcut = shortcut;
  return true;
}
function updateCompanionShortcut(shortcut) {
  if (!COMPANION_SHORTCUTS.includes(shortcut)) return;
  if (!registerCompanionShortcut(shortcut)) {
    dialog.showMessageBoxSync({
      type: "warning",
      title: "Shortcut unavailable",
      message: "The operating system or another app is using that shortcut.",
      detail: "Your previous shortcut remains active. Select a different option.",
      buttons: ["OK"],
    });
    installAppMenu();
    return;
  }
  if (!saveCompanionShortcut(shortcut))
    dialog.showMessageBoxSync({
      type: "warning",
      title: "Shortcut not saved",
      message: "The shortcut works now, but its preference could not be saved.",
      buttons: ["OK"],
    });
  installAppMenu();
}
function installAppMenu() {
  const shortcutItems = COMPANION_SHORTCUTS.map((value) => ({
    label:
      value === "Alt+Space" && process.platform === "darwin" ? "Option+Space" : value,
    type: "radio",
    checked: selectedCompanionShortcut === value,
    click: () => updateCompanionShortcut(value),
  }));
  const launchSetting =
    process.platform === "darwin" || process.platform === "win32"
      ? [{
          label: "Launch at login",
          type: "checkbox",
          enabled: app.isPackaged,
          checked: app.isPackaged && app.getLoginItemSettings().openAtLogin,
          click: (item) => {
            try {
              app.setLoginItemSettings({ openAtLogin: item.checked });
              if (app.getLoginItemSettings().openAtLogin !== item.checked)
                throw new Error("OS refused preference");
            } catch {
              item.checked = !item.checked;
              dialog.showMessageBoxSync({
                type: "warning",
                title: "Launch preference unchanged",
                message: "This system did not allow the launch-at-login change.",
                buttons: ["OK"],
              });
            }
          },
        }]
      : [];
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      { label: "Companion", submenu: [
        { label: "Open Companion Window", click: openCompanion },
        { label: "Keyboard shortcut", submenu: shortcutItems },
        ...launchSetting,
      ] },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

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
function createWindow(companion = false) {
  const window = new BrowserWindow({
    title: companion ? "KovaGPT Companion" : "KovaGPT",
    width: companion ? 540 : 1280,
    height: companion ? 640 : 850,
    minWidth: companion ? 420 : 640,
    minHeight: 480,
    alwaysOnTop: companion,
    backgroundColor: "#202020",
    autoHideMenuBar: true,
    icon: join(process.resourcesPath, "kova-logo.png"),
    webPreferences: { ...WEB_PREFERENCES },
  });
  if (companion) companionWindow = window;
  else mainWindow = window;
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
    if (companionWindow === window) companionWindow = null;
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
        (contents === mainWindow?.webContents ||
          contents === companionWindow?.webContents) &&
        isKovaUrl(origin) &&
        ["media", "notifications"].includes(permission),
    );
    appSession.setPermissionRequestHandler(async (contents, permission, callback, details) => {
      if (
        (contents !== mainWindow?.webContents &&
          contents !== companionWindow?.webContents) ||
        !isKovaUrl(contents.getURL()) ||
        !isKovaUrl(details.requestingUrl) ||
        details.isMainFrame !== true ||
        !["media", "notifications"].includes(permission)
      )
        return callback(false);
      const target = contents === companionWindow?.webContents ? companionWindow : mainWindow;
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
          (mainWindow === target || companionWindow === target) &&
          !target.isDestroyed() &&
          isKovaUrl(contents.getURL()),
      );
    });
    selectedCompanionShortcut = loadCompanionShortcut();
    if (!registerCompanionShortcut(selectedCompanionShortcut) &&
        !registerCompanionShortcut("CommandOrControl+Shift+Space"))
      registerCompanionShortcut("Disabled");
    installAppMenu();
    createWindow();
  });
  app.on("activate", openApp);
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
