# Azure browser provenance verification

## Scope

This record documents the focused verification performed for PR #183. It does not deploy an image, authorize production traffic, replace required CI on the final release SHA, or prove production rollback.

## Corrected security and provenance boundaries

The browser-configuration verifier now:

- scans only deployable browser files under `dist/client`;
- includes JavaScript, CSS, HTML, JSON, SVG, text, web-manifest, and XML assets;
- rejects unexpected Supabase project URLs and raw forbidden project-ref literals;
- rejects unexpected publishable keys without printing either key;
- detects legacy JWTs whose decoded role is `service_role` without exposing the token;
- rejects OpenAI keys, Supabase secret keys, PostgreSQL credential URLs, and general private-key PEM material;
- writes key-free provenance outside the public browser directory.

The image build now requires a clean, exact `git archive` context. Its non-secret source attestation binds the supplied commit and tree identifiers to the files copied into Docker. OCI labels and the provenance document record both identifiers and the expected browser Supabase project.

## Verification performed

One-shot workflow run `31916970874` completed successfully before committing the canonical formatting. It exercised the exact Git-archive helper, passed all 11 focused provenance tests, passed TypeScript typecheck and Azure validation, and completed a production build. The temporary workflow deleted itself in commit `60b58db4f85b1eb123369544b6e5d8a06f0156cf`.

Normal KovaGPT CI and Azure Container Readiness must still pass on the current user-authored branch head before the review findings can be considered closed or the stacked PR can be merged.
