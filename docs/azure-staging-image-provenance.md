# Verified synthetic browser configuration for Azure staging images

This runbook builds an immutable KovaGPT image whose deployable browser assets prove they were compiled for one intended synthetic Supabase project.

It does **not** deploy Azure resources, push an image, modify ACR, contact a hosted Supabase project, enable generation, migrate users, or authorize production cutover.

## Why this gate exists

Vite replaces `VITE_SUPABASE_*` values while the browser bundle is built. Azure Container App runtime variables cannot rewrite those values inside an already-built JavaScript asset.

A staging image is therefore invalid unless the exact browser assets inside that image contain the intended synthetic URL and publishable key, contain no other Supabase project hostname or configured forbidden project ref, and contain no secret or database credential material.

The verifier scans only `dist/client`. Values present only in `dist/server` cannot satisfy this gate.

## Build behavior

Ordinary local builds remain backward compatible:

```bash
docker build -t kovagpt-web:local .
```

That command leaves `KOVA_VERIFY_BROWSER_CONFIG=false`. It is suitable for ordinary local development only and is **not** acceptable as staging provenance.

A staging candidate must explicitly enable verification and supply all reviewed build inputs.

## Step 1: establish the exact source identity

Read-only with respect to remote systems:

```bash
set -euo pipefail

git diff --quiet
git diff --cached --quiet

export KOVA_SOURCE_SHA="$(git rev-parse HEAD)"
printf 'source_sha=%s\n' "$KOVA_SOURCE_SHA"
```

Stop unless `KOVA_SOURCE_SHA` is the exact reviewed commit intended for the image.

## Step 2: set synthetic browser configuration

Use only a disposable synthetic staging Supabase project. Do not use production or the Auth rehearsal project.

```bash
set -euo pipefail

export KOVA_BROWSER_SUPABASE_PROJECT_REF="REPLACE_WITH_20_CHARACTER_SYNTHETIC_REF"
export VITE_SUPABASE_URL="https://${KOVA_BROWSER_SUPABASE_PROJECT_REF}.supabase.co"
export KOVA_FORBIDDEN_SUPABASE_REFS="REPLACE_WITH_PRODUCTION_REF,REPLACE_WITH_AUTH_REHEARSAL_REF"

read -r -s -p "Synthetic Supabase publishable key: " VITE_SUPABASE_PUBLISHABLE_KEY
printf '\n'
export VITE_SUPABASE_PUBLISHABLE_KEY
```

The publishable key is designed for browser use, but this runbook still avoids printing it or placing it directly in the shell command line.

The verifier accepts:

- `sb_publishable_...` keys; or
- a legacy JWT whose payload role is exactly `anon` and whose optional `ref` matches the synthetic project.

It rejects secret keys and privileged JWTs.

## Step 3: build the verified image locally

This command mutates only the local Docker image store:

```bash
set -euo pipefail

export KOVA_VERIFY_BROWSER_CONFIG=true
export IMAGE_TAG="kovagpt-staging:${KOVA_SOURCE_SHA}"

docker build \
  --build-arg KOVA_VERIFY_BROWSER_CONFIG \
  --build-arg KOVA_SOURCE_SHA \
  --build-arg KOVA_BROWSER_SUPABASE_PROJECT_REF \
  --build-arg KOVA_FORBIDDEN_SUPABASE_REFS \
  --build-arg VITE_SUPABASE_URL \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY \
  --tag "$IMAGE_TAG" \
  .
```

The build fails unless all of these statements are true:

1. the source SHA is a complete 40-character commit SHA;
2. the project ref is exactly 20 lowercase letters or digits;
3. the URL is the canonical HTTPS root for that ref;
4. the publishable key has an accepted browser-safe form;
5. the intended URL and key both occur in `dist/client`;
6. no other Supabase project hostname occurs in `dist/client`;
7. no configured forbidden ref occurs anywhere in deployable browser text assets;
8. no PostgreSQL URL, OpenAI secret pattern, Supabase secret pattern, privileged Supabase JWT, or private-key PEM material occurs;
9. the browser assets are valid UTF-8 regular files and contain no symbolic-link escape.

Source maps are removed before verification and are not copied into the runtime image.

## Step 4: inspect immutable OCI labels

Read-only against the local image:

```bash
set -euo pipefail

docker image inspect "$IMAGE_TAG" \
  --format '{{json .Config.Labels}}' | jq .
```

Require these exact label values:

