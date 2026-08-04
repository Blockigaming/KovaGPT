import { readFile } from "node:fs/promises";
const approved = {
  "@tanstack/react-start": "1.168.34",
  "@tanstack/react-router": "1.170.18",
  "@tanstack/router-plugin": "1.168.23",
  "@tanstack/router-core": "1.171.15",
  "@tanstack/history": "1.162.0",
};
for (const [name, version] of Object.entries(approved)) {
  const pkg = JSON.parse(
    await readFile(new URL(`../../node_modules/${name}/package.json`, import.meta.url)),
  );
  if (pkg.version !== version)
    throw new Error(`Unapproved TanStack resolution for ${name}: ${pkg.version}`);
}
console.log("Approved TanStack package family verified.");
