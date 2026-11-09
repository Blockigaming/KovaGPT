import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import {
  BROWSER_CHROME_URL,
  browserDestination,
  installBrowserWorkspace,
} from "../browser-host.mjs";

function fixture() {
  const handlers = new Map();
  const profiles = new Map();
  const views = [];
  const copied = [];
  const prompts = [];
  let response = 0;
  let promptOverride;
  let owner;
  class Contents extends EventEmitter {
    constructor() {
      super();
      this.url = "";
      this.title = "Example title";
      this.destroyed = false;
      this.mainFrame = { url: BROWSER_CHROME_URL };
      this.navigationHistory = {
        canGoBack: () => true,
        canGoForward: () => false,
        goBack: () => {
          this.wentBack = true;
        },
        goForward() {},
      };
    }
    setWindowOpenHandler(handler) {
      this.popup = handler;
    }
    loadURL(url) {
      this.url = url;
      return Promise.resolve();
    }
    getTitle() {
      return this.title;
    }
    getURL() {
      return this.url;
    }
    isLoading() {
      return false;
    }
    isDestroyed() {
      return this.destroyed;
    }
    close() {
      this.destroyed = true;
    }
    reload() {
      this.reloaded = true;
    }
    async executeJavaScript(script) {
      this.script = script;
      return "Explicitly selected text";
    }
  }
  class Window extends EventEmitter {
    constructor(options) {
      super();
      owner = this;
      this.options = options;
      this.webContents = new Contents();
      this.destroyed = false;
      this.children = new Set();
      this.contentView = {
        addChildView: (view) => this.children.add(view),
        removeChildView: (view) => this.children.delete(view),
      };
    }
    isDestroyed() {
      return this.destroyed;
    }
    getContentSize() {
      return [1200, 800];
    }
    async loadURL(url) {
      this.url = url;
    }
    show() {}
    focus() {}
  }
  class View {
    constructor(options) {
      this.options = options;
      this.webContents = new Contents();
      views.push(this);
    }
    setBounds(bounds) {
      this.bounds = bounds;
    }
  }
  const open = installBrowserWorkspace({
    BrowserWindow: Window,
    WebContentsView: View,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    session: {
      fromPartition(name) {
        if (!profiles.has(name)) {
          const profile = new EventEmitter();
          profile.protocol = {
            handle: (_scheme, handler) => {
              profile.serve = handler;
            },
          };
          profile.setPermissionCheckHandler = (check) => {
            profile.check = check;
          };
          profile.setPermissionRequestHandler = (request) => {
            profile.request = request;
          };
          profiles.set(name, profile);
        }
        return profiles.get(name);
      },
    },
    dialog: {
      showMessageBox: async (_window, options) => {
        prompts.push(options);
        return promptOverride ? promptOverride(options) : { response };
      },
    },
    clipboard: { writeText: (text) => copied.push(text) },
    assetsPath: fileURLToPath(new URL("..", import.meta.url)),
    iconPath: "/icon.png",
  });
  const window = open();
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return {
    window,
    views,
    profiles,
    copied,
    prompts,
    event,
    open,
    call: (name, ...args) => handlers.get("kova-browser:" + name)(event, ...args),
    forged: (name) =>
      handlers.get("kova-browser:" + name)({
        sender: views[0].webContents,
        senderFrame: views[0].webContents.mainFrame,
      }),
    approve: (value) => {
      response = value;
    },
    deferPrompt: (handler) => {
      promptOverride = handler;
    },
  };
}

test("browser navigation accepts HTTPS and rejects files, commands and credential URLs", () => {
  assert.equal(browserDestination("https://example.com/path"), "https://example.com/path");
  for (const value of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hello",
    "http://example.com",
    "https://user:pass@example.com",
    {},
    "https://example.com/" + "x".repeat(8192),
  ])
    assert.equal(browserDestination(value), null);
});

test("local browser chrome and remote pages have distinct profiles and only local chrome has a preload", () => {
  const f = fixture();
  assert.equal(f.window.url, BROWSER_CHROME_URL);
  assert.equal(f.window.options.webPreferences.partition, "persist:kova-browser-chrome");
  assert.match(f.window.options.webPreferences.preload, /browser-preload.cjs$/u);
  const remote = f.views[0].options.webPreferences;
  assert.equal(remote.preload, undefined);
  assert.equal(remote.partition, "persist:kova-browser-pages");
  assert.equal(remote.nodeIntegration, false);
  assert.equal(remote.contextIsolation, true);
  assert.equal(remote.sandbox, true);
  assert.deepEqual(f.views[0].bounds, { x: 0, y: 128, width: 1200, height: 672 });
  for (const profile of f.profiles.values()) assert.equal(profile.check(), false);
  for (const name of [
    "state",
    "newTab",
    "navigate",
    "back",
    "forward",
    "reload",
    "copyContext",
    "close",
    "select",
  ])
    assert.throws(() => f.forged(name), /denied/u);
});

