import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import * as policy from "../policy.mjs";

async function fixture(platform = "linux") {
  const app = new EventEmitter();
  Object.assign(app, {
    enableSandbox() {},
    setName() {},
    getVersion: () => "0.1.0",
    getAppPath: () => "/app",
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    setAppUserModelId() {},
    setAsDefaultProtocolClient() {},
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings() {},
    quit() {},
    isPackaged: true,
    getPath: () => "/tmp/kovagpt-tests",
  });
  const windows = [],
    external = [],
    prompts = [],
    menus = [],
    copiedImages = [],
    copiedTexts = [],
    trays = [],
    dockEvents = [];
  app.dock = {
    show: () => dockEvents.push("show"),
    hide: () => dockEvents.push("hide"),
  };
  class TestTray extends EventEmitter {
    constructor(icon) {
      super();
      this.icon = icon;
      this.destroyed = false;
      trays.push(this);
    }
    setToolTip(value) {
      this.tooltip = value;
    }
    setContextMenu(value) {
      this.menu = value;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  let permissions, checks;
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      windows.push(this);
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        getUserAgent: () => "Test",
        setUserAgent() {},
        getURL: () => this.url,
        setWindowOpenHandler: (handler) => {
          this.popup = handler;
        },
      });
    }
    getNormalBounds() {
      return { x: 0, y: 0, width: 1280, height: 850 };
    }
    isMaximized() {
      return false;
    }
    setBounds(bounds) {
      this.bounds = bounds;
    }
    loadURL(url) {
      this.url = url;
      return Promise.resolve();
    }
    isDestroyed() {
      return false;
    }
    isMinimized() {
      return false;
    }
    show() {}
    focus() {}
  }
  Window.getFocusedWindow = () => windows.at(-1);
  const source = readFileSync(new URL("../main.mjs", import.meta.url), "utf8")
    .replace(
      /^import \{[\s\S]*?\} from "electron";$/m,
      "const { app, BrowserWindow, WebContentsView, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, protocol, Menu, nativeImage, Tray, session, screen, shell, systemPreferences } = electron;",
    )
    .replace(
      /^import .* from "node:path";$/m,
      "const join = (...parts) => parts.join('/'); const basename = (path) => path.split('/').pop();",
    )
    .replace(
      /^import .* from "node:fs";$/m,
      "const readFileSync = (path) => { if (path === '/tmp/example.ts') return 'export const test = 42;'; throw new Error('No saved preferences'); }; const statSync = (path) => ({ isFile: () => path === '/tmp/example.ts', size: 23 }); const writeFileSync = () => {};",
    )
    .replace(
      /^import [\s\S]*?from "\.\/policy\.mjs";$/m,
      "const { KOVA_URL, isKovaUrl, isOpenAppLink, externalUrl, WEB_PREFERENCES, COMPANION_SHORTCUTS, defaultCompanionShortcut, validatedCompanionShortcut } = policy;",
    )
    .replace(
      /^import \{ installLocalWorkspace, registerWorkspaceScheme \} from "\.\/workspace-host\.mjs";$/m,
      "const registerWorkspaceScheme = () => {}; const installLocalWorkspace = () => () => {};",
    );
  const instrumented = source.replace(
    /^import \{ installBrowserWorkspace \} from "\.\/browser-host\.mjs";$/m,
    "const installBrowserWorkspace = () => () => {};",
  );
  vm.runInNewContext(instrumented, {
    policy,
    process: { platform, resourcesPath: "/app/resources" },
    URL,
    electron: {
      app,
      BrowserWindow: Window,
      screen: {
        on() {},
        getAllDisplays: () => [
          {
            id: 1,
            label: "Primary",
            size: { width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
          },
          {
            id: 2,
            label: "Secondary",
            size: { width: 1280, height: 1024 },
            workArea: { x: -1280, y: 0, width: 1280, height: 984 },
          },
        ],
      },
      protocol: {},
      ipcMain: {},
      Tray: TestTray,
      nativeImage: {
        createFromPath: () => ({
          resize() {
            return this;
          },
          isEmpty: () => false,
          setTemplateImage() {},
        }),
      },
      clipboard: {
        writeImage: (image) => copiedImages.push(image),
        writeText: (value) => copiedTexts.push(value),
      },
      desktopCapturer: {
        getSources: async () => [{ thumbnail: { isEmpty: () => false } }],
      },
      systemPreferences: { getMediaAccessStatus: () => "granted" },
      globalShortcut: {
        register: () => true,
        unregister() {},
        unregisterAll() {},
      },
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: ["/tmp/example.ts"] }),
        showMessageBox: async (_window, options) => {
          prompts.push(options);
          return { response: 1 };
        },
        showMessageBoxSync: (options) => {
          prompts.push(options);
          return 0;
        },
      },
      shell: {
        openExternal: async (url) => {
          external.push(url);
        },
      },
      session: {
        fromPartition: () => ({
          setPermissionCheckHandler: (handler) => {
            checks = handler;
          },
          setPermissionRequestHandler: (handler) => {
            permissions = handler;
          },
        }),
      },
      Menu: {
        setApplicationMenu: (value) => menus.push(value),
        buildFromTemplate: (value) => value,
      },
    },
  });
  await new Promise(setImmediate);
  return {
    window: windows[0],
    permissions,
    checks,
    external,
    prompts,
    app,
    windows,
    menus,
    copiedImages,
    copiedTexts,
    trays,
    dockEvents,
  };
}

