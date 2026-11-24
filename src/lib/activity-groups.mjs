/**
 * Places a reply's steps between the paragraphs they happened around, like
 *   text · "Used GitHub and Supabase, ran 7 commands, and searched the web" · text
 * Each activity records `at`: how much reply text had arrived when it started.
 */

/** Splits content into text and activity-group segments. Offsets snap to paragraph ends. */
export function segmentReply(content, activities = []) {
  const text = String(content ?? "");
  const positioned = activities.filter((a) => Number.isSafeInteger(a?.at) && !a.parentId);
  if (!positioned.length) return null;
  const children = new Map();
  for (const activity of activities)
    if (activity?.parentId) {
      const list = children.get(activity.parentId) ?? [];
      list.push(activity);
      children.set(activity.parentId, list);
    }
  const groups = new Map();
  for (const activity of positioned) {
    const cut = snapToParagraph(text, Math.min(activity.at, text.length));
    const list = groups.get(cut) ?? [];
    list.push(activity, ...(children.get(activity.activityId) ?? []));
    groups.set(cut, list);
  }
  const segments = [];
  let last = 0;
  for (const cut of [...groups.keys()].sort((a, b) => a - b)) {
    if (cut > last) segments.push({ kind: "text", text: text.slice(last, cut) });
    segments.push({ kind: "group", activities: groups.get(cut), at: cut });
    last = cut;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** The start of the paragraph that was being written, never inside a code fence. */
export function snapToParagraph(text, offset) {
  if (offset <= 0) return 0;
  if (offset >= text.length) return text.length;
  let cut = text.lastIndexOf("\n\n", offset);
  cut = cut < 0 ? 0 : cut + 2;
  // Keep fenced blocks whole: if the cut falls inside a fence, move before it.
  const fences = [...text.slice(0, cut).matchAll(/^(```|~~~)/gmu)].length;
  if (fences % 2 === 1) {
    const open = text.lastIndexOf("\n```", cut);
    cut = open < 0 ? 0 : open + 1;
  }
  return cut;
}

const APPS = [
  ["github", "GitHub"],
  ["supabase", "Supabase"],
  ["gmail", "Gmail"],
  ["outlook", "Outlook"],
  ["calendar", "Calendar"],
  ["drive", "Google Drive"],
  ["onedrive", "OneDrive"],
  ["notion", "Notion"],
  ["slack", "Slack"],
  ["linear", "Linear"],
  ["jira", "Jira"],
  ["figma", "Figma"],
  ["stripe", "Stripe"],
  ["dropbox", "Dropbox"],
];

function category(activity) {
  const tool = String(activity.tool ?? "").toLowerCase();
  const app = APPS.find(([key]) => tool.includes(key));
  if (app) return { kind: "app", name: app[1] };
  if (tool.includes("browser")) return { kind: "browser" };
  if (/web|search_web|internet/u.test(tool) || /search(ed)? the web/iu.test(activity.label))
    return { kind: "web" };
  if (/image/u.test(tool)) return { kind: "image" };
  if (/code|python|command|shell|exec|run|terminal/u.test(tool)) return { kind: "command" };
  if (/file|read|document|library|glob|grep/u.test(tool)) return { kind: "files" };
  if (/memory/u.test(tool)) return { kind: "memory" };
  return { kind: "other" };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function joinPhrases(phrases) {
  if (phrases.length <= 1) return phrases[0] ?? "";
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases.at(-1)}`;
}

/** "Used GitHub and Supabase, ran 7 commands, explored files, and searched the web". */
export function summarizeActivityGroup(activities = []) {
  const top = activities.filter((a) => !a.parentId);
  const list = top.length ? top : activities;
  const running = activities.find((a) => a.status === "running");
  if (running) return running.label;
  const apps = [];
  const counts = { command: 0, files: 0, web: 0, browser: 0, image: 0, memory: 0, other: 0 };
  for (const activity of list) {
    const found = category(activity);
    if (found.kind === "app") {
      if (!apps.includes(found.name)) apps.push(found.name);
    } else counts[found.kind] += 1;
  }
  const phrases = [];
  if (apps.length) phrases.push(`used ${joinPhrases(apps)}`);
  if (counts.command) phrases.push(`ran ${plural(counts.command, "command", "commands")}`);
  if (counts.files) phrases.push("explored files");
  if (counts.web) phrases.push("searched the web");
  if (counts.browser) phrases.push("used the browser");
  if (counts.image) phrases.push(`made ${plural(counts.image, "image", "images")}`);
  if (counts.memory) phrases.push("checked memory");
  if (counts.other)
    phrases.push(
      phrases.length
        ? `took ${plural(counts.other, "other step", "other steps")}`
        : `took ${plural(counts.other, "step", "steps")}`,
    );
  if (list.length === 1 && !apps.length && !counts.command && !counts.web) return list[0].label;
  const sentence = joinPhrases(phrases);
  return sentence ? sentence[0].toUpperCase() + sentence.slice(1) : "Worked";
}

/** Failed steps are surfaced in the summary line so they are never hidden by collapsing. */
export const groupFailed = (activities = []) =>
  activities.some((a) => a.status === "failed" || a.status === "partial");
