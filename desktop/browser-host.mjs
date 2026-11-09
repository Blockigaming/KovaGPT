import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const BROWSER_CHROME_URL = "kova-local://browser/index.html";
export const BROWSER_CHROME_HEIGHT = 128;
const MAX_TABS = 8;
const ASSETS = {
  "/index.html": ["browser.html", "text/html"],
  "/browser-ui.js": ["browser-ui.js", "text/javascript"],
};

export function browserDestination(value) {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Trusted local chrome and unprivileged remote pages never share a renderer or preload. */
export function installBrowserWorkspace({
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  dialog,
  clipboard,
  assetsPath,
  iconPath,
}) {
  const chromeSession = session.fromPartition("persist:kova-browser-chrome");
  const pageSession = session.fromPartition("persist:kova-browser-pages");
  let window = null;
  let active = null;
  const tabs = new Map();
  chromeSession.protocol.handle("kova-local", (request) => {
    const url = new URL(request.url);
    const asset = url.host === "browser" && !url.search && !url.hash && ASSETS[url.pathname];
    if (!asset) return new Response(null, { status: 404 });
    return new Response(readFileSync(join(assetsPath, asset[0])), {
      headers: {
        "Content-Type": asset[1] + "; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      },
    });
  });
  for (const profile of [chromeSession, pageSession]) {
    profile.setPermissionCheckHandler(() => false);
    profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  }
  // Downloads remain outside the review surface; do not silently write remote files to disk.
  pageSession.on("will-download", (event) => event.preventDefault());
  const trusted = (event) =>
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === BROWSER_CHROME_URL;
  const current = () => tabs.get(active);
  const layout = () => {
    const tab = current();
    if (!tab || !window || window.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    tab.view.setBounds({
      x: 0,
      y: BROWSER_CHROME_HEIGHT,
      width,
      height: Math.max(0, height - BROWSER_CHROME_HEIGHT),
    });
  };
  function select(id) {
    const tab = tabs.get(id);
    if (!tab) throw new Error("This browser tab is no longer open");
    const previous = current();
    if (previous) window.contentView.removeChildView(previous.view);
    active = id;
    window.contentView.addChildView(tab.view);
    layout();
  }
  function close(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    if (active === id) {
      window.contentView.removeChildView(tab.view);
      active = null;
    }
    tabs.delete(id);
    if (!tab.view.webContents.isDestroyed())
      tab.view.webContents.close({ waitForBeforeUnload: false });
    if (!active && tabs.size) select(tabs.keys().next().value);
  }
  function create(url) {
    const destination = browserDestination(url);
    if (!destination)
      throw new Error("Enter a full HTTPS website address without embedded credentials");
    if (tabs.size >= MAX_TABS) throw new Error("Close a tab before opening another (8 maximum)");
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        webviewTag: false,
        allowRunningInsecureContent: false,
        partition: "persist:kova-browser-pages",
      },
    });
    const id = randomUUID();
    const tab = { id, view, error: "" };
    tabs.set(id, tab);
    const contents = view.webContents;
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("will-navigate", (event, target) => {
      if (!browserDestination(target)) event.preventDefault();
    });
    contents.on("will-redirect", (event, target) => {
      if (!browserDestination(target)) event.preventDefault();
    });
    contents.on("did-fail-load", (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3)
        tab.error = "This website could not be loaded. Check its address and connection.";
    });
    contents.on("did-start-navigation", (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame) tab.error = "";
    });
    contents.setWindowOpenHandler(({ url: popup }) => {
      if (browserDestination(popup) && window && !window.isDestroyed()) {
        const owner = window;
        void dialog
          .showMessageBox(owner, {
            type: "question",
            title: "Open browser tab?",
            message: `Open ${new URL(popup).hostname} in a new browser tab?`,
            detail: popup,
            buttons: ["Cancel", "Open tab"],
            defaultId: 0,
            cancelId: 0,
          })
          .then(({ response }) => {
            if (
              response === 1 &&
              window === owner &&
              !owner.isDestroyed() &&
              tabs.has(id) &&
              tabs.size < MAX_TABS
            )
              create(popup);
          })
          .catch(() => {});
      }
      return { action: "deny" };
    });
    select(id);
    void contents.loadURL(destination).catch(() => {
      tab.error = "This website could not be loaded.";
    });
    return { id };
  }
  function handler(name, action) {
    ipcMain.handle("kova-browser:" + name, (event, ...args) => {
      if (!trusted(event)) throw new Error("Browser workspace request denied");
      return action(event, ...args);
    });
  }
  handler("state", () => ({
    active,
    tabs: [...tabs.values()].map((tab) => ({
      id: tab.id,
      title: tab.view.webContents.getTitle().slice(0, 160) || "Browser tab",
      url: tab.view.webContents.getURL(),
      loading: tab.view.webContents.isLoading(),
      error: tab.error,
      canGoBack: tab.view.webContents.navigationHistory.canGoBack(),
      canGoForward: tab.view.webContents.navigationHistory.canGoForward(),
    })),
  }));
  handler("newTab", (_event, url) => create(url));
  handler("select", (_event, id) => {
    select(id);
    return { selected: true };
  });
  handler("close", (_event, id) => {
    close(id);
    return { closed: true };
  });
  handler("navigate", (_event, url) => {
    const destination = browserDestination(url);
    if (!destination) throw new Error("Enter a full HTTPS address without embedded credentials");
    if (!current()) return create(destination);
    current().error = "";
    void current()
      .view.webContents.loadURL(destination)
      .catch(() => {});
    return { navigating: true };
  });
  handler("back", () => {
    const history = current()?.view.webContents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
  });
  handler("forward", () => {
    const history = current()?.view.webContents.navigationHistory;
    if (history?.canGoForward()) history.goForward();
  });
  handler("reload", () => current()?.view.webContents.reload());
  handler("copyContext", async (event) => {
    const tab = current();
    if (!tab) return { copied: false };
    const contents = tab.view.webContents;
    const url = contents.getURL();
    if (!browserDestination(url)) return { copied: false };
    const title = contents.getTitle().slice(0, 160);
    const answer = await dialog.showMessageBox(window, {
      type: "question",
      title: "Copy browser context?",
      message: "Copy this tab's title and address to your clipboard?",
      detail: `${title}\n${url}\n\nYou can also include text you selected on the page (up to 16,000 characters). Nothing is automatically sent to chat. Other apps can read your clipboard.`,
      buttons: ["Cancel", "Copy title and address", "Include selected text"],
      defaultId: 0,
      cancelId: 0,
    });
    if (
      !trusted(event) ||
      current() !== tab ||
      contents.isDestroyed() ||
      contents.getURL() !== url ||
      ![1, 2].includes(answer.response)
    )
      return { copied: false };
    let selection = "";
    if (answer.response === 2) {
      selection = await contents.executeJavaScript(
        "window.getSelection()?.toString().slice(0, 16000) || ''",
      );
      if (typeof selection !== "string") throw new Error("The selected text could not be read");
    }
    if (!trusted(event) || current() !== tab || contents.isDestroyed() || contents.getURL() !== url)
      return { copied: false };
    clipboard.writeText(`${title}\n${url}${selection ? "\n\n" + selection.slice(0, 16000) : ""}`);
    return { copied: true };
  });
  return function openBrowserWorkspace() {
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
      return window;
    }
    window = new BrowserWindow({
      title: "KovaGPT Browser",
      width: 1280,
      height: 850,
      minWidth: 720,
      minHeight: 480,
      backgroundColor: "#171717",
      icon: iconPath,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        webviewTag: false,
        allowRunningInsecureContent: false,
        partition: "persist:kova-browser-chrome",
        preload: join(assetsPath, "browser-preload.cjs"),
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== BROWSER_CHROME_URL) event.preventDefault();
    });
    window.webContents.on("will-redirect", (event) => event.preventDefault());
    window.on("resize", layout);
    window.on("closed", () => {
      for (const tab of tabs.values())
        if (!tab.view.webContents.isDestroyed())
          tab.view.webContents.close({ waitForBeforeUnload: false });
      tabs.clear();
      active = null;
      window = null;
    });
    void window.loadURL(BROWSER_CHROME_URL);
    create("https://kovagpt.com/");
    return window;
  };
}
