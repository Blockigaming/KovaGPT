# Verified staging browser image build

This runbook creates local evidence that an immutable KovaGPT container image was compiled for the intended **synthetic staging Supabase project**. It does not deploy to Azure, push an image, modify DNS, or contact a hosted Supabase project.

## Why this gate exists

Vite replaces `VITE_SUPABASE_*` values while the image is built. Adding those variables later to an Azure Container App does not retarget the already-compiled browser bundle. A server can therefore point to staging while the browser silently retains a committed fallback project unless the image itself is verified.

A verified staging build must prove all of the following:

- the expected synthetic Supabase URL and publishable key are present in deployable browser assets;
- no second Supabase project URL or publishable key is present in those assets;
- server-only output cannot satisfy the browser check;
- no OpenAI secret, Supabase secret key, PostgreSQL credential URL, or private-key PEM appears in browser assets;
- the exact source commit and browser project ref are recorded in OCI labels;
- the image contains a key-free provenance document whose bundle digest can be paired with the final image digest.

## Required local inputs

Use only a disposable synthetic staging project. Do not use the production project or the Auth migration rehearsal project.

```bash
set -euo pipefail

SOURCE_SHA="$(git rev-parse HEAD)"
STAGING_PROJECT_REF="<exact-20-character-synthetic-project-ref>"
STAGING_SUPABASE_URL="https://${STAGING_PROJECT_REF}.supabase.co"
STAGING_PUBLISHABLE_KEY="<sb_publishable_browser_safe_key>"
FORBIDDEN_PROJECT_REFS="<comma-separated-production-and-rehearsal-project-refs>"
IMAGE_TAG="kovagpt-staging:${SOURCE_SHA}"
```

Before building, confirm that `SOURCE_SHA` is the reviewed commit on the intended staging branch:

```bash
test "${#SOURCE_SHA}" -eq 40
printf 'SOURCE_SHA=%s\n' "$SOURCE_SHA"
printf 'STAGING_PROJECT_REF=%s\n' "$STAGING_PROJECT_REF"
```

Do not print `STAGING_PUBLISHABLE_KEY` in shared logs even though it is browser-safe.

## Build the verified image locally

```bash
docker build \
  --build-arg KOVA_VERIFY_STAGING_BROWSER_CONFIG=true \
  --build-arg KOVA_SOURCE_SHA="$SOURCE_SHA" \
  --build-arg KOVA_EXPECTED_SUPABASE_PROJECT_REF="$STAGING_PROJECT_REF" \
  --build-arg KOVA_FORBIDDEN_SUPABASE_PROJECT_REFS="$FORBIDDEN_PROJECT_REFS" \
  --build-arg VITE_SUPABASE_URL="$STAGING_SUPABASE_URL" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$STAGING_PUBLISHABLE_KEY" \
  --tag "$IMAGE_TAG" \
  .
```

The build fails closed when verification is missing, inconsistent, or unsafe. The verifier scans deployable browser text assets after source maps are removed. It intentionally excludes `dist/server` so a value found only in server output cannot satisfy the gate.

Ordinary local development builds remain compatible because `KOVA_VERIFY_STAGING_BROWSER_CONFIG` defaults to `false`. Such an image is **not** staging-approved and its OCI label will say that browser configuration was not verified.

## Inspect OCI labels

```bash
docker image inspect "$IMAGE_TAG" \
  --format '{{json .Config.Labels}}'
```

The output must contain exactly the reviewed values for:

- `org.opencontainers.image.revision`
- `com.kovagpt.browser.supabase-project-ref`
- `com.kovagpt.browser.config-verified` equal to `true`
- `com.kovagpt.browser.config-provenance` equal to `/app/dist/staging-browser-config-provenance.json`

A missing, `unknown`, `unverified`, or mismatched label blocks promotion.

## Extract and inspect the key-free provenance record

```bash
CONTAINER_ID="$(docker create "$IMAGE_TAG")"
trap 'docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true' EXIT

docker cp \
  "$CONTAINER_ID:/app/dist/staging-browser-config-provenance.json" \
  ./staging-browser-config-provenance.json

node - <<'NODE'
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync("staging-browser-config-provenance.json", "utf8"));
const required = [
  "sourceSha",
  "supabaseProjectRef",
  "supabaseUrl",
  "publishableKeySha256",
  "browserBundleSha256",
  "scannedFiles",
  "scannedBytes",
];
for (const key of required) {
  if (!(key in data)) throw new Error(`Missing provenance field: ${key}`);
}
if (data.verification !== "verified-build-time-browser-config") {
  throw new Error("Browser configuration verification marker is missing");
}
console.log(JSON.stringify(data, null, 2));
NODE
```

The provenance file must not contain the full publishable key. It records only its SHA-256 fingerprint.

## Local runtime smoke test

Keep AI generation disabled and do not supply production secrets:

```bash
docker run --rm -d \
  --name kovagpt-staging-proof \
  -e AI_GENERATION_ENABLED=false \
  -e KOVA_GENERATION_DISABLED=true \
  -e AZURE_ENVIRONMENT=staging-proof \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e SUPABASE_URL="$STAGING_SUPABASE_URL" \
  -e SUPABASE_PUBLISHABLE_KEY="$STAGING_PUBLISHABLE_KEY" \
  -p 3000:3000 \
  "$IMAGE_TAG"

trap 'docker rm -f kovagpt-staging-proof >/dev/null 2>&1 || true' EXIT

for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:3000/api/health; then
    break
  fi
  sleep 2
done

curl --fail --silent --show-error http://127.0.0.1:3000/api/health
```

This smoke test proves only that the local image starts and exposes the safe health endpoint. It does not authorize generation, authentication testing, image pushing, Azure deployment, or production cutover.

## Evidence package before any approved push

Record these together in the staging review:

1. source commit SHA;
2. local image ID from `docker image inspect`;
3. OCI labels;
4. complete key-free provenance JSON;
5. SHA-256 of the provenance file;
6. successful local health response;
7. intended synthetic project ref;
8. explicit confirmation that production and Auth rehearsal refs are absent from browser assets.

After a separately authorized registry push, append the immutable `repository@sha256:digest` reference. The digest, source SHA, project ref, OCI labels, and provenance bundle digest must remain one inseparable promotion record.

## Hard stops

Do not continue to an Azure `what-if` or deployment when any of the following is true:

- browser verification was disabled;
- the image was built from a different source SHA;
- the project ref differs between the image label, provenance, and staging server configuration;
- the provenance file is absent or contains a full key;
- any unexpected Supabase URL or publishable key is found;
- any secret-pattern scan fails;
- a mutable image tag is the only available reference;
- the synthetic staging project has not been independently approved;
- generation is not fail-closed.
