/**
 * ==highlight==, H~2~O subscript and x^2^ superscript as real <mark>/<sub>/<sup> elements.
 * Works on mdast text nodes only, so code, links and math are never touched, and no raw
 * HTML is involved. Single-tilde strikethrough is turned off in remark-gfm so `~2~` can
 * mean subscript; `~~text~~` still strikes through.
 */
const PATTERN =
  /==(?=\S)([^=\n]{1,200}?)(?<=\S)==|~(?=\S)([^~\s]{1,40})~|\^(?=\S)([^^\s]{1,40})\^/gu;

function split(value) {
  const parts = [];
  let last = 0;
  for (const match of value.matchAll(PATTERN)) {
    if (match.index > last) parts.push({ type: "text", value: value.slice(last, match.index) });
    const [tag, text] =
      match[1] !== undefined
        ? ["mark", match[1]]
        : match[2] !== undefined
          ? ["sub", match[2]]
          : ["sup", match[3]];
    parts.push({
      type: "inlineMark",
      data: { hName: tag },
      children: [{ type: "text", value: text }],
    });
    last = match.index + match[0].length;
  }
  if (!parts.length) return null;
  if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
  return parts;
}

export default function remarkInlineMarks() {
  return (tree) => {
    const visit = (node) => {
      if (!Array.isArray(node.children)) return;
      for (let index = 0; index < node.children.length; index++) {
        const child = node.children[index];
        if (child.type === "text") {
          const parts = split(child.value);
          if (parts) {
            node.children.splice(index, 1, ...parts);
            index += parts.length - 1;
          }
        } else if (
          !["inlineCode", "code", "math", "inlineMath", "html", "link", "linkReference"].includes(
            child.type,
          )
        ) {
          visit(child);
        }
      }
    };
    visit(tree);
  };
}
