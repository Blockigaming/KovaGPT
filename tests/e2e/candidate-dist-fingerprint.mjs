import { createHash } from "node:crypto";
import { readdir, readFile, readlink } from "node:fs/promises";
import { join, relative } from "node:path";

async function listEntries(directory, prefix = "") {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(directory, entry.name);
    const relativePath = join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listEntries(absolutePath, relativePath)));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push({ absolutePath, relativePath, symbolicLink: entry.isSymbolicLink() });
    } else {
      throw new Error(`Unexpected entry in candidate dist: ${relative(directory, absolutePath)}`);
    }
  }
  return files;
}

export async function fingerprint(directory) {
  const hash = createHash("sha256");
  const files = await listEntries(directory);
  hash.update(`files:${files.length}\0`);
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(file.symbolicLink ? "link\0" : "file\0");
    hash.update(
      file.symbolicLink ? await readlink(file.absolutePath) : await readFile(file.absolutePath),
    );
    hash.update("\0");
  }
  return hash.digest("hex");
}