test("native startup loads the real site into one sandboxed window", async () => {
  const f = await fixture();
  assert.equal(f.window.url, policy.KOVA_URL);
  assert.equal(f.window.options.webPreferences.sandbox, true);
  assert.equal(f.window.options.webPreferences.nodeIntegration, false);
  assert.equal(f.window.options.webPreferences.preload, undefined);
  f.app.emit("second-instance", {}, ["kovagpt://open"]);
  assert.equal(f.windows.length, 1);
});
test("window navigation never opens local protocols and external HTTPS requires a native choice", async () => {
  const f = await fixture();
  let prevented = 0;
  f.window.webContents.emit(
    "will-navigate",
    {
      preventDefault() {
        prevented++;
      },
    },
    "file:///private/file",
  );
  assert.equal(prevented, 1);
  assert.deepEqual(f.external, []);
  f.window.popup({ url: "javascript:alert(1)" });
  assert.deepEqual(f.external, []);
  const decision = f.window.popup({ url: "https://example.com/source" });
  assert.equal(decision.action, "deny");
  await new Promise(setImmediate);
  assert.deepEqual(f.external, ["https://example.com/source"]);
  assert.equal(f.prompts.length, 1);
});
test("permission requests reject other origins, subframes and unsupported powers", async () => {
  const f = await fixture();
  for (const [origin, permission, mainFrame] of [
    ["https://evil.test", "media", true],
    [policy.KOVA_URL, "media", false],
    [policy.KOVA_URL, "clipboard-read", true],
  ]) {
    let allowed;
    await f.permissions(
      f.window.webContents,
      permission,
      (value) => {
        allowed = value;
      },
      { requestingUrl: origin, isMainFrame: mainFrame },
    );
    assert.equal(allowed, false);
  }
  let allowed;
  await f.permissions(
    f.window.webContents,
    "media",
    (value) => {
      allowed = value;
    },
    { requestingUrl: policy.KOVA_URL, isMainFrame: true, mediaTypes: ["audio"] },
  );
  assert.equal(allowed, true);
  assert.equal(f.prompts.length, 1);
});

test("screen capture needs two native choices and only copies to clipboard", async () => {
  const f = await fixture();
  const companion = f.menus[0].find((item) => item.label === "Companion");
  const capture = companion.submenu.find((item) => item.label === "Copy screen to clipboard...");
  assert.ok(capture);
  assert.equal(f.copiedImages.length, 0);
  capture.click();
  await new Promise(setImmediate);
  assert.equal(f.prompts[0].title, "Copy a screen image?");
  assert.equal(f.prompts[1].title, "Choose screen");
  assert.equal(f.copiedImages.length, 1);
});

