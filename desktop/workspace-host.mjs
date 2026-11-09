import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLocalWorkspace } from "./workspace-files.mjs";
import { createLocalCommandRunner, validateCommand, readGit } from "./workspace-process.mjs";

export const WORKSPACE_ORIGIN = "kova-local://workspace";
export const WORKSPACE_URL = WORKSPACE_ORIGIN + "/index.html";
const ASSETS = Object.freeze({
  "/index.html": ["workspace.html", "text/html; charset=utf-8"],
  "/workspace-ui.js": ["workspace-ui.js", "text/javascript; charset=utf-8"],
});

export function registerWorkspaceScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: "kova-local", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/**
 * The local coding workspace has its own offline renderer, profile and allowlisted
 * IPC. No Kova website renderer receives this preload, filesystem access or IPC.
 */
export function installLocalWorkspace({
  BrowserWindow,
  ipcMain,
  session,
  dialog,
  assetsPath,
  iconPath,
}) {
  const localSession = session.fromPartition("persist:kova-local-workspace");
  const filesystem = createLocalWorkspace();
  let window = null;
  let commands = createLocalCommandRunner();
  let scopeRevision = 0;
  let confirmingCommand = false;
  let choosingFolder = false;

  localSession.protocol.handle("kova-local", async (request) => {
    let location;
    try {
      location = new URL(request.url);
    } catch {
      return new Response(null, { status: 404 });
    }
    const asset =
      location.host === "workspace" &&
      !location.search &&
      !location.hash &&
      ASSETS[location.pathname];
    if (!asset) return new Response(null, { status: 404 });
    return new Response(readFileSync(join(assetsPath, asset[0])), {
      headers: {
        "Content-Type": asset[1],
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; " +
          "img-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; " +
          "base-uri 'none'; form-action 'none'",
      },
    });
  });
  localSession.setPermissionCheckHandler(() => false);
  localSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  const trusted = (event) =>
    Boolean(
      window &&
      !window.isDestroyed() &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      event.senderFrame?.url === WORKSPACE_URL,
    );

  function handler(channel, action) {
    ipcMain.handle("kova-workspace:" + channel, async (event, ...args) => {
      if (!trusted(event)) throw new Error("Workspace request denied");
      return action(event, ...args);
    });
  }

  handler("info", () => filesystem.info());
  handler("choose", async (event) => {
    if (commands.isBusy() || confirmingCommand || choosingFolder)
      throw new Error("Finish or stop the current action before changing folders");
    const revision = scopeRevision;
    choosingFolder = true;
    let result;
    try {
      result = await dialog.showOpenDialog(window, {
        title: "Choose a repository folder",
        properties: ["openDirectory"],
        buttonLabel: "Open local workspace",
      });
    } finally {
      choosingFolder = false;
    }
    if (
      !trusted(event) ||
      revision !== scopeRevision ||
      result.canceled ||
      result.filePaths?.length !== 1
    )
      return { selected: false };
    scopeRevision++;
    commands.clear();
    return filesystem.chooseFolder(result.filePaths[0]);
  });
  handler("list", (_event, directory) => filesystem.list(directory));
  handler("open", (_event, path) => filesystem.open(path));
  handler("preview", (_event, path, text, hash) => filesystem.preview(path, text, hash));
  handler("save", async (event, path, text, hash) => {
    const revision = scopeRevision;
    const changes = filesystem.preview(path, text, hash);
    if (!changes.changed) return { saved: false, unchanged: true };
    const answer = await dialog.showMessageBox(window, {
      type: "warning",
      title: "Save changes to local file?",
      message: "Overwrite the selected source file with your edited content?",
      detail:
        "This writes only to the folder you explicitly selected. KovaGPT does not run or upload the code.",
      buttons: ["Cancel", "Save file"],
      defaultId: 0,
      cancelId: 0,
    });
    if (!trusted(event) || revision !== scopeRevision || answer.response !== 1)
      return { saved: false };
    return { ...filesystem.save(path, text, hash), saved: true };
  });
  handler("closeFolder", () => {
    if (commands.isBusy() || confirmingCommand || choosingFolder)
      throw new Error("Finish or stop the current action before closing the folder");
    scopeRevision++;
    commands.clear();
    filesystem.close();
    return { selected: false };
  });

  handler("git", async (event, operation) => {
    if (commands.isBusy() || confirmingCommand || choosingFolder)
      throw new Error("Wait for the current local action to finish");
    const revision = scopeRevision;
    const result = await readGit(filesystem.executionRoot(), operation);
    if (!trusted(event) || revision !== scopeRevision)
      throw new Error("Repository changed during Git inspection");
    return result;
  });
  handler("commandHistory", () => commands.snapshot());
  handler("cancelCommand", () => commands.cancel());
  handler("clearCommandHistory", () => {
    commands.clear();
    return { cleared: true };
  });
  handler("runCommand", async (event, command) => {
    validateCommand(command);
    if (confirmingCommand || choosingFolder || commands.isBusy())
      throw new Error("Finish or stop the current local action first");
    const root = filesystem.executionRoot();
    const revision = scopeRevision;
    confirmingCommand = true;
    try {
      const answer = await dialog.showMessageBox(window, {
        type: "warning",
        title: "Run this local command?",
        message: command,
        detail: `Working folder: ${root}\n\nThis command runs with your computer account's permissions. It can read or change files outside this folder and access the network. Review the complete command before allowing it. Input prompts are not supported; commands stop after two minutes or 256 KiB of output.`,
        buttons: ["Cancel", "Run command"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (!trusted(event) || revision !== scopeRevision || answer.response !== 1)
        return { started: false };
      return { ...commands.start(root, command), started: true };
    } finally {
      confirmingCommand = false;
    }
  });

  return function openLocalWorkspace() {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return window;
    }
    window = new BrowserWindow({
      title: "KovaGPT Local Coding Workspace",
      width: 1170,
      height: 790,
      minWidth: 720,
      minHeight: 520,
      backgroundColor: "#11131b",
      icon: iconPath,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        webviewTag: false,
        allowRunningInsecureContent: false,
        partition: "persist:kova-local-workspace",
        preload: join(assetsPath, "workspace-preload.cjs"),
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== WORKSPACE_URL) event.preventDefault();
    });
    window.webContents.on("will-redirect", (event) => event.preventDefault());
    window.on("closed", () => {
      scopeRevision++;
      commands.dispose();
      commands = createLocalCommandRunner();
      filesystem.close();
      window = null;
    });
    void window.loadURL(WORKSPACE_URL);
    return window;
  };
}
