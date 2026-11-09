// Executed by Electron itself, not Node. Every website request is served by this fixture.
import { app, BrowserWindow, WebContentsView, ipcMain, protocol, session } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { installBrowserWorkspace } from "../browser-host.mjs";
import { installLocalWorkspace, registerWorkspaceScheme } from "../workspace-host.mjs";

app.enableSandbox();
registerWorkspaceScheme(protocol);
const root = realpathSync(mkdtempSync(join(tmpdir(), "kova-electron-smoke-")));
app.setPath("userData", join(root, "profile"));
writeFileSync(join(root, "source.ts"), "const local = true;\n");
const deadline = setTimeout(() => {
  console.error("Electron runtime test timed out");
  app.exit(1);
}, 35_000);
const waitFor = async (read, predicate) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Electron runtime state did not settle");
};
app.whenReady().then(async () => {
  console.log("Electron ready; exercising native renderers");
  try {
    session
      .fromPartition("persist:kova-browser-pages")
      .protocol.handle(
        "https",
        () =>
          new Response(
            "<!doctype html><html><head><title>Local browser fixture</title></head><body>Fixture page only</body></html>",
            { headers: { "Content-Type": "text/html" } },
          ),
      );
    const prompts = [];
    const dialog = {
      showMessageBox: async (_window, options) => {
        prompts.push(options.title);
        return { response: 1 };
      },
      showOpenDialog: async () => ({ canceled: false, filePaths: [root] }),
    };
    const copied = [];
    const common = {
      BrowserWindow,
      ipcMain,
      session,
      dialog,
      assetsPath: app.getAppPath(),
      iconPath: "",
    };
    common.assetsPath = fileURLToPath(new URL("..", import.meta.url));
    const openBrowser = installBrowserWorkspace({
      ...common,
      WebContentsView,
      clipboard: { writeText: (text) => copied.push(text) },
    });
    const browser = openBrowser();
    await new Promise((resolve) => browser.webContents.once("did-finish-load", resolve));
    await waitFor(
      () => browser.webContents.executeJavaScript("typeof window.kovaBrowser"),
      (value) => value === "object",
    );
    console.log("Local browser toolbar loaded");
    const state = await waitFor(
      () => browser.webContents.executeJavaScript("window.kovaBrowser.state()"),
      (value) => value.tabs[0]?.title === "Local browser fixture",
    );
    assert.equal(state.tabs.length, 1);
    const remote = browser.contentView.children.find(
      (view) => view.webContents && view.webContents !== browser.webContents,
    ).webContents;
    assert.deepEqual(
      await remote.executeJavaScript(
        "[typeof window.kovaBrowser, typeof window.kovaWorkspace, typeof window.require, typeof window.process]",
      ),
      ["undefined", "undefined", "undefined", "undefined"],
    );
    await browser.webContents.executeJavaScript(
      "window.kovaBrowser.newTab('https://fixture.kovagpt.invalid/second')",
    );
    await waitFor(
      () => browser.webContents.executeJavaScript("window.kovaBrowser.state()"),
      (value) => value.tabs.length === 2 && value.tabs[1].title === "Local browser fixture",
    );
    await browser.webContents.executeJavaScript("window.kovaBrowser.copyContext()");
    assert.ok(copied[0].includes("https://fixture.kovagpt.invalid/second"));
    assert.ok(prompts.includes("Copy browser context?"));
    console.log("Remote browser bridge isolation passed");
    const openWorkspace = installLocalWorkspace({ ...common, protocol });
    const workspace = openWorkspace();
    await new Promise((resolve) => workspace.webContents.once("did-finish-load", resolve));
    await waitFor(
      () => workspace.webContents.executeJavaScript("typeof window.kovaWorkspace"),
      (value) => value === "object",
    );
    await workspace.webContents.executeJavaScript("window.kovaWorkspace.chooseFolder()");
    const file = await workspace.webContents.executeJavaScript(
      "window.kovaWorkspace.open('source.ts')",
    );
    assert.equal(file.content, "const local = true;\n");
    await workspace.webContents.executeJavaScript(
      "window.kovaWorkspace.runCommand('echo native-runtime-pass')",
    );
    const runs = await waitFor(
      () => workspace.webContents.executeJavaScript("window.kovaWorkspace.commandHistory()"),
      (value) => Boolean(value[0]?.finishedAt),
    );
    assert.equal(runs[0].exitCode, 0);
    assert.ok(runs[0].output.includes("native-runtime-pass"));
    assert.ok(prompts.includes("Run this local command?"));
    workspace.destroy();
    browser.destroy();
    await waitFor(
      () => Promise.resolve(remote.isDestroyed()),
      (value) => value,
    );
    console.log(
      "Electron browser and local command runtime passed; no external requests or providers used.",
    );
    clearTimeout(deadline);
    rmSync(root, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
