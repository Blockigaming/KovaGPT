import { readFile } from "node:fs/promises";
const approved = {
  "@tanstack/react-start": "1.168.60",
  "@tanstack/react-router": "1.170.41",
  "@tanstack/router-plugin": "1.168.42",
  "@tanstack/router-core": "1.171.34",
  "@tanstack/history": "1.162.4",
};
for (const [name, version] of Object.entries(approved)) {
  const pkg = JSON.parse(
    await readFile(new URL(`../../node_modules/${name}/package.json`, import.meta.url)),
  );
  if (pkg.version !== version)
    throw new Error(`Unapproved TanStack resolution for ${name}: ${pkg.version}`);
}
console.log("Approved TanStack package family verified.");
