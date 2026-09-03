export type ArtifactKind = "writing" | "code" | "website";

const PREVIEW_CSP =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; font-src data:;\">";

function splitEditorBlocks(value: string): string[] {
  const parts = value
    .split(/\n?\/\/ --- Block \d+ ---\n?/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [value];
}

function looksLikeCss(piece: string): boolean {
  const text = piece.trim();
  if (text.startsWith("<")) return false;
  return /[^{}]+\{[^}]*[a-z-]+\s*:\s*[^}]+\}/i.test(text) && !/<[a-z!/]/i.test(text);
}

function stripUnsafe(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "blocked:");
}

export function buildPreviewDoc(value: string): { doc: string; hadScripts: boolean } {
  const blocks = splitEditorBlocks(value);
  const cssParts: string[] = [];
  const htmlParts: string[] = [];
  for (const block of blocks) {
    if (looksLikeCss(block)) cssParts.push(block);
    else htmlParts.push(block);
  }
  const rawHtml = htmlParts.join("\n").trim();
  const hadScripts = /<script\b|\son[a-z]+\s*=|javascript:/i.test(rawHtml);
  const sanitized = stripUnsafe(rawHtml);
  const css = cssParts.join("\n\n");
  const styleTag = css ? `<style>${css}</style>` : "";
  const hasFullDoc = /<html[\s>]/i.test(sanitized) || /<!doctype/i.test(sanitized);
  let doc: string;
  if (hasFullDoc) {
    if (/<head[\s>]/i.test(sanitized)) {
      doc = sanitized.replace(/<head([^>]*)>/i, `<head$1>${PREVIEW_CSP}${styleTag}`);
    } else if (/<html[\s>]/i.test(sanitized)) {
      doc = sanitized.replace(/<html([^>]*)>/i, `<html$1><head>${PREVIEW_CSP}${styleTag}</head>`);
    } else {
      doc = `${PREVIEW_CSP}${styleTag}${sanitized}`;
    }
  } else {
    doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${PREVIEW_CSP}<base target="_blank">${styleTag}</head><body>${sanitized}</body></html>`;
  }
  return { doc, hadScripts };
}

export function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const pattern = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) blocks.push(match[1].replace(/\s+$/, ""));
  return blocks;
}

export function detectArtifactKind(text: string): ArtifactKind | null {
  const blocks = extractCodeBlocks(text);
  if (blocks.length > 0) {
    const all = blocks.join("\n").toLowerCase();
    const looksWebsite =
      /<html|<!doctype|<body|<head|<div[\s>]|<section|<main|className=|class=/.test(all) ||
      /export\s+default\s+function\s+\w+\s*\(/.test(all);
    return looksWebsite ? "website" : "code";
  }
  if (text.length >= 600 || text.split(/\n+/).length >= 8) return "writing";
  return null;
}
