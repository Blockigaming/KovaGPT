import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import * as policy from "../policy.mjs";

async function fixture() {
  const app = new EventEmitter();
  Object.assign(app, {
    enableSandbox() {},
    setName() {},
    getVersion: () => "0.1.0",
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    setAppUserModelId() {},
    setAsDefaultProtocolClient() {},
    quit() {},
    isPackaged: true,
    getPath: () => "/tmp/kovagpt-tests",
  });
  const windows = [],
    external = [],
    prompts = [],
    menus = [],
    copiedImages = [];
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
  const source = readFileSync(new URL("../main.mjs", import.meta.url), "utf8")
    .replace(
      /^import \{[\s\S]*?\} from "electron";$/m,
      "const { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, Menu, session, shell, systemPreferences } = electron;",
    )
    .replace(/^import .* from "node:path";$/m, "const join = (...parts) => parts.join('/');")
    .replace(
      /^import .* from "node:fs";$/m,
      "const readFileSync = () => { throw new Error('No saved preferences'); }; const writeFileSync = () => {};",
    )
    .replace(
      /^import [\s\S]*?from "\.\/policy\.mjs";$/m,
      "const { KOVA_URL, isKovaUrl, isOpenAppLink, externalUrl, WEB_PREFERENCES, COMPANION_SHORTCUTS, defaultCompanionShortcut, validatedCompanionShortcut } = policy;",
    );
  vm.runInNewContext(source, {
    policy,
    process: { platform: "linux", resourcesPath: "/app/resources" },
    URL,
    electron: {
      app,
      BrowserWindow: Window,
      clipboard: { writeImage: (image) => copiedImages.push(image) },
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
        showMessageBox: async (_window, options) => {
          prompts.push(options);
          return { response: 1 };
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
      Menu: { setApplicationMenu: (value) => menus.push(value), buildFromTemplate: (value) => value },
    },
  });
  await new Promise(setImmediate);
  return { window: windows[0], permissions, checks, external, prompts, app, windows, menus, copiedImages };
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
