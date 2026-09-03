# Library folders and bulk organization

Status: source-complete; production migration and authenticated browser evidence are still required.

## Contract

- `library_folders` stores at most 200 durable folders per account.
- Folders can be nested to 12 levels. A composite parent foreign key and a guarded mutation path prevent cross-account parents, self-parenting, and cycles.
- Folder names are trimmed, Unicode-normalized by the API, limited to 120 characters, and unique case-insensitively within one parent.
- `user_library_items.folder_id` is optional. Existing items remain at the Library root after migration.
- Deleting a folder subtree deletes no Library item and no stored object. Every affected item moves to the root through `ON DELETE SET NULL`.
- Bulk moves accept 1–100 unique item IDs and commit only when every ID belongs to the authenticated account and the destination folder belongs to that same account.
- A per-account database lock serializes folder changes, bulk moves, and folder deletion so concurrent requests cannot create cycles or partial results.
- Folder names and item titles are never copied into audit metadata. Audit rows contain only safe identifiers, counts, and the outcome.
- Account exports include folder rows and item `folder_id` membership, but exclude the internal mutation-lock table.

## HTTP API

All routes require a currently valid bearer session and return `Cache-Control: no-store`.

| Method   | Route                    | JSON body                                                    | Success                                    |
| -------- | ------------------------ | ------------------------------------------------------------ | ------------------------------------------ |
| `GET`    | `/api/library/folders`   | none                                                         | `{ folders: [...] }`                       |
| `POST`   | `/api/library/folders`   | `{ "name": string, "parentId"?: uuid \| null }`              | `201 { folder }`                           |
| `PATCH`  | `/api/library/folders`   | `{ "id": uuid, "name"?: string, "parentId"?: uuid \| null }` | `{ folder }`                               |
| `DELETE` | `/api/library/folders`   | `{ "id": uuid }`                                             | `{ deletedFolderCount, movedToRootCount }` |
| `POST`   | `/api/library/bulk-move` | `{ "itemIds": uuid[1..100], "folderId": uuid \| null }`      | `{ movedCount, folderId }`                 |

Mutation routes reject cross-site browser requests, require `application/json`, stream-read at most 16 KiB, reject unknown properties, apply a distributed fail-closed rate limit, and expose stable error codes rather than database details.

## Authorization boundary

- Authenticated clients can read only their own folder rows through RLS.
- Authenticated and anonymous roles cannot insert, update, or delete folder rows and cannot execute folder mutation RPCs.
- The server authenticates the bearer session first, supplies the verified `user_id`, and invokes service-role-only, transaction-scoped RPCs.
- A trigger also rejects assigning a Library item to a folder owned by another account, including direct service code outside the normal API.

## Deployment and verification

Applying the migration is a production change and is not performed by source CI. Before exposing folder controls:

1. Run the isolated database replay and migration preflight against the exact release SHA.
2. Apply `20260903210000_library_folders_and_bulk_move.sql` through the documented migration workflow.
3. Verify two-user RLS: each user lists only their own folders and cannot invoke mutation RPCs directly.
4. Verify create, rename, move-to-root, nested move, duplicate-name rejection, cycle rejection, and a 100-item bulk move.
5. Delete a populated folder subtree and verify item count, object count, and storage references are unchanged while every affected `folder_id` becomes `null`.
6. Confirm the four audit event types and ensure their metadata contains no folder or item names.
7. Capture authenticated desktop/mobile evidence after the interface work consumes these endpoints.

Until those production checks pass, documentation and status surfaces must say the feature is source-complete—not deployed or production-verified.
