import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const runFile = promisify(execFile);

test("legacy crypto loads without native Argon2 and unavailable Argon2 fails closed on use", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kova-native-load-"));
  const marker = join(directory, "native-resolution-attempted");
  const loader = join(directory, "block-argon2.mjs");
  try {
    await writeFile(
      loader,
      `import { writeFileSync } from "node:fs";
export function resolve(specifier, context, nextResolve) {
  if (specifier === "argon2") {
    writeFileSync(${JSON.stringify(marker)}, "attempted");
    throw new Error("Synthetic native module unavailable");
  }
  return nextResolve(specifier, context);
}
`,
    );
    const cryptoModule = new URL("../../src/lib/kova-auth-crypto.server.mjs", import.meta.url);
    const { stdout, stderr } = await runFile(
      process.execPath,
      [
        "--no-warnings",
        "--experimental-loader",
        pathToFileURL(loader).href,
        "--input-type=module",
        "--eval",
        `import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  hashKovaPassword, verifyKovaPassword, rehashKovaPassword,
  KovaPasswordInfrastructureError,
} from ${JSON.stringify(cryptoModule.href)};
const marker = ${JSON.stringify(marker)};
const password = "nonsecret-password-fixture";
assert.equal(existsSync(marker), false);
const legacy = await hashKovaPassword(password, {});
assert.match(legacy, /^scrypt-v1\\$32768\\$8\\$1\\$/u);
assert.equal(await verifyKovaPassword(password, legacy), true);
assert.equal(await verifyKovaPassword("wrong", legacy), false);
assert.equal(existsSync(marker), false);
const syntheticArgon = "$argon2id$v=19$m=19456,p=1,t=2$" +
  Buffer.alloc(16).toString("base64").replace(/=+$/u, "") + "$" +
  Buffer.alloc(32).toString("base64").replace(/=+$/u, "");
for (const operation of [
  () => hashKovaPassword(password, { KOVA_AUTH_PASSWORD_HASH_WRITE: "argon2id" }),
  () => verifyKovaPassword(password, syntheticArgon),
  () => rehashKovaPassword(password),
]) {
  await assert.rejects(operation, (error) =>
    error instanceof KovaPasswordInfrastructureError &&
    error.code === "kova_password_infrastructure" &&
    error.message === "Password processing is temporarily unavailable");
}
assert.equal(existsSync(marker), true);
console.log("PASS");
`,
      ],
      { timeout: 15_000 },
    );
    assert.equal(stdout.trim(), "PASS");
    assert.equal(stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
