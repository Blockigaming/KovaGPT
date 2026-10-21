# Project task order and loading recovery

## Bounded source changes

- `reorderTasks` retains its authenticated, caller-scoped Supabase client, existing project filter, UUID validation, 500-ID limit, and `{ ok: true }` success response.
- Duplicate IDs are rejected before writing, including UUIDs differing only by letter case.
- Each position update requests its matching ID. A Supabase error, thrown request, or missing returned row stops the remaining updates and rejects the operation.
- Position updates remain sequential and non-transactional. An error can follow already-saved positions. This change does not provide atomicity, cross-client locking, rollback, or a database migration.
- `TasksTab` serializes local mutations and reorders through the full reload/recovery period. A failed reorder shows that it could not be confirmed and reloads the authoritative list. If reload also fails, the prior readable task list remains visible with an out-of-date warning and Retry.
- Initial-load failures display an error and Retry instead of the empty-success state. Refresh failures retain existing rows. Status, delete, and add failures are caught and reported without optimistic completion claims.
- Account/project generations, mount cleanup, operation identities, and load sequencing prevent stale completions from updating the current view. They do not cancel server-side writes already in flight.

## Local verification

`tests/unit/project-task-reorder-recovery.test.mjs` exercises the real source through local TypeScript-transpiled server/hook fixtures and deferred mock requests. It contains 31 passing tests covering:

- Sequential success; first/later database, transport, and missing-row failure; duplicate IDs; preserved input validation.
- Optimistic success; partial-failure reconciliation; fallback retention; Retry; duplicate-drop and conflicting-mutation blocking.
- Initial-load failure, stale initial loads, superseded reloads, viewer/same-row/cancelled drags.
- Stale project/account/unmount/effect-restart reorder completions and in-flight reconciliation.
- Status/delete/add success, failure, retained content/drafts, and stale account completions.

Commands:

```sh
node --test tests/unit/project-task-reorder-recovery.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/lib/project-workspace.functions.ts 'src/routes/projects.$projectId.tsx' tests/unit/project-task-reorder-recovery.test.mjs
node node_modules/prettier/bin/prettier.cjs --check src/lib/project-workspace.functions.ts 'src/routes/projects.$projectId.tsx' tests/unit/project-task-reorder-recovery.test.mjs docs/spec400/project-task-reorder-recovery.md
git diff --check
```

This is local source/mock evidence only. No live Supabase/RLS request, browser run, build, migration, deployment, or provider action was performed. Existing signed-in browser coverage and live authorization behavior remain separate release checks.
