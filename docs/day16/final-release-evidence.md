# Final release evidence index

Evidence must identify the exact 40-character production Git SHA and contain no access tokens, cookies, prompts, file content, service-role keys, or provider secrets.

Required evidence:

- local format/lint/type/unit/API/integration/a11y/visual/source-release output;
- fresh-database migration/schema result;
- Supabase migration-list reconciliation, backup checksums, restore rehearsal, and two-user isolation result;
- ACR immutable digest and Azure deployment result;
- Azure revision health, readiness, managed-identity/RBAC, scheduler Job execution, observability, and rollback result;
- Cloudflare DNS/TLS/proxy and Azure-origin allowlist verification;
- production `/api/health`, `/api/version`, `/api/livez`, `/api/readyz`, security headers, and absent Lovable-route results;
- signed-in auth, GPT-5.6 Sol streaming, tool/search, files/images/research, billing, sharing, notifications, and scheduled-task smoke evidence;
- Chromium, Firefox, and WebKit matrix at 320, 375, 390, 768, 1024, 1280, 1440, and 1728 pixels in light/dark signed-out/signed-in states;
- the single manual exact-SHA GitHub final release CI result;
- PR/branch reconciliation record.

A local pass or prepared template is not production completion.
