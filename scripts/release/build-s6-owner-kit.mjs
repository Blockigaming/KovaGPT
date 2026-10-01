import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { requiredDeployedChecks } from "./kova-auth-cutover-gate.mjs";

const output = resolve(process.argv[2] ?? "/tmp/kova-s6-owner-kit");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["scripts/release/s6-owner-session.mjs"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: join(output, "owner.cjs"),
  external: ["@playwright/test"],
  logLevel: "warning",
  plugins: [
    {
      name: "gate-constants-only",
      setup(b) {
        b.onLoad({ filter: /kova-auth-cutover-gate\.mjs$/ }, () => ({
          contents: `export const requiredDeployedChecks=${JSON.stringify(requiredDeployedChecks)}`,
          loader: "js",
        }));
      },
    },
  ],
});
const rootLock = JSON.parse(await readFile("package-lock.json", "utf8"));
const version = rootLock.packages["node_modules/@playwright/test"].version;
const pkg = {
  name: "kova-s6-owner-session",
  version: "1.0.0",
  private: true,
  engines: { node: ">=22.0.0" },
  dependencies: { "@playwright/test": version },
  scripts: {
    "prepare-browser": "playwright install chromium",
    start: "node owner.cjs --owner-relay-authorized",
  },
};
const packages = { "": pkg };
for (const path of [
  "node_modules/@playwright/test",
  "node_modules/playwright",
  "node_modules/playwright-core",
  "node_modules/playwright/node_modules/fsevents",
])
  if (rootLock.packages[path]) {
    packages[path] = { ...rootLock.packages[path] };
    delete packages[path].dev;
  }
await writeFile(join(output, "package.json"), JSON.stringify(pkg, null, 2));
await writeFile(
  join(output, "package-lock.json"),
  JSON.stringify(
    { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages },
    null,
    2,
  ),
);
await writeFile(
  join(output, "README.txt"),
  `S6 single owner session — dedicated disposable Google identity only\n\nBefore the live window, on the computer with your physical authenticator:\n  npm ci --ignore-scripts\n  npm run prepare-browser\n\nDuring the single authorized owner session, with the one-use invitation file:\n  npm start -- /absolute/path/to/s6-owner-invitation.json\n\nThe visible browser asks you to sign in/consent to Google and use your physical\nauthenticator. All remaining checks and receipt transfer run automatically.\nUse only the preflighted disposable Google identity shown for this session.\nDo not paste any secret into chat. The Google client secret is entered separately\nwith hidden input in the exact rehearsal Cloud Shell control command.\n\nNo virtual authenticator, trace, HAR, video, persisted browser profile, or account\npassword collection is used. A provider rejection stops the session; it is not bypassed.\nAfter completion remove the disposable passkey from your physical credential manager\nif it retains a local copy. The app credential is removed by the test automatically.\n`,
);
const sha256 = createHash("sha256")
  .update(await readFile(join(output, "owner.cjs")))
  .digest("hex");
await writeFile(
  join(output, "build-receipt.json"),
  JSON.stringify(
    {
      kind: "OFFLINE_OWNER_KIT",
      playwrightVersion: version,
      sha256,
      realGoogleOrPasskeyExecuted: false,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output, sha256, playwrightVersion: version }));
