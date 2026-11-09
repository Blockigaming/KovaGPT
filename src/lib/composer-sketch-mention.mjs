/** Find a complete trailing @prefix, never a mid-word email address. */
export function trailingComposerMention(value) {
  if (typeof value !== "string") return null;
  const match = /(?:^|\s)@([a-z]*)$/i.exec(value);
  if (!match) return null;
  return { start: value.length - match[1].length - 1, query: match[1].toLowerCase() };
}

/** Return the @ position of a supported trailing Sketch mention, or -1. */
export function sketchMentionStart(value) {
  const mention = trailingComposerMention(value);
  return mention && "sketch".startsWith(mention.query) ? mention.start : -1;
}
