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
  let messageBoxOverride = null;
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
        if (messageBoxOverride) return messageBoxOverride(options);
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
      setMessageBox(handler) {
        messageBoxOverride = handler;
      },
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
      "preview",
      undefined,
      "example.ts",
      "const original = false;\n",
      original.hash,
    );
    assert.equal(preview.changed, true);
    const rejected = await call(
      "save",
      undefined,
      "example.ts",
      "const original = false;\n",
      original.hash,
    );
    assert.equal(rejected.saved, false);
    assert.equal(readFileSync(join(project, "example.ts"), "utf8"), original.content);
    assert.equal(prompts.at(-1).title, "Save changes to local file?");
    enableSave();
    const saved = await call(
      "save",
      undefined,
      "example.ts",
      "const original = false;\n",
      original.hash,
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

test("terminal cannot execute before folder selection, without consent or from a remote frame", async () => {
  await harness(async ({ call, project, prompts, enableSave, window }) => {
    await assert.rejects(
      () => call("runCommand", undefined, "echo denied"),
      /Choose a repository/u,
    );
    await call("choose");
    const denied = await call("runCommand", undefined, "echo local");
    assert.deepEqual(denied, { started: false });
    assert.deepEqual(await call("commandHistory"), []);
    assert.equal(prompts.at(-1).message, "echo local");
    assert.ok(prompts.at(-1).detail.includes(project));
    for (const channel of [
      "runCommand",
      "git",
      "commandHistory",
      "cancelCommand",
      "clearCommandHistory",
    ])
      await assert.rejects(
        () =>
          call(
            channel,
            { sender: window.webContents, senderFrame: { url: WORKSPACE_URL } },
            "echo no",
          ),
        /denied/u,
      );
    enableSave();
    const run = await call("runCommand", undefined, "echo allowed");
    assert.equal(run.started, true);
    for (let tries = 0; tries < 100; tries++) {
      const records = await call("commandHistory");
      if (records[0]?.finishedAt) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const records = await call("commandHistory");
    assert.match(records[0].output, /allowed/u);
    assert.equal(records[0].exitCode, 0);
    await call("closeFolder");
    assert.deepEqual(await call("commandHistory"), []);
  });
});

test("pending command approval cannot be reused after navigation or folder changes", async () => {
  await harness(async ({ call, setMessageBox, window }) => {
    await call("choose");
    let answer;
    setMessageBox(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const pending = call("runCommand", undefined, "echo must-not-run");
    await assert.rejects(() => call("choose"), /current action/u);
    await assert.rejects(() => call("closeFolder"), /current action/u);
    await assert.rejects(
      () => call("runCommand", undefined, "echo second"),
      /current local action/u,
    );
    window.webContents.mainFrame.url = "https://kovagpt.com/";
    answer({ response: 1 });
    assert.deepEqual(await pending, { started: false });
    window.webContents.mainFrame.url = WORKSPACE_URL;
    assert.deepEqual(await call("commandHistory"), []);
  });
});
