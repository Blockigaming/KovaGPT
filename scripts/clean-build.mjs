import { rmSync } from "node:fs";

// Nitro retains prior hashed output between builds. Remove only this checkout's
// generated artifacts so stale executable chunks cannot enter a release image.
for (const output of ["../dist/", "../.nitro/"]) {
  rmSync(new URL(output, import.meta.url), { recursive: true, force: true });
}
