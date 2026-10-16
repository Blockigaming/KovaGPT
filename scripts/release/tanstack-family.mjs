import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Keep the direct pins and the security-sensitive server transport together.
// GHSA-qx66-fv34-fjm8 requires both react-start and start-server-core to be patched.
export const approvedTanstackFamily = {
  "@tanstack/react-start": "1.168.60",
  "@tanstack/react-router": "1.170.41",
  "@tanstack/router-plugin": "1.168.42",
  "@tanstack/router-core": "1.171.34",
  "@tanstack/history": "1.162.4",
  "@tanstack/start-server-core": "1.169.39",
  seroval: "1.6.9",
};

export async function verifyTanstackFamily(root = new URL("../../", import.meta.url)) {
  const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
  const manifest = await readJson("package.json");
  const lock = await readJson("package-lock.json");

  for (const [name, version] of Object.entries(approvedTanstackFamily)) {
    if (name !== "@tanstack/start-server-core") {
      if (
        manifest.dependencies?.[name] !== version ||
        lock.packages?.[""]?.dependencies?.[name] !== version
      )
        throw new Error(`Unapproved TanStack manifest pin for ${name}`);
    }

    const rootPath = `node_modules/${name}`;
    if (!lock.packages?.[rootPath]) throw new Error(`Missing TanStack lock entry for ${name}`);
    // Inspect every copy, so a patched root cannot hide a vulnerable nested transport.
    for (const [path, pkg] of Object.entries(lock.packages)) {
      if (path !== rootPath && !path.endsWith(`/${rootPath}`)) continue;
      if (pkg.version !== version)
        throw new Error(`Unapproved TanStack lock resolution for ${path}: ${pkg.version}`);
      const installed = await readJson(`${path}/package.json`);
      if (installed.version !== version)
        throw new Error(
          `Unapproved TanStack installed resolution for ${path}: ${installed.version}`,
        );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyTanstackFamily();
  console.log("Approved TanStack package family verified, including all locked server transports.");
}