test("tabs select, navigate, go back and close with a strict tab bound", () => {
  const f = fixture();
  const first = f.call("state").active;
  const second = f.call("newTab", "https://example.com/").id;
  assert.equal(f.window.children.size, 1);
  assert.equal(f.call("state").active, second);
  f.call("select", first);
  f.call("navigate", "https://example.org/path");
  assert.equal(f.views[0].webContents.getURL(), "https://example.org/path");
  f.call("back");
  assert.equal(f.views[0].webContents.wentBack, true);
  f.call("reload");
  assert.equal(f.views[0].webContents.reloaded, true);
  f.call("close", first);
  assert.equal(f.views[0].webContents.destroyed, true);
  assert.equal(f.call("state").active, second);
  for (let i = 1; i < 8; i++) f.call("newTab", "https://example.com/");
  assert.throws(() => f.call("newTab", "https://example.com/"), /8 maximum/u);
  assert.throws(() => f.call("navigate", "file:///private"), /HTTPS/u);
});

test("remote navigation/redirects, popups and automatic downloads cannot bypass browser policy", async () => {
  const f = fixture();
  let blocked = 0;
  const event = {
    preventDefault() {
      blocked++;
    },
  };
  f.views[0].webContents.emit("will-navigate", event, "file:///private");
  f.views[0].webContents.emit("will-redirect", event, "http://example.com");
  f.views[0].webContents.emit("will-attach-webview", event);
  f.profiles.get("persist:kova-browser-pages").emit("will-download", event);
  assert.equal(blocked, 4);
  const count = f.views.length;
  assert.equal(f.views[0].webContents.popup({ url: "https://example.com/popup" }).action, "deny");
  await Promise.resolve();
  assert.equal(f.views.length, count);
  f.approve(1);
  f.views[0].webContents.popup({ url: "https://example.com/popup" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.views.length, count + 1);
  assert.equal(f.prompts.at(-1).title, "Open browser tab?");
});

test("copying tab context needs native consent and never reads selection for title-only choices", async () => {
  const f = fixture();
  assert.deepEqual(await f.call("copyContext"), { copied: false });
  assert.deepEqual(f.copied, []);
  f.approve(1);
  assert.deepEqual(await f.call("copyContext"), { copied: true });
  assert.equal(f.views[0].webContents.script, undefined);
  assert.equal(f.copied.at(-1), "Example title\nhttps://kovagpt.com/");
  f.approve(2);
  await f.call("copyContext");
  assert.match(f.copied.at(-1), /Explicitly selected text/u);
  assert.equal(
    f.views[0].webContents.script,
    "window.getSelection()?.toString().slice(0, 16000) || ''",
  );
});

test("tab switching or navigation invalidates a pending context-copy approval", async () => {
  const f = fixture();
  let answer;
  f.deferPrompt(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const pending = f.call("copyContext");
  f.call("navigate", "https://example.com/other");
  answer({ response: 2 });
  assert.deepEqual(await pending, { copied: false });
  assert.deepEqual(f.copied, []);
  const pendingTab = f.call("copyContext");
  f.call("newTab", "https://example.org/");
  answer({ response: 2 });
  assert.deepEqual(await pendingTab, { copied: false });
});

test("browser assets are restricted and closing the window destroys every remote tab", async () => {
  const f = fixture();
  const serve = f.profiles.get("persist:kova-browser-chrome").serve;
  assert.equal((await serve({ url: BROWSER_CHROME_URL })).status, 200);
  assert.equal((await serve({ url: "kova-local://browser/private.txt" })).status, 404);
  const page = await serve({ url: BROWSER_CHROME_URL });
  assert.match(page.headers.get("Content-Security-Policy"), /connect-src 'none'/u);
  f.call("newTab", "https://example.com/");
  f.window.destroyed = true;
  f.window.emit("closed");
  assert.ok(f.views.every((view) => view.webContents.isDestroyed()));
  const reopened = f.open();
  assert.notEqual(reopened, f.window);
});
