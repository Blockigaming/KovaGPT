export function prepareComposerPaste(plain: string, html: string) {
  if (plain.length > 80_000 || new TextEncoder().encode(plain).length > 200_000)
    throw new Error(
      "Paste supports up to 80,000 characters and 200 KB. Split the text; nothing has been truncated.",
    );
  if (!html || html.length > 200_000) return plain;
  // A detached template is inert: no scripts, event handlers, styles or resource
  // URLs execute or load. Only explicitly supported text structure is read.
  const template = document.createElement("template");
  template.innerHTML = html;
  let visited = 0;
  const read = (node: Node, depth = 0): string => {
    if (++visited > 25_000 || depth > 60)
      throw new Error("The pasted formatting is too complex. Use plain text.");
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element) && !(node instanceof DocumentFragment)) return "";
    if (
      node instanceof Element &&
      (/^(SCRIPT|STYLE|TEMPLATE|IFRAME|OBJECT|EMBED|SVG|MATH|IMG|LINK|META|INPUT|BUTTON|SELECT|TEXTAREA|AUDIO|VIDEO|CANVAS)$/u.test(
        node.tagName,
      ) ||
        node.hasAttribute("hidden") ||
        node.getAttribute("aria-hidden") === "true" ||
        /(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)/iu.test(
          node.getAttribute("style") ?? "",
        ))
    )
      return "";
    const content = Array.from(node.childNodes)
      .map((child) => read(child, depth + 1))
      .join("");
    if (!(node instanceof Element)) return content;
    if (/^H[1-6]$/u.test(node.tagName))
      return `\n${"#".repeat(Number(node.tagName[1]))} ${content.trim()}\n\n`;
    if (node.tagName === "BR") return "\n";
    if (node.tagName === "LI")
      return `\n${node.parentElement?.tagName === "OL" ? "1." : "-"} ${content.trim()}`;
    if (node.tagName === "STRONG" || node.tagName === "B") return `**${content}**`;
    if (node.tagName === "EM" || node.tagName === "I") return `*${content}*`;
    if (node.tagName === "PRE") return `\n\n\`\`\`\n${content}\n\`\`\`\n\n`;
    if (node.tagName === "TD" || node.tagName === "TH") return `${content}\t`;
    if (/^(P|DIV|SECTION|ARTICLE|BLOCKQUOTE|UL|OL|TR|TABLE)$/u.test(node.tagName))
      return `${content}\n`;
    return content;
  };
  const formatted = read(template.content)
    .replace(/\n{4,}/gu, "\n\n\n")
    .trim();
  if (formatted.length > 80_000 || new TextEncoder().encode(formatted).length > 200_000)
    throw new Error(
      "Formatted paste exceeds the text limit. Use plain text or split the content; nothing has been truncated.",
    );
  return formatted || plain;
}
