/** Return the @ position of a supported trailing Sketch mention, or -1. */
export function sketchMentionStart(value) {
  if (typeof value !== "string") return -1;
  const match = /(?:^|\s)@([a-z]*)$/i.exec(value);
  if (!match || !"sketch".startsWith(match[1].toLowerCase())) return -1;
  return value.length - match[1].length - 1;
}
