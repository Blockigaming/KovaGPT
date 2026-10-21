# Exact local review build command

From the source checkout, always stamp the build explicitly:

```sh
KOVA_BUILD_SHA="$(git rev-parse HEAD)" npm run build:azure > ../exports/build-current-stamped.log 2>&1
```

Do not use an unstamped `npm run build:azure` for a review candidate. This app intentionally defaults its public `/api/version` SHA to `unknown` when KOVA_BUILD_SHA/GITHUB_SHA is absent. A successful compilation alone does not establish source identity. The private adapter rejects a package whose declared buildCommit differs from the guarded upstream's actual `/api/version`.

Before packaging: record the full source SHA, actual command, build exit status and log. After starting the guarded app: read `/api/version` through the supported browser and verify that its SHA matches the package buildCommit. Then start the private adapter and perform affected checks. Keep failed or unstamped packages explicitly non-deliverable.

Current corrected build command uses literal source41530f7fbc0078ac3977ab873a04afb0dc0e1069. Subsequent documentation-only changes can be packaged against that build when package.mjs confirms all application inputs are unchanged.
