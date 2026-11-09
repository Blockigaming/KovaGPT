"use strict";
const api = window.kovaBrowser;
const tabs = document.getElementById("tabs");
const address = document.getElementById("address");
const status = document.getElementById("status");
const back = document.getElementById("back");
const forward = document.getElementById("forward");
let last = "";
let reading = false;
let notice = "";
async function perform(action) {
  try {
    notice = "";
    await action();
    await refresh();
  } catch (error) {
    notice = error.message || "This browser action failed.";
    status.textContent = notice;
    status.dataset.error = "true";
  }
}
async function refresh() {
  if (!api || reading) return;
  reading = true;
  try {
    const state = await api.state();
    const active = state.tabs.find((tab) => tab.id === state.active);
    back.disabled = !active?.canGoBack;
    forward.disabled = !active?.canGoForward;
    document.getElementById("reload").disabled = !active;
    document.getElementById("copyContext").disabled = !active;
    document.getElementById("newTab").disabled = state.tabs.length >= 8;
    document.getElementById("empty").hidden = Boolean(active);
    if (document.activeElement !== address) address.value = active?.url || "";
    const signature = JSON.stringify(state);
    if (signature !== last) {
      last = signature;
      // Keep focused controls stable while loading titles/state changes.
      const focused = document.activeElement?.dataset?.tabAction;
      tabs.replaceChildren();
      for (const tab of state.tabs) {
        const group = document.createElement("span");
        group.className = "tab";
        group.setAttribute("aria-current", String(tab.id === state.active));
        const select = document.createElement("button");
        select.type = "button";
        select.textContent = tab.title;
        select.title = tab.url;
        select.dataset.tabAction = "select-" + tab.id;
        select.setAttribute("aria-label", "Select tab: " + tab.title);
        select.addEventListener("click", () => void perform(() => api.select(tab.id)));
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "×";
        close.dataset.tabAction = "close-" + tab.id;
        close.setAttribute("aria-label", "Close tab: " + tab.title);
        close.addEventListener("click", () => void perform(() => api.close(tab.id)));
        group.append(select, close);
        tabs.append(group);
      }
      if (focused)
        [...tabs.querySelectorAll("button")]
          .find((button) => button.dataset.tabAction === focused)
          ?.focus();
    }
    if (!notice) {
      status.textContent =
        active?.error ||
        (active?.loading
          ? "Loading website…"
          : "Local browser · Copy context only after review. Nothing is automatically sent to chat.");
      status.dataset.error = String(Boolean(active?.error));
    }
  } finally {
    reading = false;
  }
}
document.getElementById("addressForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const target = address.value;
  address.blur();
  void perform(() => api.navigate(target));
});
for (const action of ["back", "forward", "reload"])
  document
    .getElementById(action)
    .addEventListener("click", () => void perform(() => api[action]()));
document
  .getElementById("newTab")
  .addEventListener("click", () => void perform(() => api.newTab("https://kovagpt.com/")));
document.getElementById("copyContext").addEventListener(
  "click",
  () =>
    void perform(async () => {
      const result = await api.copyContext();
      notice = result.copied
        ? "Copied browser context to your clipboard. Paste it into chat to share it."
        : "Copy cancelled.";
      status.textContent = notice;
      status.dataset.error = "false";
    }),
);
if (api) {
  void perform(refresh);
  const timer = setInterval(() => {
    void refresh().catch((error) => {
      status.textContent = error.message;
      status.dataset.error = "true";
    });
  }, 750);
  window.addEventListener("beforeunload", () => clearInterval(timer));
} else {
  status.textContent = "Open this screen from the installed KovaGPT desktop app.";
  for (const control of document.querySelectorAll("button, input")) control.disabled = true;
}
