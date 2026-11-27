/**
 * Files in a response are fenced code blocks whose opening line names a file:
 *   ```html filename="game.html"
 * They render as a file card and open in the side preview pane.
 */

const FILENAME = /\b(?:filename|file)=(["'])(.*?)\1|\b(?:filename|file)=([^\s`]+)/u;

/** Same rules as the visible download name: no paths, control or reserved characters. */
export function safeResponseFilename(value) {
  const name = String(value ?? "")
    .split(/[\\/]/)
    .pop();
  return (
    Array.from(name ?? "")
      .filter(
        (character) =>
          character.charCodeAt(0) >= 32 &&
          character.charCodeAt(0) !== 127 &&
          !'<>:"|?*'.includes(character),
      )
      .join("")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 160) || "output.txt"
  );
}

/** Filename named on a fence's opening line, if any. */
export function fenceFilename(infoLine) {
  const match = FILENAME.exec(String(infoLine ?? ""));
  return match ? safeResponseFilename(match[2] || match[3]) : null;
}

/** Every named file in a Markdown response, in order. Unclosed fences are still streaming. */
export function extractResponseFiles(markdown) {
  const files = [];
  let open = null;
  const lines = String(markdown ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open && marker) {
      const info = marker[2].trim();
      open = {
        fence: marker[1],
        language: (info.split(/\s+/)[0] || "").replace(/[{}]/g, "").toLowerCase(),
        name: fenceFilename(info),
        lines: [],
      };
    } else if (
      open &&
      marker &&
      marker[1][0] === open.fence[0] &&
      marker[1].length >= open.fence.length &&
      !marker[2].trim()
    ) {
      if (open.name)
        files.push(describeFile(open.name, open.language, open.lines.join("\n"), true));
      open = null;
    } else if (open) open.lines.push(line);
  }
  if (open?.name) files.push(describeFile(open.name, open.language, open.lines.join("\n"), false));
  return files;
}

const EXTENSION_LANGUAGE = {
  html: "html",
  htm: "html",
  svg: "svg",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  json: "json",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  csv: "csv",
  tsv: "tsv",
  txt: "text",
  pdf: "pdf",
};

const LANGUAGE_LABEL = {
  html: "HTML",
  svg: "SVG",
  markdown: "Markdown",
  css: "CSS",
  javascript: "JavaScript",
  jsx: "JSX",
  typescript: "TypeScript",
  tsx: "TSX",
  json: "JSON",
  python: "Python",
  ruby: "Ruby",
  go: "Go",
  rust: "Rust",
  java: "Java",
  kotlin: "Kotlin",
  swift: "Swift",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  php: "PHP",
  shell: "Shell",
  sql: "SQL",
  yaml: "YAML",
  toml: "TOML",
  xml: "XML",
  csv: "CSV",
  tsv: "TSV",
  text: "Text",
  pdf: "PDF",
};

const MIME = {
  html: "text/html",
  svg: "image/svg+xml",
  markdown: "text/markdown",
  css: "text/css",
  javascript: "text/javascript",
  json: "application/json",
  csv: "text/csv",
  xml: "application/xml",
  pdf: "application/pdf",
};

/** Language, labels and preview support for a named file. */
export function describeFile(name, fenceLanguage, content, complete = true) {
  const extension = /\.([a-z0-9]+)$/iu.exec(name)?.[1]?.toLowerCase() ?? "";
  const language =
    EXTENSION_LANGUAGE[extension] ??
    EXTENSION_LANGUAGE[fenceLanguage] ??
    (fenceLanguage && /^[a-z0-9+#-]{1,20}$/u.test(fenceLanguage) ? fenceLanguage : "text");
  const languageLabel =
    LANGUAGE_LABEL[language] ?? (extension ? extension.toUpperCase() : language.toUpperCase());
  const writing = language === "markdown" || language === "text" || language === "pdf";
  const preview =
    language === "html" || language === "svg" || language === "markdown" || language === "pdf";
  const stem =
    name
      .replace(/\.[^.]+$/u, "")
      .replace(/[-_]+/gu, " ")
      .trim() || name;
  return {
    name,
    title: stem.charAt(0).toUpperCase() + stem.slice(1),
    language,
    languageLabel,
    category: writing ? "Document" : "Code",
    preview,
    mime:
      language === "pdf" ? "application/pdf" : (MIME[language] ?? "text/plain") + ";charset=utf-8",
    content,
    complete,
    lines: content ? content.split("\n").length : 0,
  };
}

/** One-line summary for the activity row above a response that created files. */
export function summarizeCreatedFiles(files) {
  const names = [...new Set(files.filter((file) => file.complete).map((file) => file.name))];
  if (!names.length) return null;
  return names.length === 1 ? "Created a file" : `Created ${names.length} files`;
}

const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

/**
 * A preview document for a sandboxed iframe (sandbox="allow-scripts", never
 * allow-same-origin): an opaque origin with no cookies, storage, network, forms,
 * popups or top-level navigation. The policy is injected first so it applies before
 * any of the file's own markup.
 */
export function buildFilePreviewDocument(file) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  if (file.language === "svg") {
    return `<!doctype html><html><head><meta charset="utf-8">${meta.replace("script-src 'unsafe-inline'", "script-src 'none'")}<style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100vh}</style></head><body>${file.content.replace(/<script\b[\s\S]*?<\/script>/giu, "")}</body></html>`;
  }
  // The policy always comes first, even if the file's markup tries to hide its own <head>
  // in a comment; the parser then merges the file's <html>/<head> into this document.
  const source = file.content.replace(/^\s*<!doctype[^>]*>/iu, "");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${meta}${source}`;
}
