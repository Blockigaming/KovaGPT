import Prism from "./prism-global";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-java";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-regex";
import "prismjs/components/prism-ini";

const ALIASES: Record<string, string> = {
  html: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  md: "markdown",
  rs: "rust",
  rb: "ruby",
  kt: "kotlin",
  cs: "csharp",
  "c++": "cpp",
  golang: "go",
  jsonc: "json",
  jsonl: "json",
};

/** Prism grammar name for a fence language, or null when it is not highlighted. */
export function grammarFor(language: string) {
  const key = language.toLowerCase();
  const name = ALIASES[key] ?? key;
  return Prism.languages[name] ? name : null;
}

/**
 * Highlighted HTML for each source line. Prism escapes the source text; the only markup
 * in the result is its own <span class="token …"> wrappers, re-balanced per line.
 */
export function highlightLines(text: string, language: string): string[] | null {
  const grammarName = grammarFor(language);
  if (!grammarName) return null;
  const html = Prism.highlight(text, Prism.languages[grammarName], grammarName);
  const lines: string[] = [];
  const open: string[] = [];
  let current = "";
  const pattern = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<)/g;
  for (const match of html.matchAll(pattern)) {
    if (match[1]) {
      open.push(match[1]);
      current += match[1];
    } else if (match[2]) {
      open.pop();
      current += match[2];
    } else if (match[3]) {
      lines.push(current + "</span>".repeat(open.length));
      current = open.join("");
    } else current += match[4];
  }
  lines.push(current + "</span>".repeat(open.length));
  return lines;
}
