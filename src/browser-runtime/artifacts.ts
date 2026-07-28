import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export class BrowserArtifactStore {
  readonly #root: string;
  constructor(root: string) {
    this.#root = resolve(root);
  }

  async initializeSession(sessionId: string) {
    const path = this.sessionPath(sessionId);
    await mkdir(path, { recursive: true, mode: 0o700 });
    return path;
  }

  async writePng(sessionId: string, bytes: Buffer) {
    const id = randomUUID();
    const directory = await this.initializeSession(sessionId);
    const file = join(directory, `${id}.png`);
    const temporary = `${file}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
    return {
      id,
      storageKey: `${sessionId}/${id}.png`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async read(storageKey: string) {
    const path = resolve(this.#root, storageKey);
    if (!path.startsWith(`${this.#root}/`)) throw new Error("Invalid artifact key");
    return readFile(path);
  }

  async removeSession(sessionId: string) {
    await rm(this.sessionPath(sessionId), { recursive: true, force: true });
  }

  private sessionPath(sessionId: string) {
    if (!/^[a-f0-9-]{36}$/.test(sessionId)) throw new Error("Invalid session id");
    return join(this.#root, sessionId);
  }
}
