export const LOCAL_PASTE_THRESHOLD = 10_000;
export const LOCAL_PASTE_MAX_CHARACTERS = 80_000;
export const LOCAL_PASTE_MAX_BYTES = 200_000;
export const ATTACHMENT_PREVIEW_CHARACTERS = 4_000;

/** Count UTF-8 bytes without allocating a second full-text byte buffer. */
export function utf8TextBytes(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

const summaryStopWords = new Set(
  "a an and are as at be but by for from had has have he her i if in is it its me my of on or our she so than that the their them then there these they this to up us was we were what when where which who will with would you your".split(
    " ",
  ),
);

/** Pick a short topic label locally from a heading or recurring words. */
export function summarizeLocalPaste(text) {
  const cleaned = text.replace(/https?:\/\/\S+/gi, " ");
  const words = (value) => value.match(/\p{L}[\p{L}\p{M}\p{N}'’]{0,47}/gu) ?? [];
  const heading = cleaned.trimStart().match(/^#{1,6}[^\S\r\n]+([^\r\n]+)/)?.[1];
  if (heading) {
    const title = words(heading).slice(0, 4).join(" ");
    if (title) return title;
  }

  const tokens = words(cleaned);
  const counts = new Map();
  for (const word of tokens) {
    const key = word.toLowerCase();
    if (summaryStopWords.has(key)) continue;
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { word, count: 1 });
  }

  let best = [];
  let bestScore = 0;
  for (let start = 0; start < tokens.length; start++) {
    const phrase = [];
    const seen = new Set();
    let score = 0;
    for (const word of tokens.slice(start, start + 4)) {
      const key = word.toLowerCase();
      const entry = counts.get(key);
      if (!entry || seen.has(key)) break;
      seen.add(key);
      phrase.push(word);
      score += Math.log2(1 + entry.count);
      if (score > bestScore) {
        best = [...phrase];
        bestScore = score;
      }
    }
  }
  const label = best.join(" ") || tokens.slice(0, 4).join(" ");
  return label ? label.replace(/^\p{L}/u, (letter) => letter.toUpperCase()) : "Pasted text";
}

/** Preserve the clipboard's exact plain text, including tabs, CRLF, and trailing whitespace. */
export function prepareLocalPaste(text) {
  if (text.length > LOCAL_PASTE_MAX_CHARACTERS)
    throw new Error(
      "Paste supports up to 80,000 characters and 200 KB. Split the text; nothing has been truncated.",
    );
  const size = utf8TextBytes(text);
  if (size > LOCAL_PASTE_MAX_BYTES)
    throw new Error(
      "Paste supports up to 80,000 characters and 200 KB. Split the text; nothing has been truncated.",
    );
  return { text, size, summary: summarizeLocalPaste(text) };
}

/** A fixed-size, selectable preview. No normalization or permanent truncation. */
export function attachmentPreviewWindow(text, requestedStart = 0) {
  let start = Math.max(0, Math.min(text.length, Math.floor(requestedStart)));
  if (
    start > 0 &&
    /[\uDC00-\uDFFF]/u.test(text[start] ?? "") &&
    /[\uD800-\uDBFF]/u.test(text[start - 1] ?? "")
  )
    start--;
  let end = Math.min(text.length, start + ATTACHMENT_PREVIEW_CHARACTERS);
  if (
    end < text.length &&
    /[\uD800-\uDBFF]/u.test(text[end - 1] ?? "") &&
    /[\uDC00-\uDFFF]/u.test(text[end] ?? "")
  )
    end--;
  return { text: text.slice(start, end), start, end, total: text.length };
}

/** Reinsert at the original selection only if the intervening draft is unchanged. */
export function pasteAttachmentIntoDraft(current, text, origin) {
  if (origin && current === origin.original)
    return current.slice(0, origin.start) + text + current.slice(origin.end);
  return current + (current ? "\n\n" : "") + text;
}
