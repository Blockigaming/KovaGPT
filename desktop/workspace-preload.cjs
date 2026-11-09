"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// This preload is installed ONLY on kova-local://workspace, never kovagpt.com.
// It exposes explicit workspace methods, not raw Electron IPC or filesystem objects.
contextBridge.exposeInMainWorld("kovaWorkspace", {
  info: () => ipcRenderer.invoke("kova-workspace:info"),
  chooseFolder: () => ipcRenderer.invoke("kova-workspace:choose"),
  list: (directory = "") => ipcRenderer.invoke("kova-workspace:list", directory),
  open: (path) => ipcRenderer.invoke("kova-workspace:open", path),
  preview: (path, text, hash) => ipcRenderer.invoke("kova-workspace:preview", path, text, hash),
  save: (path, text, hash) => ipcRenderer.invoke("kova-workspace:save", path, text, hash),
  git: (operation) => ipcRenderer.invoke("kova-workspace:git", operation),
  runCommand: (command) => ipcRenderer.invoke("kova-workspace:runCommand", command),
  commandHistory: () => ipcRenderer.invoke("kova-workspace:commandHistory"),
  cancelCommand: () => ipcRenderer.invoke("kova-workspace:cancelCommand"),
  clearCommandHistory: () => ipcRenderer.invoke("kova-workspace:clearCommandHistory"),
  closeFolder: () => ipcRenderer.invoke("kova-workspace:closeFolder"),
});
