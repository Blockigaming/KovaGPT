import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { workUuid } from "../src/lib/work-execution-protocol.mjs";
const PREFIX = ["--host", "unix:///var/run/docker.sock"];
const LABEL = "com.kova.browser=interactive-v1";
const ENV = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" };
const fail = () => {
  throw new Error("work_browser_isolation_unavailable");
};

/** Fixed CLI only. No user command, host mount, environment inheritance or browser network. */
export function createBrowserContainerFactory({ image }, spawnChild = spawn) {
  if (!/^(?:[a-z0-9][a-z0-9._/:-]{0,199}@)?sha256:[a-f0-9]{64}$/.test(image ?? "")) fail();
  function command(args) {
    return new Promise((resolve, reject) => {
      const child = spawnChild("/usr/bin/docker", [...PREFIX, ...args], {
        shell: false,
        env: ENV,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "",
        size = 0,
        done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ok ? resolve(output.trim()) : reject(new Error("work_browser_isolation_unavailable"));
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(false);
      }, 10000);
      child.stdout.on("data", (chunk) => {
        size += chunk.length;
        if (size > 65536) {
          child.kill("SIGKILL");
          finish(false);
        } else output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        size += chunk.length;
        if (size > 65536) {
          child.kill("SIGKILL");
          finish(false);
        }
      });
      child.on("error", () => finish(false));
      child.on("close", (code) => finish(code === 0));
    });
  }
  async function remove(name) {
    try {
      await command(["rm", "--force", name]);
    } catch {
      const names = await command(["ps", "-aq", "--filter", `name=^/${name}$`]);
      if (names) fail();
    }
  }
  return {
    async probe() {
      const info = JSON.parse(await command(["info", "--format", "{{json .}}"]));
      if (info.OSType !== "linux" || !info.Runtimes?.runsc) fail();
      const row = JSON.parse(await command(["image", "inspect", image]));
      if (
        row.length !== 1 ||
        row[0].Os !== "linux" ||
        row[0].Config?.User !== "65532:65532" ||
        row[0].Config?.Labels?.["com.kova.browser.protocol"] !== "kova-browser-v1"
      )
        fail();
      return true;
    },
    async closeOwner(ownerId) {
      workUuid(ownerId);
      const raw = await command([
        "ps",
        "-aq",
        "--filter",
        `label=${LABEL}`,
        "--filter",
        `label=com.kova.browser.owner=${ownerId}`,
      ]);
      const ids = raw ? raw.split(/\s+/) : [];
      if (ids.length > 128 || ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) fail();
      for (const id of ids) await remove(id);
      if (
        await command([
          "ps",
          "-aq",
          "--filter",
          `label=${LABEL}`,
          "--filter",
          `label=com.kova.browser.owner=${ownerId}`,
        ])
      )
        fail();
    },
    async reapExpired() {
      const raw = await command(["ps", "-aq", "--filter", `label=${LABEL}`]);
      const ids = raw ? raw.split(/\s+/) : [];
      if (ids.length > 128 || ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) fail();
      for (const id of ids) {
        const [row] = JSON.parse(await command(["inspect", id]));
        const expiry = Number(row?.Config?.Labels?.["com.kova.browser.expires"]);
        if (!Number.isSafeInteger(expiry) || expiry <= Date.now()) await remove(id);
      }
    },
    async create({ ownerId, sessionId, expiresAt, onNetwork }) {
      workUuid(ownerId);
      workUuid(sessionId);
      if (
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= Date.now() ||
        expiresAt > Date.now() + 300000
      )
        fail();
      const name = `kova-browser-${sessionId}`;
      try {
        await command([
          "create",
          "--name",
          name,
          "--label",
          LABEL,
          "--label",
          `com.kova.browser.owner=${ownerId}`,
          "--label",
          `com.kova.browser.expires=${expiresAt}`,
          "--env",
          `KOVA_BROWSER_EXPIRES_AT=${expiresAt}`,
          "--runtime",
          "runsc",
          "--network",
          "none",
          "--read-only",
          "--user",
          "65532:65532",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--cgroupns",
          "private",
          "--memory",
          "768m",
          "--memory-swap",
          "768m",
          "--cpus",
          "1",
          "--pids-limit",
          "128",
          "--log-driver",
          "none",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,noexec,size=128m,uid=65532,gid=65532",
          "--tmpfs",
          "/home/browser:rw,nosuid,nodev,noexec,size=64m,uid=65532,gid=65532",
          "--shm-size",
          "128m",
          "--interactive",
          image,
        ]);
        const child = spawnChild(
          "/usr/bin/docker",
          [...PREFIX, "start", "--attach", "--interactive", name],
          { shell: false, env: ENV, stdio: ["pipe", "pipe", "pipe"] },
        );
        let buffer = "",
          closed = false,
          networkActive = 0,
          networkCount = 0,
          networkBytes = 0,
          outputBytes = 0;
        const decoder = new StringDecoder("utf8"),
          pending = new Map();
        let readyResolve, readyReject;
        const ready = new Promise((resolve, reject) => {
          readyResolve = resolve;
          readyReject = reject;
        });
        const send = (message) => {
          const raw = JSON.stringify(message);
          if (closed || Buffer.byteLength(raw) > 3000000 || child.stdin.writableLength > 6000000)
            fail();
          child.stdin.write(raw + "\n");
        };
        const stop = () => {
          if (closed) return;
          closed = true;
          readyReject(new Error("work_browser_closed"));
          for (const row of pending.values()) {
            clearTimeout(row.timer);
            row.reject(new Error("work_browser_closed"));
          }
          pending.clear();
          child.kill("SIGKILL");
        };
        child.on("error", stop);
        child.on("close", stop);
        child.stderr.on("data", () => stop());
        child.stdout.on("data", (chunk) => {
          outputBytes += chunk.length;
          buffer += decoder.write(chunk);
          if (Buffer.byteLength(buffer) > 3000000 || outputBytes > 4000000) {
            stop();
            return;
          }
          for (;;) {
            const end = buffer.indexOf("\n");
            if (end < 0) break;
            const raw = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            let message;
            try {
              message = JSON.parse(raw);
            } catch {
              stop();
              return;
            }
            if (message.kind === "ready" && message.protocol === "kova-browser-v1") {
              readyResolve();
              continue;
            }
            if (message.kind === "result") {
              const row = pending.get(message.id);
              if (!row) {
                stop();
                return;
              }
              pending.delete(message.id);
              clearTimeout(row.timer);
              message.error
                ? row.reject(new Error("work_browser_action_denied"))
                : row.resolve(message.result);
              continue;
            }
            if (message.kind !== "network" || networkActive >= 8 || ++networkCount > 500) {
              stop();
              return;
            }
            networkActive++;
            void Promise.resolve()
              .then(() => onNetwork(message.request, message.authority))
              .then((result) => {
                networkBytes += Math.ceil(((result.bodyBase64?.length ?? 0) * 3) / 4);
                if (networkBytes > 20 * 1024 * 1024) fail();
                send({ kind: "network_result", id: message.id, result });
              })
              .catch(() => {
                try {
                  send({ kind: "network_result", id: message.id, error: true });
                } catch {
                  stop();
                }
              })
              .finally(() => networkActive--);
          }
        });
        const startTimer = setTimeout(stop, 15000);
        try {
          await ready;
        } finally {
          clearTimeout(startTimer);
        }
        const expiryTimer = setTimeout(
          () => {
            stop();
            void remove(name).catch(() => {});
          },
          Math.max(1, expiresAt - Date.now()),
        );
        expiryTimer.unref();
        return {
          async command(value) {
            if (closed || pending.size) fail();
            const id = randomUUID();
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => {
                stop();
                reject(new Error("work_browser_action_timeout"));
              }, 20000);
              pending.set(id, { resolve, reject, timer });
              try {
                send({ kind: "command", id, command: value });
              } catch (error) {
                clearTimeout(timer);
                pending.delete(id);
                reject(error);
              }
            });
          },
          async close() {
            clearTimeout(expiryTimer);
            stop();
            await remove(name);
          },
        };
      } catch (error) {
        await remove(name);
        throw error;
      }
    },
  };
}
