# Non-Actions release-preparation validation

> **Historical and superseded (2026-09-03):** This is evidence for the named 2026-08-16 commit only. It is not current dependency, route, build, or release guidance.

Commit `702b75314d9431bf2038a21d0132dfb80a66fd1a` was created with `[skip actions]` and GitHub reported zero workflow runs for the commit.

Local Node validation completed without GitHub-hosted runners:

- syntax checks passed for all six new release scripts;
- migration reconciliation contract passed;
- production RLS target prohibition contract passed;
- Stripe sandbox/live allowlist contract passed;
- zero-Lovable package and lock detectors passed;
- Azure managed-identity and GPT-5.6 Sol source contract passed;
- rollback evidence contract passed;
- focused test result: 6 passed, 0 failed.

The commit removes tracked `.lovable` metadata, the unsupported Bun lock/configuration, and active Lovable package declarations. It adds an inert compatibility redirect for the old OAuth path and places the functional consent UI at `/oauth/consent`.

This evidence does not replace full exact-SHA CI, generated npm lockfile validation, fresh/upgrade database rehearsals, live two-user RLS execution, Stripe test-mode webhooks, Azure candidate smoke tests, production network observation, or rollback exercise.
