export function activeTabIdentity(tab) {
  if (
    !tab ||
    !Number.isSafeInteger(tab.id) ||
    tab.id < 0 ||
    typeof tab.url !== "string" ||
    tab.url.length > 8192
  )
    throw new Error("Choose an HTTPS website tab before opening this extension.");
  let url;
  try {
    url = new URL(tab.url);
  } catch {
    throw new Error("This tab's address is unavailable.");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password)
    throw new Error("Only HTTPS website tabs without embedded credentials are supported.");
  return {
    id: tab.id,
    url: url.href,
    title:
      typeof tab.title === "string"
        ? tab.title.replace(/[\r\n\x00-\x1f]/gu, " ").slice(0, 256)
        : url.hostname,
  };
}

export function reviewedTabContext(tab, selection = "") {
  const identity = activeTabIdentity(tab);
  if (typeof selection !== "string") throw new Error("The selected text could not be read.");
  const text = selection.replace(/\x00/gu, "").slice(0, 16000);
  return `${identity.title}\n${identity.url}${text ? "\n\nSelected text:\n" + text : ""}`;
}

export function readSelectedText() {
  // This is the entire script executed by an explicit Prepare click. No page DOM,
  // forms, cookies, screenshots, history or unselected content is collected.
  return window.getSelection()?.toString().slice(0, 16000) || "";
}

export async function prepareActiveTab(chromeApi, includeSelection) {
  const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
  const identity = activeTabIdentity(tabs[0]);
  let selection = "";
  if (includeSelection) {
    const result = await chromeApi.scripting.executeScript({
      target: { tabId: identity.id, allFrames: false },
      func: readSelectedText,
    });
    if (result.length !== 1 || result[0].frameId !== 0 || typeof result[0].result !== "string")
      throw new Error("The selected text is unavailable on this page.");
    selection = result[0].result;
  }
  const current = activeTabIdentity(await chromeApi.tabs.get(identity.id));
  const activeNow = await chromeApi.tabs.query({ active: true, currentWindow: true });
  if (current.url !== identity.url || activeNow[0]?.id !== identity.id)
    throw new Error(
      "The tab navigated while preparing context. Review the new page and try again.",
    );
  return reviewedTabContext(identity, selection);
}
