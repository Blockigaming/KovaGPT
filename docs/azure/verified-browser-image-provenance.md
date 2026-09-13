# Verified browser image provenance

This gate proves that an immutable KovaGPT container image was compiled from an exact Git commit and tree for one explicitly approved Supabase project. It is reusable for isolated staging and, after all release approvals, for the production candidate.

The build gate itself does not deploy to Azure, change DNS, modify Supabase, migrate users, or authorize a production cutover. The separate production workflow remains manual and confirmation-gated.

## What the gate proves

A verified build must establish all of the following:

- the expected Supabase project URL and browser-safe publishable key are present in deployable browser assets;
- no second Supabase project URL, project-ref literal, modern publishable key, or legacy Supabase JWT is present in those assets;
- when a Stripe publishable key is supplied, that exact key appears in executable browser assets; stale or second Stripe keys fail verification;
- server-only output cannot satisfy the browser check;
- every served text asset under `dist/client`, including `.txt`, web-manifest, and XML files, is scanned;
- no OpenAI secret, Supabase secret key, legacy Supabase service-role JWT, legacy anon JWT, user-session JWT, PostgreSQL credential URL, or private-key PEM appears in browser assets;
- the exact source commit, source tree, and expected Supabase project ref are recorded in OCI labels;
- the image contains a key-free provenance document with a deterministic browser-bundle SHA-256;
- ordinary unverified builds remain possible but are labeled `config-verified=false` and cannot be promoted.

## Required build inputs

A verified image is built from a clean `git archive`, not from the mutable working directory. The helper rejects tracked or untracked worktree changes, records the exact commit and tree identifiers, and writes a non-secret source attestation into an isolated build context outside the repository.

```bash
set -euo pipefail

BUILD_CONTEXT="$(mktemp -d)"
trap 'rm -rf "$BUILD_CONTEXT"' EXIT

scripts/azure/prepare-verified-build-context.sh "$BUILD_CONTEXT"

SOURCE_SHA="$(git rev-parse HEAD)"
SOURCE_TREE="$(git rev-parse 'HEAD^{tree}')"
TARGET_PROJECT_REF="<exact-20-character-project-ref>"
TARGET_SUPABASE_URL="https://${TARGET_PROJECT_REF}.supabase.co"
TARGET_PUBLISHABLE_KEY="<sb_publishable_browser_safe_key>"
TARGET_STRIPE_PUBLISHABLE_KEY="${KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY:-}"
FORBIDDEN_PROJECT_REFS="<comma-separated refs that must not appear>"
IMAGE_TAG="kovagpt-candidate:${SOURCE_SHA}"
```

`TARGET_STRIPE_PUBLISHABLE_KEY` is empty for a build without payments. For a production billing candidate, use the owner-verified live publishable key from the protected production environment; never a secret or restricted API key. It is compiled into the image and cannot be supplied later as a runtime variable.

`SOURCE_SHA` and `SOURCE_TREE` must identify the reviewed release commit and tree. Keep the publishable key out of shared logs even though it is intentionally browser-visible.

## Build

```bash
docker build \
  --build-arg KOVA_VERIFY_BROWSER_CONFIG=true \
  --build-arg KOVA_SOURCE_SHA="$SOURCE_SHA" \
  --build-arg KOVA_SOURCE_TREE="$SOURCE_TREE" \
  --build-arg KOVA_EXPECTED_SUPABASE_PROJECT_REF="$TARGET_PROJECT_REF" \
  --build-arg KOVA_FORBIDDEN_SUPABASE_PROJECT_REFS="$FORBIDDEN_PROJECT_REFS" \
  --build-arg VITE_SUPABASE_URL="$TARGET_SUPABASE_URL" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$TARGET_PUBLISHABLE_KEY" \
  --build-arg VITE_PAYMENTS_CLIENT_TOKEN="$TARGET_STRIPE_PUBLISHABLE_KEY" \
  --tag "$IMAGE_TAG" \
  "$BUILD_CONTEXT"
```

The verifier requires the Git-archive attestation and compares both immutable identifiers with the supplied build arguments. It scans only deployable browser text assets under `dist/client` after source maps are removed. The provenance document is written to `dist/browser-config-provenance.json`, outside the public browser directory but inside the final runtime artifact. The source SHA is also compiled into `/api/version`, allowing the deployed runtime to prove which commit it is serving.

## Azure promotion workflow

The manual Azure workflow adds four independent hard stops before it accepts a deployment:

1. It validates the approved project ref, URL, modern publishable key, source commit, and source tree.
2. After Azure OIDC sign-in, it reads the existing Container App `SUPABASE_URL` and refuses to build when the server-side project does not match the approved browser project. It does not silently retarget the server.
3. It builds from the clean archive, pushes a unique candidate tag, resolves the ACR manifest digest, re-pulls the digest, verifies OCI labels, and extracts the provenance record from that digest-bound image.
4. It deploys `registry/repository@sha256:...`, verifies the Container App is pinned to that exact digest, and requires both `/api/health` and `/api/version` to report the expected source SHA.

The unique candidate tag is only a transport handle. The immutable registry digest is the promotion and deployment identity.

## Required OCI labels

Inspect the image:

```bash
docker image inspect "$IMAGE_TAG" --format '{{json .Config.Labels}}'
```

Promotion requires:

- `org.opencontainers.image.revision` equals the reviewed 40-character source SHA;
- `com.kovagpt.source.tree` equals the attested Git tree identifier;
- `com.kovagpt.browser.supabase-project-ref` equals the approved target ref;
- `com.kovagpt.browser.config-verified` equals `true`;
- `com.kovagpt.browser.config-provenance` equals `/app/dist/browser-config-provenance.json`.

## Provenance record

Extract `/app/dist/browser-config-provenance.json` from the image. It contains only:

- source SHA, source tree, and Git-archive context;
- project ref and URL;
- SHA-256 fingerprint of the Supabase publishable key, never the full key;
- `stripePublishableKeySha256`, the compiled Stripe publishable-key fingerprint or explicit null for an unconfigured build;
- deterministic browser-bundle SHA-256;
- scanned file and byte counts;
- discovered and forbidden project-ref evidence.

The workflow uploads that record as a retained GitHub Actions artifact and pairs it with the immutable ACR digest. The digest, source identifiers, project ref, OCI labels, and provenance hash form one promotion record.

## Hard stops

Do not promote or deploy when any of these is true:

- verification was disabled;
- the Git-archive source attestation is missing or its commit/tree differs from the reviewed release;
- browser and server project identities differ;
- the provenance record is missing or contains a full credential;
- an unexpected project ref, modern publishable key, legacy Supabase JWT, or secret pattern is detected;
- only a mutable image tag is available;
- the pushed image labels or extracted provenance do not match the requested source and project;
- the Container App would not be pinned to the exact registry digest;
- the deployed `/api/version` SHA differs from the workflow SHA;
- the target project or environment has not been independently approved;
- health, readiness, rollback, authentication, or cross-user tests are incomplete.
