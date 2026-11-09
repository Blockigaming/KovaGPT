import {
  chmodSync,
  lstatSync,
  realpathSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, extname, join, relative, resolve, sep } from "node:path";

const MAX_TEXT_BYTES = 512 * 1024;
const MAX_LIST = 200;
const MAX_DEPTH = 8;
const SOURCE_SUFFIXES = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".html",
  ".css",
  ".scss",
  ".sql",
  ".xml",
  ".toml",
  ".sh",
]);
const SKIP_DIRS = new Set([
  ".git",
  ".github",
  ".vscode",
  "node_modules",
  "dist",
  "build",
  "target",
  "coverage",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
]);

export const MAX_WORKSPACE_TEXT_BYTES = MAX_TEXT_BYTES;

function digest(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function validParts(relativePath, allowRoot = false) {
  if (relativePath === "" && allowRoot) return [];
  if (
    typeof relativePath !== "string" ||
    relativePath.length < 1 ||
    relativePath.length > 1024 ||
    relativePath.includes("\\") ||
    relativePath.includes("\u0000") ||
    relativePath.startsWith("/") ||
    relativePath.includes(":")
  )
    throw new Error("Invalid workspace path");
  const parts = relativePath.split("/");
  if (
    parts.length > MAX_DEPTH ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.startsWith(".") ||
        part.length > 180 ||
        /[\x00-\x1f]/u.test(part),
    )
  )
    throw new Error("Workspace path is not permitted");
  return parts;
}
function textContent(bytes) {
  if (bytes.byteLength > MAX_TEXT_BYTES) throw new Error("File is too large");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\u0000")) throw new Error("Binary files cannot be opened");
  return text;
}

/** Native-only, explicit-folder file scope. Never expose this object to a remote renderer. */
export function createLocalWorkspace() {
  let root = null;
  const opened = new Map();

  function chosenRoot() {
    if (!root) throw new Error("Choose a repository folder first");
    return root;
  }
  function checked(relativePath, expectDirectory = false, allowRoot = false) {
    const base = chosenRoot();
    const parts = validParts(relativePath, allowRoot);
    const candidate = resolve(base, ...parts);
    const actual = realpathSync(candidate);
    if (actual !== base && !actual.startsWith(base + sep))
      throw new Error("Path escapes selected repository");
    if (parts.length && lstatSync(candidate).isSymbolicLink())
      throw new Error("Symbolic links are not opened");
    const stats = statSync(actual);
    if (expectDirectory ? !stats.isDirectory() : !stats.isFile())
      throw new Error("Unsupported file type");
    if (!expectDirectory && !SOURCE_SUFFIXES.has(extname(actual).toLowerCase()))
      throw new Error("Unsupported source-file extension");
    return { actual, stats };
  }
  function inspectText(relativePath) {
    const { actual, stats } = checked(relativePath);
    if (stats.size > MAX_TEXT_BYTES) throw new Error("File is too large");
    const content = textContent(readFileSync(actual));
    return { content, hash: digest(content) };
  }

  return {
    chooseFolder(folder) {
      if (typeof folder !== "string") throw new Error("Folder must be selected");
      const target = realpathSync(folder);
      if (!statSync(target).isDirectory()) throw new Error("Choose a directory");
      root = target;
      opened.clear();
      return { name: basename(root), selected: true };
    },
    // Main-process use only. Never return this absolute path through renderer IPC.
    executionRoot() {
      return chosenRoot();
    },
    info() {
      return { name: root ? basename(root) : null, selected: Boolean(root) };
    },
    list(directory = "") {
      const { actual } = checked(directory, true, true);
      const prefix = directory ? directory + "/" : "";
      const result = [];
      for (const entry of readdirSync(actual, { withFileTypes: true })) {
        if (result.length >= MAX_LIST) break;
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        const path = prefix + entry.name;
        if (entry.isDirectory() && validParts(path).length < MAX_DEPTH)
          result.push({ name: entry.name, path, kind: "directory" });
        else if (entry.isFile() && SOURCE_SUFFIXES.has(extname(entry.name).toLowerCase()))
          result.push({ name: entry.name, path, kind: "file" });
      }
      return result;
    },
    open(relativePath) {
      const file = inspectText(relativePath);
      opened.set(relativePath, file.hash);
      return { path: relativePath, ...file };
    },
    preview(relativePath, proposedContent, expectedHash) {
      if (
        typeof proposedContent !== "string" ||
        Buffer.byteLength(proposedContent, "utf8") > MAX_TEXT_BYTES
      )
        throw new Error("Edited text is too large");
      const original = opened.get(relativePath);
      if (!original || original !== expectedHash)
        throw new Error("File must be opened before editing");
      const onDisk = inspectText(relativePath);
      if (onDisk.hash !== expectedHash) throw new Error("File has changed on disk");
      const before = onDisk.content.split("\n");
      const after = proposedContent.split("\n");
      let first = 0;
      while (first < Math.min(before.length, after.length) && before[first] === after[first])
        first++;
      let oldEnd = before.length;
      let newEnd = after.length;
      while (oldEnd > first && newEnd > first && before[oldEnd - 1] === after[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      return {
        changed: proposedContent !== onDisk.content,
        beforeLines: before.slice(first, Math.min(oldEnd, first + 80)),
        afterLines: after.slice(first, Math.min(newEnd, first + 80)),
        firstLine: first + 1,
        truncated: oldEnd - first > 80 || newEnd - first > 80,
      };
    },
    save(relativePath, content, expectedHash) {
      // Must have been opened and previewed. The caller must separately
      // confirm saving through a native dialog before invoking this method.
      this.preview(relativePath, content, expectedHash);
      const { actual, stats } = checked(relativePath);
      const temporary = join(resolve(actual, ".."), `.kova-edit-${randomUUID()}.tmp`);
      try {
        writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
        // Preserve ordinary permissions, including source scripts' executable bits.
        chmodSync(temporary, stats.mode & 0o777);
        if (inspectText(relativePath).hash !== expectedHash)
          throw new Error("File changed before save");
        renameSync(temporary, actual);
      } finally {
        try {
          unlinkSync(temporary);
        } catch {
          /* Already moved or never written. */
        }
      }
      const result = inspectText(relativePath);
      opened.set(relativePath, result.hash);
      return { path: relativePath, hash: result.hash };
    },
    close() {
      root = null;
      opened.clear();
    },
  };
}
