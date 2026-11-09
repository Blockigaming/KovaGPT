"use strict";

const api = window.kovaWorkspace;
const tree = document.getElementById("tree");
const editor = document.getElementById("editor");
const filename = document.getElementById("filename");
const folderName = document.getElementById("folderName");
const choose = document.getElementById("choose");
const closeFolder = document.getElementById("closeFolder");
const preview = document.getElementById("preview");
const save = document.getElementById("save");
const diff = document.getElementById("diff");
const status = document.getElementById("status");

let opened = null;
let original = "";
let openedHash = "";
let activeNode = null;

function notify(message, isError = false) {
  status.textContent = message;
  status.dataset.error = String(isError);
}
function showDiff(message = null) {
  diff.textContent = message ?? "";
  diff.dataset.show = message ? "true" : "false";
}
function updateButtons() {
  const modified = Boolean(opened && editor.value !== original);
  preview.disabled = !modified;
  save.disabled = !modified;
  filename.textContent = opened
    ? opened + (modified ? "  •  Unsaved changes" : "")
    : "Choose a source file from the left navigation.";
}
function discardAllowed() {
  return !opened || editor.value === original ||
    window.confirm("Discard unsaved changes to this source file?");
}

function resetEditor() {
  opened = null;
  openedHash = "";
  original = "";
  editor.value = "";
  editor.disabled = true;
  activeNode?.removeAttribute("aria-current");
  activeNode = null;
  updateButtons();
  showDiff();
}
async function guarded(action) {
  try {
    await action();
  } catch (error) {
    notify(error instanceof Error ? error.message : "This local action failed.", true);
  }
}
async function openFile(path, node) {
  if (!discardAllowed()) return;
  const file = await api.open(path);
  activeNode?.removeAttribute("aria-current");
  node.setAttribute("aria-current", "true");
  activeNode = node;
  opened = file.path;
  openedHash = file.hash;
  original = file.content;
  editor.value = original;
  editor.disabled = false;
  updateButtons();
  showDiff();
  notify("Opened locally. Nothing has been uploaded or executed.");
  editor.focus();
}
async function showFolder(parent, directory = "") {
  const entries = await api.list(directory);
  parent.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("span");
    empty.className = "policy";
    empty.textContent = "No supported source files here.";
    parent.append(empty);
  }
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "node";
    button.textContent = (entry.kind === "directory" ? "▸  " : "▹  ") + entry.name;
    button.title = entry.path;
    parent.append(button);
    if (entry.kind === "directory") {
      const children = document.createElement("div");
      children.className = "tree-children";
      children.hidden = true;
      parent.append(children);
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", () => guarded(async () => {
        const expanding = children.hidden;
        children.hidden = !expanding;
        button.setAttribute("aria-expanded", String(expanding));
        button.textContent = (expanding ? "▾  " : "▸  ") + entry.name;
        if (expanding) await showFolder(children, entry.path);
      }));
    } else {
      button.addEventListener("click", () => guarded(() => openFile(entry.path, button)));
    }
  }
}
choose.addEventListener("click", () => guarded(async () => {
  if (!discardAllowed()) return;
  const selected = await api.chooseFolder();
  if (!selected.selected) return;
  resetEditor();
  folderName.textContent = selected.name;
  closeFolder.disabled = false;
  await showFolder(tree);
  notify("Local folder selected. Choose a source file to edit.");
}));
closeFolder.addEventListener("click", () => guarded(async () => {
  if (!discardAllowed()) return;
  await api.closeFolder();
  resetEditor();
  tree.replaceChildren();
  folderName.textContent = "No folder selected";
  closeFolder.disabled = true;
  notify("Folder access ended. The workspace has forgotten its path.");
}));
editor.addEventListener("input", () => {
  showDiff();
  updateButtons();
});
preview.addEventListener("click", () => guarded(async () => {
  if (!opened) return;
  const result = await api.preview(opened, editor.value, openedHash);
  if (!result.changed) {
    showDiff();
    notify("No changes.");
    return;
  }
  const before = result.beforeLines.map((line) => "- " + line).join("\n");
  const after = result.afterLines.map((line) => "+ " + line).join("\n");
  showDiff(
    "Changes near line " + result.firstLine + (result.truncated ? " (preview truncated)" : "") +
      "\n" + before + (before && after ? "\n" : "") + after,
  );
  notify("Reviewed local diff. Saving still requires native confirmation.");
}));
async function saveFile() {
  if (!opened) return;
  const result = await api.save(opened, editor.value, openedHash);
  if (!result.saved) {
    if (result.unchanged) notify("No changes to save.");
    else notify("Save cancelled. Your edits remain in this window.");
    return;
  }
  openedHash = result.hash;
  original = editor.value;
  showDiff();
  updateButtons();
  notify("Saved the selected local file. Nothing was uploaded or executed.");
}
save.addEventListener("click", () => guarded(saveFile));
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (!save.disabled) void guarded(saveFile);
  }
});
if (!api) {
  choose.disabled = true;
  notify("This screen must be opened using the installed KovaGPT desktop app.", true);
} else {
  void guarded(async () => {
    const info = await api.info();
    if (!info.selected) return;
    folderName.textContent = info.name;
    closeFolder.disabled = false;
    await showFolder(tree);
  });
}
