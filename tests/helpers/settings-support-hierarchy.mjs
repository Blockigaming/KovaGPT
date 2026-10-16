// Explicitly reconcile only the authorized support/action copy correction.
export function supportHierarchy(source) {
  let result = source.replace(
    "keywords?: string[]",
    "keywords?: string[]; showSettingsSubtitle?: boolean",
  );
  for (const [value, label, icon] of [
    ["report", "Report an issue", "Bug"],
    ["help", "Help center", "LifeBuoy"],
    ["about", "About", "Info"],
    ["logout", "Log out", "LogOut"],
  ]) {
    result = result.replace(
      `{ v: "${value}", label: "${label}", icon: ${icon} }`,
      `{ v: "${value}", label: "${label}", icon: ${icon}, showSettingsSubtitle: false }`,
    );
    result = result.replace(
      `<h3 className="text-sm font-semibold">${value === "about" ? "About KovaGPT" : label}</h3>`,
      "",
    );
  }
  return result.replace(
    "<p>Manage your KovaGPT {activeTab.label.toLocaleLowerCase()} settings.</p>",
    "{activeTab.showSettingsSubtitle !== false && (<p>Manage your KovaGPT {activeTab.label.toLocaleLowerCase()} settings.</p>)}",
  );
}
