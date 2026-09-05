import { readFile } from "node:fs/promises";
import https from "node:https";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { parseWorkRunnerConfiguration } from "../src/lib/work-runner-transport.mjs";
import {
  canonicalWorkInput,
  WORK_EXECUTION_PROTOCOL,
} from "../src/lib/work-execution-protocol.mjs";
import { WorkAttemptStore } from "./store.mjs";
import { createWorkRunnerService } from "./service.mjs";
import { configuredProvider } from "./provider.mjs";
import { createWorkRenderer } from "./render.mjs";
import { createWorkActionBroker } from "./action-broker.mjs";
import { createBrowserContainerFactory } from "./browser-container.mjs";
import { createBrowserManager, withBrowserActions } from "./browser-manager.mjs";
import { createBrowserBackendAuthority } from "../src/lib/work-browser-transport.mjs";
import { createWorkBackend, probeWorkRunner } from "./backend.mjs";

/** Owner-configured standalone TLS service. Importing this module never starts it. */
export async function startConfiguredWorkRunner(env = process.env) {
  const configuration = parseWorkRunnerConfiguration({
    enabled: env.KOVA_WORK_RUNNER_ENABLED === "true",
    origin: env.KOVA_WORK_RUNNER_ORIGIN,
    id: env.KOVA_WORK_RUNNER_ID,
    build: env.KOVA_WORK_RUNNER_BUILD,
    token: env.KOVA_WORK_RUNNER_TOKEN,
    signingKey: env.KOVA_WORK_RUNNER_SIGNING_KEY,
  });
  if (!configuration) throw new Error("work_runner_disabled");
  const { createWorkSandboxExecutor } = await import("./sandbox-container.mjs");
  const sandbox = createWorkSandboxExecutor({
    enginePath: "/usr/bin/docker",
    image: env.KOVA_WORK_SANDBOX_IMAGE,
  });
  const operations = JSON.parse(env.KOVA_WORK_OPERATIONS_JSON ?? "[]");
  // Secrets remain on the isolated service. Every grant is explicitly scoped
  // to one provider operation and one account, with an expiry.
  const credentialFor = async (ownerId, operationId) => {
    if (!env.KOVA_WORK_GRANTS_FILE) return null;
    const raw = await readFile(env.KOVA_WORK_GRANTS_FILE, "utf8");
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error("work_grants_limit");
    return (
      JSON.parse(raw).find(
        (grant) => grant.ownerId === ownerId && grant.operationId === operationId,
      ) ?? null
    );
  };
  const store = new WorkAttemptStore(env.KOVA_WORK_STATE_DIR);
  await store.withOwnerLock("kova-state-readiness", async () => {});
  const browser =
    env.KOVA_WORK_BROWSER_ENABLED === "true"
      ? createBrowserManager({
          store,
          factory: createBrowserContainerFactory({ image: env.KOVA_WORK_BROWSER_IMAGE }),
          origins: JSON.parse(env.KOVA_WORK_BROWSER_ORIGINS_JSON ?? "[]"),
          authorize: createBrowserBackendAuthority(configuration, env.KOVA_WORK_BACKEND_ORIGIN),
        })
      : null;
  const actionBroker = withBrowserActions(
    createWorkActionBroker({ operations, credentialFor }),
    browser,
  );
  const provider = configuredProvider({
    responsesUrl: env.KOVA_WORK_RESPONSES_URL,
    providerKey: env.KOVA_WORK_PROVIDER_KEY,
    models: (env.KOVA_WORK_MODELS ?? "").split(",").filter(Boolean),
    modelCapabilities: env.KOVA_WORK_MODEL_CAPABILITIES_JSON
      ? JSON.parse(env.KOVA_WORK_MODEL_CAPABILITIES_JSON)
      : undefined,
    actionBroker,
    sandbox,
  });
  const office = await import("./build/office.mjs");
  const render = createWorkRenderer(await office.configuredOfficeWriters());
  let lastProbe = 0,
    closed = false,
    probeActive = false,
    drainActive = false;
  const notify = createWorkBackend(configuration, env.KOVA_WORK_BACKEND_ORIGIN);
  async function probe() {
    if (probeActive || closed) return;
    probeActive = true;
    try {
      await probeWorkRunner(sandbox, notify);
      await browser?.probe();
      lastProbe = Date.now();
    } catch {
      lastProbe = 0;
    } finally {
      probeActive = false;
    }
  }
  await sandbox.reapExpired();
  await probe();
  if (!lastProbe) throw new Error("work_runner_readiness_failed");
  const service = createWorkRunnerService({
    configuration,
    store,
    provider,
    render,
    notify,
    browser,
    readiness: async () => lastProbe > 0 && Date.now() - lastProbe < 30000,
  });
  const server = https.createServer(
    {
      key: await readFile(env.KOVA_WORK_TLS_KEY_FILE),
      cert: await readFile(env.KOVA_WORK_TLS_CERT_FILE),
      minVersion: "TLSv1.2",
      maxHeaderSize: 8192,
    },
    async (request, response) => {
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers))
          if (value) headers.set(name, Array.isArray(value) ? value.join(",") : value);
        const web = new Request(`${configuration.origin}${request.url}`, {
          method: request.method,
          headers,
          body: request.method === "POST" ? Readable.toWeb(request) : undefined,
          duplex: "half",
        });
        const result = await service.handle(web);
        response.writeHead(result.status, Object.fromEntries(result.headers));
        if (result.body) Readable.fromWeb(result.body).pipe(response);
        else response.end();
      } catch {
        response.writeHead(503);
        response.end();
      }
    },
  );
  server.requestTimeout = 40000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 64;
  const port = Number(env.KOVA_WORK_LISTEN_PORT ?? 8443);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error("work_listener_configuration_invalid");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  const probeTimer = setInterval(() => void probe(), 10000);
  const drainTimer = setInterval(async () => {
    if (closed || drainActive || !lastProbe) return;
    drainActive = true;
    try {
      await service.drain();
    } catch {
      /* Durable DB queue remains for the next bounded drain. */
    } finally {
      drainActive = false;
    }
  }, 5000);
  const cleanupTimer = setInterval(() => void sandbox.reapExpired().catch(() => undefined), 60000);
  return {
    server,
    async close() {
      closed = true;
      clearInterval(probeTimer);
      clearInterval(drainTimer);
      clearInterval(cleanupTimer);
      service.close();
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startConfiguredWorkRunner()
    .then((runtime) => {
      for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => void runtime.close());
    })
    .catch(() => {
      process.stderr.write(
        "Work runner startup failed; verify the configured provider, isolation, identity, TLS, and backend readiness.\n",
      );
      process.exitCode = 1;
    });
}
