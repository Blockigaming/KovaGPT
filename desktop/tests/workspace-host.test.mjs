import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WORKSPACE_URL,
  registerWorkspaceScheme,
  installLocalWorkspace,
} from "../workspace-host.mjs";

async function harness(action) {
  const root = mkdtempSync(join(tmpdir(), "kova-local-host-"));
  const project = join(root, "repo");
  mkdirSync(project);
  writeFileSync(join(project, "example.ts"), "const original = true;\n");
  const handlers = new Map();
  const staticHandlers = new Map();
  const prompts = [];
  let permissionCheck;
  let permissionRequest;
  let allowSave = false;
  const sessions = {
    fromPartition(partition) {
      assert.equal(partition, "persist:kova-local-workspace");
      return {
        protocol: {
          handle(name, handler) {
            staticHandlers.set(name, handler);
          },
        },
        setPermissionCheckHandler(handler) {
          permissionCheck = handler;
        },
        setPermissionRequestHandler(handler) {
          permissionRequest = handler;
        },
      };
    },
  };
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: WORKSPACE_URL };
      this.webContents.setWindowOpenHandler = (handler) => {
        this.openHandler = handler;
      };
    }
    async loadURL(url) {
      this.url = url;
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
  const open = installLocalWorkspace({
    BrowserWindow: FakeWindow,
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    },
    session: sessions,
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [project] }),
      showMessageBox: async (_window, options) => {
        prompts.push(options);
        return { response: allowSave ? 1 : 0 };
      },
    },
    assetsPath: fileURLToPath(new URL("..", import.meta.url)),
    iconPath: join(root, "icon.png"),
  });
  const window = open();
  const authorizedEvent = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
  const call = (channel, event = authorizedEvent, ...args) =>
    handlers.get("kova-workspace:" + channel)(event, ...args);
  try {
    return await action({
      root,
      project,
      window,
      call,
      handlers,
      staticHandlers,
      prompts,
      authorizedEvent,
      permissionCheck,
      permissionRequest,
      enableSave() {
        allowSave = true;
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("offline workspace window has an isolated profile, no Node, and no web navigation", async () => {
  await harness(async ({ window, permissionCheck, permissionRequest }) => {
    assert.equal(window.url, WORKSPACE_URL);
    assert.equal(window.options.webPreferences.contextIsolation, true);
    assert.equal(window.options.webPreferences.sandbox, true);
    assert.equal(window.options.webPreferences.nodeIntegration, false);
    assert.equal(window.options.webPreferences.partition, "persist:kova-local-workspace");
    assert.match(window.options.webPreferences.preload, /workspace-preload\.cjs$/u);
    assert.equal(window.openHandler({ url: "https://example.com" }).action, "deny");
    let blocked = 0;
    window.webContents.emit(
      "will-navigate",
      { preventDefault: () => blocked++ },
      "https://kovagpt.com/",
    );
    assert.equal(blocked, 1);
    assert.equal(permissionCheck(), false);
    let permitted;
    permissionRequest(null, "media", (value) => {
      permitted = value;
    });
    assert.equal(permitted, false);
  });
});

test("workspace IPC denies forged sender, subframe and remote renderer", async () => {
  await harness(async ({ call, authorizedEvent, window }) => {
    await assert.rejects(() => call("info", { sender: {} }), /denied/u);
    await assert.rejects(
      () => call("choose", { sender: window.webContents, senderFrame: { url: WORKSPACE_URL } }),
      /denied/u,
    );
    const original = window.webContents.mainFrame.url;
    window.webContents.mainFrame.url = "https://kovagpt.com/";
    await assert.rejects(() => call("info", authorizedEvent), /denied/u);
    window.webContents.mainFrame.url = original;
    assert.deepEqual(await call("info"), { name: null, selected: false });
  });
});

test("workspace assets never serve arbitrary files and forbid network connections", async () => {
  await harness(async ({ staticHandlers }) => {
    const handler = staticHandlers.get("kova-local");
    assert.ok(handler);
    const page = await handler({ url: WORKSPACE_URL });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("Content-Security-Policy"), /connect-src 'none'/u);
    assert.match(await page.text(), /Local Coding Workspace/u);
    for (const url of [
      "kova-local://outside/index.html",
      "kova-local://workspace/secrets.txt",
      "kova-local://workspace/index.html?token=1",
      "kova-local://workspace/../private",
    ]) {
      const response = await handler({ url });
      assert.equal(response.status, 404);
    }
  });
});

test("choosing repository, editing and saving require a local native confirmation", async () => {
  await harness(async ({ project, call, prompts, enableSave }) => {
    assert.deepEqual(await call("choose"), { name: "repo", selected: true });
    const files = await call("list", undefined, "");
    assert.equal(files[0].path, "example.ts");
    const original = await call("open", undefined, "example.ts");
    const preview = await call(
      "preview", undefined, "example.ts", "const original = false;\n", original.hash,
    );
    assert.equal(preview.changed, true);
    const rejected = await call(
      "save", undefined, "example.ts", "const original = false;\n", original.hash,
    );
    assert.equal(rejected.saved, false);
    assert.equal(readFileSync(join(project, "example.ts"), "utf8"), original.content);
    assert.equal(prompts.at(-1).title, "Save changes to local file?");
    enableSave();
    const saved = await call(
      "save", undefined, "example.ts", "const original = false;\n", original.hash,
    );
    assert.equal(saved.saved, true);
    assert.equal(readFileSync(join(project, "example.ts"), "utf8"), "const original = false;\n");
    await call("closeFolder");
    await assert.rejects(() => call("list", undefined, ""), /Choose a repository folder/u);
  });
});

test("workspace scheme registration is explicit and privileged only for offline UI", () => {
  let schemes;
  registerWorkspaceScheme({
    registerSchemesAsPrivileged(value) {
      schemes = value;
    },
  });
  assert.deepEqual(schemes, [
    {
      scheme: "kova-local",
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
});
