export const EMPTY_DOCUMENT_TITLE = Object.freeze({ title: "" });
export function isDocumentTitle(v) {
  return Boolean(v && typeof v.title === "string" && v.title.length <= 200);
}
export function formatDocumentSelection(text, start, end, action, url = "") {
  if (
    typeof text !== "string" ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > text.length
  )
    throw new Error("Select document text before formatting.");
  let replacement,
    from = start,
    to = end;
  const selected = text.slice(start, end);
  if (action === "bold" || action === "italic") {
    const mark = action === "bold" ? "**" : "*";
    replacement = mark + selected + mark;
    return {
      text: text.slice(0, start) + replacement + text.slice(end),
      start: start + mark.length,
      end: end + mark.length,
    };
  }
  if (action === "link") {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Enter a complete https or http link.");
    }
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error("Use an https or http link without credentials.");
    const target = parsed.href.replaceAll("(", "%28").replaceAll(")", "%29");
    replacement = `[${selected.replaceAll("[", "\\[").replaceAll("]", "\\]") || "Link"}](${target})`;
  } else {
    from = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
    to = lineEnd < 0 ? text.length : lineEnd;
    const lines = text.slice(from, to).split("\n");
    replacement = lines
      .map((line, index) => {
        if (action === "heading") return "## " + line.replace(/^#{1,6}\s+/, "");
        if (action === "quote") return "> " + line;
        if (action === "bullet") return "- " + line;
        if (action === "numbered") return `${index + 1}. ${line}`;
        if (action === "indent") return "  " + line;
        if (action === "outdent") return line.replace(/^ {1,2}/, "");
        throw new Error("Unsupported formatting action.");
      })
      .join("\n");
  }
  return {
    text: text.slice(0, from) + replacement + text.slice(to),
    start: from,
    end: from + replacement.length,
  };
}
