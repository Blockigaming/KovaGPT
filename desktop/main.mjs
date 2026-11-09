import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  Tray,
  session,
  shell,
  systemPreferences,
} from "electron";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
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
const extraWindows = new Set();
let ready = false;
let selectedCompanionShortcut = defaultCompanionShortcut(process.platform);
let registeredCompanionShortcut = null;
let menuBarTray = null;
let showMenuBarIcon = false;
let showDockIcon = true;
const preferencesPath = () => join(app.getPath("userData"), "desktop-preferences.json");
function readDesktopPreferences() {
  try {
    const saved = JSON.parse(readFileSync(preferencesPath(), "utf8"));
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}
function loadCompanionShortcut() {
  return validatedCompanionShortcut(readDesktopPreferences().companionShortcut, process.platform);
}
function persistDesktopPreferences(updates) {
  try {
    const current = readDesktopPreferences();
    writeFileSync(
      preferencesPath(),
      JSON.stringify({
        companionShortcut: validatedCompanionShortcut(current.companionShortcut, process.platform),
        showMenuBarIcon: current.showMenuBarIcon === true,
        showDockIcon: current.showDockIcon !== false,
        ...updates,
      }) + "\n",
      { mode: 0o600 },
    );
    return true;
  } catch {
    return false;
  }
}
function saveCompanionShortcut(value) {
  return persistDesktopPreferences({ companionShortcut: value });
}

const ownedWindowFor = (contents) => {
  if (contents === mainWindow?.webContents && !mainWindow.isDestroyed()) return mainWindow;
  if (contents === companionWindow?.webContents && !companionWindow.isDestroyed())
    return companionWindow;
  for (const window of extraWindows)
    if (!window.isDestroyed() && contents === window.webContents) return window;
  return null;
};
const confirmExternal = async (value, sourceWindow = mainWindow) => {
  const url = externalUrl(value);
  if (!url || !sourceWindow || sourceWindow.isDestroyed()) return;
  const result = await dialog.showMessageBox(sourceWindow, {
    type: "question",
    title: "Open in your browser?",
    message: `Open ${new URL(url).hostname} in your default browser?`,
    detail: url,
    buttons: ["Cancel", "Open browser"],
    defaultId: 0,
    cancelId: 0,
  });
  if (result.response === 1 && !sourceWindow.isDestroyed()) await shell.openExternal(url);
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
/** Access is limited to one explicitly selected local file, with no remote IPC bridge. */
async function copyLocalSourceFile() {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : companionWindow;
  if (!owner || owner.isDestroyed()) return;
  const selection = await dialog.showOpenDialog(owner, {
    title: "Choose a local source file",
    properties: ["openFile"],
    filters: [
      {
        name: "Source and text files",
        extensions: [
          "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "go", "rs", "java", "kt",
          "swift", "html", "css", "json", "md", "txt", "yml", "yaml", "sql",
        ],
      },
    ],
  });
  if (selection.canceled || selection.filePaths?.length !== 1 || owner.isDestroyed()) return;
  const filePath = selection.filePaths[0];
  try {
    const file = statSync(filePath);
    if (!file.isFile() || file.size === 0 || file.size > 256 * 1024)
      throw new Error("File must be a nonempty text file of at most 256 KiB");
    const source = readFileSync(filePath, "utf8");
    if (source.includes("\u0000")) throw new Error("Binary files are not supported");
    const answer = await dialog.showMessageBox(owner, {
      type: "question",
      title: "Copy this local file?",
      message: `Copy ${basename(filePath)} to your system clipboard?`,
      detail:
        "The selected file is not uploaded or sent by this action. Other apps may read clipboard contents until you replace them.",
      buttons: ["Cancel", "Copy file"],
      defaultId: 0,
      cancelId: 0,
    });
    if (answer.response === 1 && !owner.isDestroyed()) clipboard.writeText(source);
  } catch {
    if (!owner.isDestroyed())
      await dialog.showMessageBox(owner, {
        type: "warning",
        title: "Cannot copy file",
        message: "Choose a readable text file no larger than 256 KiB.",
        buttons: ["OK"],
      });
  }
}

/** Screen contents are copied only after two explicit native choices; never uploaded. */
async function copyScreenToClipboard() {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : companionWindow;
  if (!window || window.isDestroyed()) return;
  const confirmation = await dialog.showMessageBox(window, {
    type: "question",
    title: "Copy a screen image?",
    message: "Choose a screen to copy into your clipboard.",
    detail: "KovaGPT will not upload, send, or store the screenshot. You can paste it into chat.",
    buttons: ["Cancel", "Choose screen"],
    defaultId: 0,
    cancelId: 0,
  });
  if (confirmation.response !== 1) return;
  if (
    process.platform === "darwin" &&
    systemPreferences.getMediaAccessStatus("screen") !== "granted"
  ) {
    await dialog.showMessageBox(window, {
      type: "info",
      title: "Screen recording permission required",
      message:
        "Allow KovaGPT in System Settings > Privacy & Security > Screen & System Audio Recording.",
      buttons: ["OK"],
    });
    return;
  }
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    if (sources.length === 0) throw new Error("No screens available");
    const choice = await dialog.showMessageBox(window, {
      type: "question",
      title: "Choose screen",
      message: "Which screen should be copied?",
      buttons: ["Cancel", ...sources.map((_source, index) => `Screen ${index + 1}`)],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice.response < 1 || choice.response > sources.length) return;
    const image = sources[choice.response - 1].thumbnail;
    if (!image || image.isEmpty()) throw new Error("No image available");
    clipboard.writeImage(image);
  } catch {
    await dialog.showMessageBox(window, {
      type: "warning",
      title: "Screen capture unavailable",
      message: "No image was copied. Check your screen-sharing permissions and try again.",
      buttons: ["OK"],
    });
  }
}

/** The remote renderer has no bridge to the native macOS menu bar or Dock. */
function setMenuBarIcon(visible) {
  if (process.platform !== "darwin" || !ready) return false;
  if (!visible) {
    menuBarTray?.destroy();
    menuBarTray = null;
    showMenuBarIcon = false;
    return true;
  }
  if (menuBarTray) return true;
  try {
    const icon = nativeImage.createFromPath(join(process.resourcesPath, "kova-logo.png")).resize({
      width: 18,
      height: 18,
    });
    if (icon.isEmpty()) return false;
    icon.setTemplateImage(true);
    const tray = new Tray(icon);
    tray.setToolTip("KovaGPT");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open KovaGPT", click: openApp },
        { label: "Open Companion Window", click: openCompanion },
        { type: "separator" },
        { label: "Quit KovaGPT", click: () => app.quit() },
      ]),
    );
    tray.on("click", openApp);
    menuBarTray = tray;
    showMenuBarIcon = true;
    return true;
  } catch {
    return false;
  }
}
function setDockIcon(visible) {
  // Never hide both ways of reopening the installed app.
  if (process.platform !== "darwin" || !app.dock || (!visible && !showMenuBarIcon)) return false;
  if (visible) void app.dock.show();
  else app.dock.hide();
  showDockIcon = visible;
  return true;
}

