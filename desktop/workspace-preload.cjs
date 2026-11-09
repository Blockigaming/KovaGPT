"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// This preload is installed ONLY on kova-local://workspace, never kovagpt.com.
// It exposes five bounded methods, not raw Electron IPC or filesystem objects.
contextBridge.exposeInMainWorld("kovaWorkspace", {
  info: () => ipcRenderer.invoke("kova-workspace:info"),
  chooseFolder: () => ipcRenderer.invoke("kova-workspace:choose"),
  list: (directory = "") => ipcRenderer.invoke("kova-workspace:list", directory),
  open: (path) => ipcRenderer.invoke("kova-workspace:open", path),
  preview: (path, text, hash) => ipcRenderer.invoke("kova-workspace:preview", path, text, hash),
  save: (path, text, hash) => ipcRenderer.invoke("kova-workspace:save", path, text, hash),
  closeFolder: () => ipcRenderer.invoke("kova-workspace:closeFolder"),
});
