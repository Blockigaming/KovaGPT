# Azure browser provenance verification

## Scope

This record documents focused source verification for PR #183. It does not deploy an image, authorize production traffic, replace required CI on the final release SHA, prove production rollback, or claim that the current production runtime uses this code.

## Corrected security and provenance boundaries

The browser-configuration verifier now:

- scans only deployable browser files under `dist/client`;
- includes JavaScript, CSS, HTML, JSON, SVG, text, web-manifest, and XML assets;
- rejects unexpected Supabase project URLs and raw forbidden project-ref literals;
- rejects unexpected modern publishable keys without printing either key;
- rejects legacy Supabase service-role JWTs, legacy anon JWTs, and baked user-session JWTs without exposing the token;
- validates the project claim before reporting an unexpected legacy anon key;
- rejects OpenAI keys, Supabase secret keys, PostgreSQL credential URLs, and general private-key PEM material;
- writes key-free provenance outside the public browser directory.

The image build requires a clean, exact `git archive` context. Its non-secret source attestation binds the supplied commit and tree identifiers to the files copied into Docker. OCI labels, `/api/version`, and the provenance document record the exact source identity and approved browser Supabase project.

## Azure workflow hardening

The manual production workflow now fails closed unless:

- the configured browser project ref, URL, and modern publishable key are internally consistent;
- the existing Container App `SUPABASE_URL` already matches the approved browser project;
- ACR returns a valid immutable manifest digest after the verified image is pushed;
- the digest-bound image labels and extracted provenance match the workflow SHA, Git tree, and project ref;
- Azure deploys the exact `repository@sha256:...` reference rather than a mutable tag;
- the deployed revision remains pinned to that digest;
- `/api/health` succeeds and `/api/version` reports the exact workflow SHA.

The workflow uploads the extracted key-free provenance record as retained release evidence. It does not silently retarget Supabase, alter DNS, or run unless manually dispatched from `main` with the confirmation input enabled.

## Verification status

Earlier one-shot workflow run `31916970874` verified the clean Git-archive helper, the original focused provenance suite, TypeScript typecheck, Azure validation, and a production build. Subsequent changes address newer review findings for legacy anon JWTs, server/browser project alignment, digest-bound deployment, and runtime SHA verification.

Normal exact-head KovaGPT CI and Azure Container Readiness must pass after the branch is reconciled onto the current RLS-hardening base. No production deployment has been executed by this PR.