function installAppMenu() {
  const shortcutItems = COMPANION_SHORTCUTS.map((value) => ({
    label: value === "Alt+Space" && process.platform === "darwin" ? "Option+Space" : value,
    type: "radio",
    checked: selectedCompanionShortcut === value,
    click: () => updateCompanionShortcut(value),
  }));
  const launchSetting =
    process.platform === "darwin" || process.platform === "win32"
      ? [
          {
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
          },
        ]
      : [];
  const macPlacement =
    process.platform === "darwin"
      ? [
          {
            label: "Show menu bar icon",
            type: "checkbox",
            checked: showMenuBarIcon,
            click: (item) => {
              if (!setMenuBarIcon(item.checked)) {
                dialog.showMessageBoxSync({
                  type: "warning",
                  title: "Menu bar setting unchanged",
                  message: "The KovaGPT app icon could not be loaded.",
                  buttons: ["OK"],
                });
                installAppMenu();
                return;
              }
              if (!showMenuBarIcon && !showDockIcon) setDockIcon(true);
              if (!persistDesktopPreferences({ showMenuBarIcon, showDockIcon }))
                dialog.showMessageBoxSync({
                  type: "warning",
                  title: "Preference not saved",
                  message: "The menu bar choice works now but could not be saved.",
                  buttons: ["OK"],
                });
              installAppMenu();
            },
          },
          {
            label: "Show Dock icon",
            type: "checkbox",
            checked: showDockIcon,
            click: (item) => {
              if (!setDockIcon(item.checked)) {
                dialog.showMessageBoxSync({
                  type: "warning",
                  title: "Keep an app entry point",
                  message: "Enable the menu bar icon before hiding KovaGPT from the Dock.",
                  buttons: ["OK"],
                });
                installAppMenu();
                return;
              }
              if (!persistDesktopPreferences({ showMenuBarIcon, showDockIcon }))
                dialog.showMessageBoxSync({
                  type: "warning",
                  title: "Preference not saved",
                  message: "The Dock choice works now but could not be saved.",
                  buttons: ["OK"],
                });
              installAppMenu();
            },
          },
        ]
      : [];
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      {
        label: "File",
        submenu: [
          {
            label: "New Window",
            accelerator: "CommandOrControl+N",
            click: () => createWindow(false, true),
          },
          { label: "Copy local source file...", click: () => void copyLocalSourceFile() },
          { role: "close" },
        ],
      },
      {
        label: "Companion",
        submenu: [
          { label: "Open Companion Window", click: openCompanion },
          { label: "Keyboard shortcut", submenu: shortcutItems },
          { label: "Copy screen to clipboard...", click: () => void copyScreenToClipboard() },
          ...launchSetting,
          ...macPlacement,
        ],
      },
      { role: "editMenu" },
      {
        label: "Developer",
        submenu: [
          // An explicit local menu action; no remote page receives an IPC or filesystem bridge.
          {
            label: "Toggle Developer Tools",
            role: "toggleDevTools",
            accelerator: "CommandOrControl+Alt+I",
          },
        ],
      },
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
function createWindow(companion = false, additional = false) {
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
  else if (additional) extraWindows.add(window);
  else mainWindow = window;
  window.webContents.setUserAgent(
    `${window.webContents.getUserAgent()} KovaGPTDesktop/${app.getVersion()}`,
  );
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event, url) => {
    if (isKovaUrl(url)) return;
    event.preventDefault();
    // A navigation needs a second explicit confirmation before leaving the app.
    void confirmExternal(url, window);
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isKovaUrl(url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isKovaUrl(url)) void window.loadURL(url).catch(() => {});
    else void confirmExternal(url, window);
    return { action: "deny" };
  });
  window.webContents.on("render-process-gone", () => {
    if (!window.isDestroyed()) void loadHome(window);
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    if (companionWindow === window) companionWindow = null;
    extraWindows.delete(window);
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
        Boolean(ownedWindowFor(contents)) &&
        isKovaUrl(origin) &&
        ["media", "notifications"].includes(permission),
    );
    appSession.setPermissionRequestHandler(async (contents, permission, callback, details) => {
      const target = ownedWindowFor(contents);
      if (
        !target ||
        !isKovaUrl(contents.getURL()) ||
        !isKovaUrl(details.requestingUrl) ||
        details.isMainFrame !== true ||
        !["media", "notifications"].includes(permission)
      )
        return callback(false);
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
          ownedWindowFor(contents) === target &&
          !target.isDestroyed() &&
          isKovaUrl(contents.getURL()),
      );
    });
    const savedDesktopPreferences = readDesktopPreferences();
    selectedCompanionShortcut = loadCompanionShortcut();
    if (
      !registerCompanionShortcut(selectedCompanionShortcut) &&
      !registerCompanionShortcut("CommandOrControl+Shift+Space")
    )
      registerCompanionShortcut("Disabled");
    if (process.platform === "darwin") {
      setMenuBarIcon(savedDesktopPreferences.showMenuBarIcon === true);
      if (savedDesktopPreferences.showDockIcon === false && showMenuBarIcon) setDockIcon(false);
    }
    installAppMenu();
    createWindow();
  });
  app.on("activate", openApp);
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    menuBarTray?.destroy();
    menuBarTray = null;
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
