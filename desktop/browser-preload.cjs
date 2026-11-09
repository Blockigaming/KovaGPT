"use strict";
const { contextBridge, ipcRenderer } = require("electron");
// Attached exclusively to the packaged, local browser toolbar. Remote tabs get no preload.
contextBridge.exposeInMainWorld("kovaBrowser", {
  state: () => ipcRenderer.invoke("kova-browser:state"),
  newTab: (url) => ipcRenderer.invoke("kova-browser:newTab", url),
  select: (id) => ipcRenderer.invoke("kova-browser:select", id),
  close: (id) => ipcRenderer.invoke("kova-browser:close", id),
  navigate: (url) => ipcRenderer.invoke("kova-browser:navigate", url),
  back: () => ipcRenderer.invoke("kova-browser:back"),
  forward: () => ipcRenderer.invoke("kova-browser:forward"),
  reload: () => ipcRenderer.invoke("kova-browser:reload"),
  copyContext: () => ipcRenderer.invoke("kova-browser:copyContext"),
});
