import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { signEmailWorkerRequest } from "../../src/lib/kova-email-worker-auth.server.mjs";
import { parseAzureDirectPublicOrigin } from "../../src/lib/azure-direct-origin.server.mjs";

const DEFAULT_ORIGIN = "https://kovagpt.com";
const fail = () => {
  throw new Error("kova_email_worker_invocation_unconfirmed");
};

/** Entry point for an existing authorized durable scheduler. This creates no
 * timer, credential or infrastructure. Its destination is either the existing
 * Kova origin or the explicitly configured production Azure app HTTPS origin. */
export async function invokeProductionEmailWorker({
  env = process.env,
  fetcher = fetch,
  now = Date.now,
  newId = randomUUID,
} = {}) {
  if (env.KOVA_EMAIL_WORKER_OPERATOR_ENABLED !== "true")
    return { execution_enabled: false, reason: "operator_disabled" };
  const originMode = env.KOVA_PRODUCTION_ORIGIN_MODE;
  const origin =
    originMode === undefined || originMode === "cloudflare"
      ? DEFAULT_ORIGIN
      : originMode === "azure-direct" && env.AZURE_ENVIRONMENT === "production"
        ? parseAzureDirectPublicOrigin(env)
        : null;
  if (!origin) fail();
  const url = `${origin}/api/internal/email-dispatch`;
  const run = { runId: newId(), issuedAt: new Date(now()).toISOString() };
  const signature = signEmailWorkerRequest(run, env.KOVA_EMAIL_WORKER_SECRET);
  try {
    const response = await fetcher(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      headers: {
        "Content-Type": "application/json",
        "X-Kova-Email-Run-Id": run.runId,
        "X-Kova-Email-Issued-At": run.issuedAt,
        "X-Kova-Email-Signature": signature,
      },
      body: "{}",
    });
    const reader = response.body?.getReader();
    if (!reader) fail();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8192) {
          await reader.cancel();
          fail();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      !response.ok ||
      result?.ok !== true ||
      typeof result.claimed !== "boolean" ||
      !Number.isInteger(result.attempted) ||
      result.attempted < 0 ||
      result.attempted > 2
    )
      fail();
    // Only fixed scalar receipt fields leave the operator. Never echo a remote
    // error, response body, recipient, scope, signature or credential.
    return { ok: true, claimed: result.claimed, attempted: result.attempted, runId: run.runId };
  } catch {
    fail();
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length !== 1 || argv[0] !== "--execute")
    return { execution_enabled: false, reason: "explicit_execute_required" };
  return invokeProductionEmailWorker({ env });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(await main())}\n`);
  } catch {
    process.stderr.write('{"error":"kova_email_worker_invocation_unconfirmed"}\n');
    process.exitCode = 1;
  }
}
