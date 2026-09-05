# Private developer text files

The source implements `GET`, `POST` and `DELETE /api/v1/files`, a first-party SDK `files` resource, and an owner-only file section in `/developers/console`. The scoped MCP tools `kova_list_files`, `kova_read_file`, `kova_upload_text_file` and `kova_delete_file` use the same SQL ownership, quota and lifecycle boundary through the already authenticated bearer/OAuth identity. They require explicit `files` scope; delete is marked destructive and document contents are marked as untrusted data. These are KovaGPT project-scoped text documents, not provider-native file IDs, hosted vector stores or multimodal uploads.

Creation requires both developer API/billing activation and `KOVA_DEVELOPER_FILES_ENABLED=true`, plus an enabled key with the explicit `files` capability. Flags default to false. The API takes `{filename,mimeType,text}` and a stable `Idempotency-Key`. Supported UTF-8 formats are plain text, Markdown, CSV and JSON. JSON is parsed, file paths/remote URLs/HTML and extra caller fields are rejected. Each file is at most 32 KiB. The verified owner may retain at most 100 files and 2 MiB **across every developer account/project**, enforced under the canonical account advisory lock. A retry returns the identical existing file; changed data with the same retry key conflicts.

The service-only table computes an immutable content SHA-256 in an insert trigger; no authenticated/anonymous role has table or RPC access, and even the service role cannot update file content. Each read revalidates the authenticated key, owner, project, current scopes and deletion fence under the same owner lock. A verified owner can list, view and delete their files in the console even when creation or paid execution is disabled. The console pins the browser principal on every authenticated request and remounts its entire state when owner or project changes. Views render plain text; no file contents become HTML or executable code.

`GET /api/v1/files?page=0` returns 25 metadata records in deterministic creation/ID order with `hasMore`. `GET /api/v1/files?id=<uuid>` returns a private JSON record including `content`; DELETE with the same ID removes it. No caller-supplied project identifier can expand key access. The console uses a separate verified-owner endpoint and can manage its selected project. Developer project IDs do not grant access to consumer Projects or Library.

For Responses, provide up to four unique `file_ids` alongside normal input. The server reads and verifies their stored digests, adds their exact text as explicit user-provided context, then creates the ordinary signed provider/body fingerprint and reserves the reviewed input/output price. The expanded request still obeys the 64 KiB body and configured token/byte bound; nothing is silently truncated. Quote expiry is capped at the earliest file expiry. Execution reloads and verifies the bytes, so deletion, changed context or expired data cannot use the old quote. Immediately before provider dispatch, a service-only wrapper rechecks every file's digest, project, expiry and the key's current `files` scope under the account lock, then calls the existing billing dispatch. Failure returns the unspent hold through the existing settlement path. Provider input includes all admitted bytes; no client-provided token count or storage price is trusted.

Files expire after 30 days. Expired files are inaccessible immediately and are deleted opportunistically on owner access plus through `expire_developer_files`, called by the existing authenticated developer billing maintenance worker even while generation is off. Each worker invocation purges at most 100 files for one owner, avoiding cross-owner lock cycles. Account exports include private content and safe metadata through an owner-filtered projection, without upload retry digests. Auth/project deletion cascades the underlying records; the normal account deletion fence blocks late creation and reads.

The bounded file allowance has no independent inferred provider charge. Before activation the operator must account for its storage/read overhead in reviewed platform operating allowances and enable the maintenance schedule. No rates, content, credentials, data migrations, provider uploads or live activation occur in this package.

```javascript
const file = await client.files.upload(
  { filename: "counts.csv", mimeType: "text/csv", text: "Name,Count\nA,1" },
  { idempotencyKey: uploadOperationId },
);
const response = await client.responses.create(
  {
    model: approvedModel,
    input: "Summarize the attached counts.",
    file_ids: [file.id],
    max_output_tokens: 200,
  },
  {
    currency: approvedCurrency,
    maximumCharge: explicitRequestBudgetMinor,
    idempotencyKey: modelOperationId,
  },
);
```

Validation uses real canonical SQL in an isolated database without service-role `SELECT auth.users`, along with fake authenticated/provider transports. It covers owner-wide byte/count concurrency, exact retry conflicts, private roles/export/deletion, expiry, changed browser principals, disabled creation, digest verification, signed quote expiry/input changes and final scope/deletion rejection with conserved credit holds.
