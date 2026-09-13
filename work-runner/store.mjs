import { mkdir, open, readFile, readdir, rename, stat, unlink, link } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
const ownerLocks = new AsyncLocalStorage();
import { createHash, randomUUID } from "node:crypto";

/** Private durable JSON records; paths are hashes, never task-provided filenames. */
export class WorkAttemptStore {
  constructor(directory, { maxRecords = 1000, maxBytes = 1024 * 1024 * 1024 } = {}) {
    if (!path.isAbsolute(directory)) throw new Error("work_store_path_invalid");
    this.directory = directory;
    this.maxRecords = maxRecords;
    this.maxBytes = maxBytes;
    this.serial = Promise.resolve();
  }
  withOwnerLock(ownerId, fn, exclusive = false) {
    return this.withLock(`owner-${this.ownerKey(ownerId)}`, fn, exclusive);
  }
  async withLock(name, fn, exclusive = true) {
    const key = this.directory + ":" + name + ":" + exclusive;
    if (ownerLocks.getStore()?.has(key)) return fn();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = path.join(this.directory, `state-lock-${name}`);
    const handle = await open(lockPath, "a", 0o600);
    await handle.close();
    // Fixed infrastructure helper only: no shell and no task-supplied program.
    // flock is kernel-owned; parent death closes stdin and releases the lock.
    const child = spawn(
      "/usr/bin/flock",
      [
        exclusive ? "--exclusive" : "--shared",
        "--timeout",
        "10",
        lockPath,
        process.execPath,
        "-e",
        "process.stdout.write('locked');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));",
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    child.stdin.on("error", () => {});
    let acquired = false;
    const ended = new Promise((resolve) => child.once("close", resolve));
    try {
      await new Promise((resolve, reject) => {
        child.once("error", () => reject(new Error("work_owner_lock_unavailable")));
        child.once("close", () => {
          if (!acquired) reject(new Error("work_owner_lock_unavailable"));
        });
        child.stdout.once("data", (data) => {
          if (data.toString() === "locked") {
            acquired = true;
            resolve();
          } else reject(new Error("work_owner_lock_unavailable"));
        });
      });
      return await ownerLocks.run(new Set([...(ownerLocks.getStore() ?? []), key]), fn);
    } finally {
      child.stdin.end();
      if (!acquired) child.kill();
      await ended;
    }
  }
  mutateOwner(ownerId, fn, exclusive = false) {
    return this.withOwnerLock(
      ownerId,
      () =>
        this.withLock("record-writes", () => {
          const action = this.serial.then(fn);
          this.serial = action.catch(() => undefined);
          return action;
        }),
      exclusive,
    );
  }
  key(binding) {
    return createHash("sha256")
      .update(`${binding.runId}:${binding.epoch}:${binding.stepId}`)
      .digest("hex");
  }
  ownerKey(ownerId) {
    return createHash("sha256").update(ownerId).digest("hex");
  }
  async ownerRetired(ownerId) {
    try {
      await stat(path.join(this.directory, `retired-${this.ownerKey(ownerId)}`));
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }
  async retireOwner(ownerId) {
    const action = this.serial.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const file = await open(
        path.join(this.directory, `retired-${this.ownerKey(ownerId)}`),
        "a",
        0o600,
      );
      try {
        await file.sync();
      } finally {
        await file.close();
      }
      const dir = await open(this.directory, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    });
    this.serial = action.catch(() => undefined);
    return action;
  }
  async purgeOwner(ownerId) {
    const action = this.mutateOwner(
      ownerId,
      async () => {
        if (!(await this.ownerRetired(ownerId))) throw new Error("work_owner_retirement_required");
        const names = (await readdir(this.directory)).filter((name) =>
          /^[a-f0-9]{64}\.json$/.test(name),
        );
        for (const name of names) {
          const target = path.join(this.directory, name);
          const row = JSON.parse(await readFile(target, "utf8"));
          if (row.ownerId === ownerId) await unlink(target);
        }
        const dir = await open(this.directory, "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      },
      true,
    );
    return action;
  }
  async get(binding) {
    try {
      return JSON.parse(
        await readFile(path.join(this.directory, `${this.key(binding)}.json`), "utf8"),
      );
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async create(binding, value) {
    return this.put(binding, value, { createOnly: true });
  }
  async put(binding, value, { createOnly = false } = {}) {
    const operation = this.mutateOwner(value.ownerId, async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (await this.ownerRetired(value.ownerId)) throw new Error("work_owner_retired");
      let raw = JSON.stringify(value),
        bytes = Buffer.byteLength(raw);
      if (bytes > 16 * 1024 * 1024) throw new Error("work_store_record_limit");
      const names = (await readdir(this.directory)).filter((name) =>
        /^[a-f0-9]{64}\.json$/.test(name),
      );
      if (names.length > this.maxRecords) throw new Error("work_store_capacity");
      const destination = path.join(this.directory, `${this.key(binding)}.json`);
      let existing = 0;
      try {
        existing = (await stat(destination)).size;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (existing) {
        const previous = await this.get(binding);
        if (createOnly) return { created: false, value: previous };
        if (previous?.status === "not_executed" && JSON.stringify(previous) !== raw)
          throw new Error("work_attempt_sealed");
        if (previous?.status === "cancelled" || value.status === "cancelled") {
          value = {
            ...value,
            status: "cancelled",
            ...(!value.receipt && previous?.receipt ? { receipt: previous.receipt } : {}),
            ...(!value.artifacts && previous?.artifacts ? { artifacts: previous.artifacts } : {}),
          };
          raw = JSON.stringify(value);
          bytes = Buffer.byteLength(raw);
          if (bytes > 16 * 1024 * 1024) throw new Error("work_store_record_limit");
        }
      }
      if (!existing && names.length >= this.maxRecords) throw new Error("work_store_capacity");
      let total = 0;
      for (const name of names) total += (await stat(path.join(this.directory, name))).size;
      if (total - existing + bytes > this.maxBytes) throw new Error("work_store_capacity");
      const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(raw);
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (createOnly) {
        try {
          await link(temporary, destination);
        } catch (error) {
          await unlink(temporary).catch(() => {});
          if (error.code === "EEXIST") return { created: false, value: await this.get(binding) };
          throw error;
        }
        await unlink(temporary);
      } else await rename(temporary, destination);
      const directory = await open(this.directory, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      return createOnly ? { created: true, value } : value;
    });
    return operation;
  }
}