test("macOS menu bar and Dock preferences preserve a visible native entry point", async () => {
  const f = await fixture("darwin");
  const companion = () => f.menus.at(-1).find((item) => item.label === "Companion");
  const choice = (label) => companion().submenu.find((item) => item.label === label);
  assert.ok(choice("Show menu bar icon"));
  assert.ok(choice("Show Dock icon"));
  choice("Show menu bar icon").click({ checked: true });
  assert.equal(f.trays.length, 1);
  assert.equal(f.trays[0].tooltip, "KovaGPT");
  assert.equal(choice("Show menu bar icon").checked, true);
  choice("Show Dock icon").click({ checked: false });
  assert.deepEqual(f.dockEvents, ["hide"]);
  assert.equal(choice("Show Dock icon").checked, false);
  choice("Show menu bar icon").click({ checked: false });
  assert.equal(f.trays[0].destroyed, true);
  assert.deepEqual(f.dockEvents, ["hide", "show"]);
  assert.equal(choice("Show Dock icon").checked, true);
  choice("Show Dock icon").click({ checked: false });
  assert.equal(f.prompts.at(-1).title, "Keep an app entry point");
  assert.deepEqual(f.dockEvents, ["hide", "show"]);
});

test("desktop debugging is available through an explicit native menu, not a web bridge", async () => {
  const f = await fixture();
  const developer = f.menus[0].find((item) => item.label === "Developer");
  assert.ok(developer);
  assert.equal(developer.submenu.length, 1);
  assert.equal(developer.submenu[0].label, "Toggle Developer Tools");
  assert.equal(developer.submenu[0].role, "toggleDevTools");
  assert.equal(developer.submenu[0].accelerator, "CommandOrControl+Alt+I");
  assert.equal(f.window.options.webPreferences.preload, undefined);
  assert.equal(f.window.options.webPreferences.nodeIntegration, false);
});

test("desktop File menu opens separate sandboxed Kova windows with scoped permissions", async () => {
  const f = await fixture();
  const file = f.menus[0].find((item) => item.label === "File");
  const newWindow = file?.submenu.find((item) => item.label === "New Window");
  assert.equal(newWindow?.accelerator, "CommandOrControl+N");
  assert.equal(f.windows.length, 1);
  newWindow.click();
  assert.equal(f.windows.length, 2);
  const second = f.windows[1];
  assert.notEqual(second, f.window);
  assert.equal(second.url, policy.KOVA_URL);
  assert.equal(second.options.webPreferences.sandbox, true);
  assert.equal(second.options.webPreferences.preload, undefined);
  assert.equal(second.options.webPreferences.nodeIntegration, false);
  assert.equal(f.checks(second.webContents, "media", policy.KOVA_URL), true);
  let permission;
  await f.permissions(
    second.webContents,
    "media",
    (value) => {
      permission = value;
    },
    { requestingUrl: policy.KOVA_URL, isMainFrame: true, mediaTypes: ["audio"] },
  );
  assert.equal(permission, true);
  assert.equal(f.prompts.at(-1).title, "KovaGPT permission");
});

test("additional native windows still reject local protocols and confirm offsite HTTPS", async () => {
  const f = await fixture();
  f.menus[0].find((item) => item.label === "File").submenu[0].click();
  const second = f.windows[1];
  let prevented = 0;
  second.webContents.emit(
    "will-navigate",
    {
      preventDefault() {
        prevented += 1;
      },
    },
    "file:///etc/passwd",
  );
  assert.equal(prevented, 1);
  assert.deepEqual(f.external, []);
  const answer = second.popup({ url: "https://example.com/help" });
  assert.equal(answer.action, "deny");
  await new Promise(setImmediate);
  assert.deepEqual(f.external, ["https://example.com/help"]);
  assert.equal(f.prompts.at(-1).title, "Open in your browser?");
});

test("local-source import requires a chosen file and a second native clipboard choice", async () => {
  const f = await fixture();
  const file = f.menus[0].find((item) => item.label === "File");
  const copy = file.submenu.find((item) => item.label === "Copy local source file...");
  assert.ok(copy);
  assert.equal(f.copiedTexts.length, 0);
  copy.click();
  await new Promise(setImmediate);
  assert.equal(f.prompts.at(-1).title, "Copy this local file?");
  assert.equal(f.copiedTexts.length, 1);
  assert.equal(f.copiedTexts[0], "export const test = 42;");
  assert.equal(f.window.options.webPreferences.preload, undefined);
  assert.equal(f.window.options.webPreferences.nodeIntegration, false);
});

test("native display menu moves the focused app window into the selected screen work area", async () => {
  const f = await fixture();
  const menu = f.menus.at(-1).find((item) => item.label === "Displays");
  assert.equal(menu.submenu.length, 2);
  menu.submenu[1].click();
  assert.deepEqual(JSON.parse(JSON.stringify(f.windows.at(-1).bounds)), {
    x: -1280,
    y: 67,
    width: 1280,
    height: 850,
  });
});
