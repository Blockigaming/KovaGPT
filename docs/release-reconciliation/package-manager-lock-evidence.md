# Supported package-manager lock evidence

> **Historical and superseded (2026-09-03):** This record describes PR #180. KovaGPT now supports only the npm lockfile; the Bun lock and configuration discussed below were removed and must not be restored.

## Scope

This record documents the lockfile reconciliation performed for PR #180. It does not constitute final zero-Lovable verification or replace required CI on the release SHA.

## Verified resolution

The repository declares both npm and Bun lockfiles as supported deterministic workflows. The root package override now pins `nanoid` to `3.3.18` for both package managers.

A pinned Bun 1.3.14 one-shot workflow regenerated `bun.lock`, rejected unexpected package or npm-lock mutations, bounded lockfile churn, and verified a frozen lockfile-only install before committing. The resulting Bun lock contains `nanoid@3.3.18` and no `nanoid@3.3.16` resolution.

## Separate zero-Lovable finding

The regenerated Bun lock still contains package tarball locations under a Lovable-hosted npm cache for many unrelated dependencies. That does not invalidate the `nanoid` version reconciliation, but it is an active build-dependency concern for the later zero-Lovable audit and must be removed or the Bun workflow must be retired before final production can be described as independent of Lovable.

## Required release proof

Normal KovaGPT CI, Azure Container Readiness, dependency audit, and the repaired production bundle gate must pass on the current user-authored branch head before PR #180 is eligible for merge.
