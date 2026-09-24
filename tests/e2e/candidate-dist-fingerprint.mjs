import { createHash } from "node:crypto";
import { readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

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
      files.push({ absolutePath, relativePath, link: entry.isSymbolicLink() });
    } else {
      throw new Error(`Unexpected entry in candidate dist: ${relativePath}`);
    }
  }
  return files;
}

export async function fingerprintDist(directory) {
  const hash = createHash("sha256");
  const files = await listEntries(directory);
  hash.update(`files:${files.length}\0`);
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.link ? "\0link\0" : "\0file\0");
    hash.update(file.link ? await readlink(file.absolutePath) : await readFile(file.absolutePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}
