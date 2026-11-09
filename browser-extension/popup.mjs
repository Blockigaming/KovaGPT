import { prepareActiveTab } from "./context.mjs";

const prepare = document.getElementById("prepare");
const selection = document.getElementById("selection");
const preview = document.getElementById("preview");
const copy = document.getElementById("copy");
const status = document.getElementById("status");
let generation = 0;
function report(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}
selection.addEventListener("change", () => {
  generation++;
  preview.value = "";
  copy.disabled = true;
  report("Prepare a new preview to apply this selection choice.");
});
preview.addEventListener("input", () => {
  copy.disabled = !preview.value.trim();
});
prepare.addEventListener("click", async () => {
  const token = ++generation;
  prepare.disabled = true;
  copy.disabled = true;
  preview.value = "";
  try {
    const context = await prepareActiveTab(chrome, selection.checked);
    if (token !== generation) return;
    preview.value = context;
    copy.disabled = false;
    report("Review the preview, remove anything private, then copy it.");
  } catch (error) {
    if (token === generation) report(error.message || "This page's context is unavailable.", true);
  } finally {
    prepare.disabled = false;
  }
});
copy.addEventListener("click", async () => {
  const content = preview.value;
  if (!content.trim() || content.length > 32000) return;
  try {
    await navigator.clipboard.writeText(content);
    report("Copied. Paste the reviewed context into your KovaGPT chat.");
  } catch {
    report("Clipboard access was denied. Select and copy the preview manually.", true);
  }
});
document.getElementById("open").addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: "https://kovagpt.com/" });
  } catch {
    report("Open https://kovagpt.com in a new tab, then paste your context.", true);
  }
});
