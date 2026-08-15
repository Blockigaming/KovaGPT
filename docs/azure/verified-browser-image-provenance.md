# Verified browser image provenance

This gate proves that an immutable KovaGPT container image was compiled from an exact Git commit for one explicitly approved Supabase project. It is reusable for isolated staging and, after all release approvals, for the production candidate.

It does not deploy to Azure, change DNS, modify Supabase, migrate users, or authorize a production cutover.

## What the gate proves

A verified build must establish all of the following:

- the expected Supabase project URL and browser-safe publishable key are present in deployable browser assets;
- no second Supabase project URL or publishable key is present in those assets;
- server-only output cannot satisfy the browser check;
- no OpenAI secret, Supabase secret key, PostgreSQL credential URL, or private-key PEM appears in browser assets;
- the exact source SHA and expected Supabase project ref are recorded in OCI labels;
- the image contains a key-free provenance document with a deterministic browser-bundle SHA-256;
- ordinary unverified builds remain possible but are labeled `config-verified=false` and cannot be promoted.

## Required build inputs

```bash
set -euo pipefail

SOURCE_SHA="$(git rev-parse HEAD)"
TARGET_PROJECT_REF="<exact-20-character-project-ref>"
TARGET_SUPABASE_URL="https://${TARGET_PROJECT_REF}.supabase.co"
TARGET_PUBLISHABLE_KEY="<sb_publishable_browser_safe_key>"
FORBIDDEN_PROJECT_REFS="<comma-separated refs that must not appear>"
IMAGE_TAG="kovagpt-candidate:${SOURCE_SHA}"
```

`SOURCE_SHA` must be the exact reviewed release commit. Keep the publishable key out of shared logs even though it is intentionally browser-visible.

## Build

```bash
docker build \
  --build-arg KOVA_VERIFY_BROWSER_CONFIG=true \
  --build-arg KOVA_SOURCE_SHA="$SOURCE_SHA" \
  --build-arg KOVA_EXPECTED_SUPABASE_PROJECT_REF="$TARGET_PROJECT_REF" \
  --build-arg KOVA_FORBIDDEN_SUPABASE_PROJECT_REFS="$FORBIDDEN_PROJECT_REFS" \
  --build-arg VITE_SUPABASE_URL="$TARGET_SUPABASE_URL" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$TARGET_PUBLISHABLE_KEY" \
  --tag "$IMAGE_TAG" \
  .
```

The verifier scans deployable browser text assets after source maps are removed and excludes server output. It fails closed when the expected browser configuration is missing, duplicated, inconsistent, or unsafe.

## Required OCI labels

Inspect the image:

```bash
docker image inspect "$IMAGE_TAG" --format '{{json .Config.Labels}}'
```

Promotion requires:

- `org.opencontainers.image.revision` equals the reviewed 40-character source SHA;
- `com.kovagpt.browser.supabase-project-ref` equals the approved target ref;
- `com.kovagpt.browser.config-verified` equals `true`;
- `com.kovagpt.browser.config-provenance` equals `/app/dist/browser-config-provenance.json`.

## Provenance record

Extract `/app/dist/browser-config-provenance.json` from the image. It contains only:

- source SHA;
- project ref and URL;
- SHA-256 fingerprint of the publishable key, never the full key;
- deterministic browser-bundle SHA-256;
- scanned file and byte counts;
- discovered and forbidden project-ref evidence.

Pair this record with the immutable registry digest after a separately approved push. The digest, source SHA, project ref, OCI labels, and provenance hash form one promotion record.

## Hard stops

Do not promote or deploy when any of these is true:

- verification was disabled;
- the source SHA is unknown, unverified, or differs from the reviewed release SHA;
- browser and server project identities differ;
- the provenance record is missing or contains a full credential;
- an unexpected project ref, publishable key, or secret pattern is detected;
- only a mutable image tag is available;
- the target project or environment has not been independently approved;
- health, readiness, rollback, authentication, or cross-user tests are incomplete.