```text
org.opencontainers.image.revision=<KOVA_SOURCE_SHA>
io.kovagpt.browser-supabase-project-ref=<KOVA_BROWSER_SUPABASE_PROJECT_REF>
io.kovagpt.browser-config-verification=true
```

Stop if any label is missing, `unknown`, `unverified`, or different from the reviewed inputs.

## Step 5: extract and inspect key-free provenance

Read-only against the local image except for a temporary local file:

```bash
set -euo pipefail

PROVENANCE_FILE="/tmp/kovagpt-browser-config-provenance.json"
CONTAINER_ID="$(docker create "$IMAGE_TAG")"
cleanup() {
  docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
  rm -f "$PROVENANCE_FILE"
}
trap cleanup EXIT

docker cp \
  "$CONTAINER_ID:/app/dist/browser-config-provenance.json" \
  "$PROVENANCE_FILE"

jq . "$PROVENANCE_FILE"
```

The record contains no raw publishable key. It contains only:

- schema version;
- source SHA;
- synthetic project ref and browser-safe URL;
- SHA-256 fingerprint of the publishable key;
- deterministic SHA-256 digest of sorted deployable browser assets;
- file, byte, URL occurrence, key occurrence, discovered-project, and forbidden-ref counts.

Verify the raw key is absent:

```bash
if grep -F -- "$VITE_SUPABASE_PUBLISHABLE_KEY" "$PROVENANCE_FILE"; then
  echo "SAFETY STOP: provenance contains the raw publishable key" >&2
  exit 1
fi
```

Verify the reviewed identity:

```bash
jq -e \
  --arg sha "$KOVA_SOURCE_SHA" \
  --arg ref "$KOVA_BROWSER_SUPABASE_PROJECT_REF" \
  '.sourceSha == $sha and
   .browserSupabaseProjectRef == $ref and
   .scan.expectedUrlOccurrences > 0 and
   .scan.expectedKeyOccurrences > 0 and
   .scan.discoveredSupabaseProjectRefs == [$ref]' \
  "$PROVENANCE_FILE" >/dev/null
```

## Step 6: record the local image ID

Read-only:

```bash
LOCAL_IMAGE_ID="$(docker image inspect "$IMAGE_TAG" --format '{{.Id}}')"
printf 'local_image_id=%s\n' "$LOCAL_IMAGE_ID"
```

Record together, outside the repository:

- source SHA;
- local image ID;
- browser bundle digest;
- browser project ref;
- publishable-key fingerprint;
- intended ACR repository.

Do not record the raw publishable key.

## Step 7: pair with a pushed digest only after separate approval

Pushing changes ACR and is not authorized by this runbook's validation steps.

After explicit owner approval for an ACR push, use a separate guarded shell:

```bash
set -euo pipefail

: "${PUSH_KOVAGPT_STAGING_IMAGE:?Set PUSH_KOVAGPT_STAGING_IMAGE=YES only after explicit approval}"
[ "$PUSH_KOVAGPT_STAGING_IMAGE" = "YES" ] || {
  echo "SAFETY STOP: push approval is missing" >&2
  exit 1
}

ACR_IMAGE="REPLACE_WITH_REGISTRY.azurecr.io/REPLACE_WITH_REPOSITORY:${KOVA_SOURCE_SHA}"
docker tag "$IMAGE_TAG" "$ACR_IMAGE"
docker push "$ACR_IMAGE"

PUSHED_REFERENCE="$(docker image inspect "$ACR_IMAGE" --format '{{index .RepoDigests 0}}')"
printf 'pushed_reference=%s\n' "$PUSHED_REFERENCE"
```

The only deployment-eligible image reference is `repository@sha256:<digest>`. Never use the source tag as an Azure deployment input.

Unset approval and browser values afterward:

```bash
unset PUSH_KOVAGPT_STAGING_IMAGE
unset VITE_SUPABASE_PUBLISHABLE_KEY
```

## Failure handling

Do not bypass the verifier, weaken a pattern, remove a forbidden ref, or scan server output to make a failing image pass.

A failure usually means one of these conditions is true:

- the image was built without the intended Vite values;
- the committed public fallback remained reachable in the browser bundle;
- a wrong Supabase project is present;
- the expected value exists only in server output;
- credential-like material leaked into client assets;
- the source SHA, project ref, or key form is invalid.

Correct the source or build inputs, create a new commit when necessary, and rebuild a new immutable image. Never relabel an unverified image as verified.
