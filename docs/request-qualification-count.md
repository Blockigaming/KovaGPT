# Count a captured request without generating

`scripts/azure/count-captured-request.mjs` counts the input of one privately
captured, bounded OpenAI Responses request. It does not generate a response,
retrieve a credential, activate staging, or establish pricing/deployment
qualification. Run it only under actual authority for the credential and count
operation. A valid-shaped plan and matching hashes do not create that authority
or authenticate an account capture.

Default invocation reads no files or environment values and makes no requests:

```sh
node scripts/azure/count-captured-request.mjs
```

An independently authorized operator can explicitly count an existing capture:

```sh
node scripts/azure/count-captured-request.mjs --count \
  --capture /absolute/private/capture.json \
  --plan /absolute/private/count-plan.json \
  --output-directory /absolute/private/count-output
```

The existing private execution context must supply `OPENAI_API_KEY` without
putting its value in command history, source, screenshots, logs or chat. It must
also supply `KOVA_REQUEST_COUNT_ENABLED=true`, `AZURE_ENVIRONMENT=staging`, and
`KOVA_DEPLOYMENT_TARGET=ca-kovagpt-staging`. The script never resolves Azure,
Key Vault or password-manager secrets. An absent existing usable credential
remains a dependency; this helper does not authorize creating or rotating one.

Capture and plan files must be owner-owned regular files with mode `0600`, a
single hard link and immediate parent directory mode `0700`. The existing output
directory must also be owner-owned and mode `0700`. Paths must be absolute and
contain no symlink components. Capture reads are bounded to 64 KiB; plan reads
to 16 KiB. Actual private artifacts and receipts must not be committed.
Explicit execution requires Linux with `/proc/self/fd` available. Receipt
writes use a held, inode-verified directory descriptor so a path replacement
cannot redirect writes; unsupported executors fail closed. Input descriptors
must match the identity of the inspected files.

## Capture and count plan

The capture is version `1`, with `evidenceKind` equal to
`actual-account-request-capture` or `synthetic-fixture`; canonical ISO
`capturedAt`; `source: { commit, tree }` containing exact 40-character lowercase
Git hashes; UUID `operationId`; SHA-256 `capturePlanSha256`; the final Responses
`body`; its canonical `bodySha256`; `serializedBodySha256` of
`JSON.stringify(body)`; and `serializedUtf8Bytes`.

The separate count plan is version `1` and requires these exact bindings:

- `expectedSource: { commit, tree }`, `operationId`, `capturePlanSha256`, and
  `bodySha256` matching the capture.
- `expectedEvidenceKind` matching the capture. Synthetic fixtures never become
  actual-account evidence by running this helper.
- Canonical ISO `notBefore` and `expiresAt`, with an active window of at most
  ten minutes. The capture must fall within that window and be at most ten
  minutes old when validated.
- `maximumInputTokens`, a positive integer no greater than `8192`.

The captured final body must be `gpt-5.6-luna`, with exactly one user input
`Reply exactly: Kova speech test.`, `stream=true`, `store=false`,
`service_tier=default`, and `max_output_tokens=64`. Only those fields plus string
`instructions` and an optional `reasoning` object (`effort`/`summary` strings)
are accepted. Serialized generation input is at most 32,768 UTF-8 bytes.
Instructions must be the actual account request's final instructions; the
synthetic fixture's count is not a substitute.

## Fixed operation and durable evidence

There is one allowed network operation: a single POST to
`https://api.openai.com/v1/responses/input_tokens`, with the equivalent exact
`model`, `input`, `instructions` and `reasoning`. Generation-only stream,
storage, service-tier and output-limit fields are not count endpoint fields;
the full generation-body hash still binds them. No provider URL override,
redirect, retry, generation endpoint or SDK is used. The request and response
share a maximum eight-second deadline within a ten-second operation budget;
the response is capped at 32 KiB. The operation clock and plan expiry are
checked before the POST and before accepting its result. Filesystem reads,
reservation synchronization and receipt writes can stall independently; these
deadlines do not provide a hard wall-time bound for filesystem I/O. A stalled
preflight/reservation that exhausts the budget cannot start a new POST.

Before contacting OpenAI, the helper exclusively creates and synchronizes
`token-count-<operationId>.attempt.json`. The reservation is never deleted,
refunded or overwritten. A failure, cancellation, timeout, malformed response,
or uncertain POST outcome consumes the attempt. Do not retry the operation.
A later invocation with the same operation ID and output directory is rejected.
Keep this directory with the original private evidence; choosing a different
directory is not authorization for a retry.
Failed counts return a nonzero CLI exit status while preserving their private
consumed-attempt receipt.

The separate exclusive receipt binds source, evidence kind, capture/count-plan
hashes, canonical and serialized generation-body hashes, count payload hash,
raw response hash and the observed input-token integer. Only an exact
`response.input_tokens` result within the planned maximum is accepted. Provider
error bodies, exceptions, credentials and request instructions are not printed
or copied to receipts. CLI stdout contains only status and request/generation
attempt totals. A private receipt always leaves `captureAuthenticityVerified`
and `executionAuthorityGranted` false: provenance and authority require the
operator's independent review. An observed count is not live chat or playback
acceptance, a price proof, a hard Azure shutdown bound, or a deployment approval.

For a later independently reviewed generation plan, the receipt's
`generationBodySha256` must equal `openAI.bodySha256`, and `inputTokens` supplies
`openAI.verifiedInputTokens`. Verify `receiptSha256` by applying
`acceptanceDigest` to the receipt with that self-hash field removed, then retain
that reviewed digest as `openAI.tokenCountEvidenceSha256`. Preserve the original
private receipt and authorization; recomputable hashes do not prove who ran the
count or turn a synthetic capture into actual-account evidence.

Protocol reference:
https://developers.openai.com/api/reference/python/resources/responses/subresources/input_tokens/methods/count
