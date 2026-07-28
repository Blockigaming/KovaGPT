# Project Omega readiness ledger

Project Omega prepares frontend contracts and workflows for capabilities that still require external services. Every surface distinguishes a saved configuration draft, a structurally valid simulation, and a genuinely connected backend. No unavailable service is represented as running.

## Realtime collaboration

- Typed adapter contract for presence, collaborator cursors, typing, revisions, and activity.
- Explicit unsupported, connecting, connected, reconnecting, offline, and failed states.
- Generic local/remote/manual conflict-resolution contract.
- Projects, Artifacts, and Work expose truthful realtime-unavailable status until an adapter is configured.
- Durable presence, cursor transport, revision persistence, and activity delivery require a realtime backend.

## Voice architecture

- Provider-neutral voice events for transcripts, latency, state, and recoverable errors.
- Session states cover permission, ready, connecting, listening, speaking, interruption, reconnect, end, and unavailable.
- The device workflow requests browser microphone permission, immediately stops the test stream, and lists real audio-input devices.
- No audio is uploaded and no transcript or waveform is fabricated without a provider.

## Background agents

- Legal state machine for queued, waiting, planning, running, approval-needed, paused, failed, completed, and cancelled runs.
- Control Center preview enables only legal transitions and explicitly does not start execution.
- Durable queues, attempts, task logs, approvals, retries, cancellation, and results require the runner backend.

## Enterprise readiness

- Account-scoped configuration drafts for organization identity, default role, retention, SSO domain, SCIM endpoint, external sharing, and connector-write policy.
- Teams, invitations, audit retention, compliance evidence, verified SSO, and SCIM remain unavailable until server validation and organization authorization exist.

## MCP ecosystem

- Account-scoped HTTPS server drafts with explicit unverified status.
- The UI never treats a draft as installed, healthy, authorized, or compatible.
- Manifest discovery, capability negotiation, permission grants, health, diagnostics, updates, and uninstall callbacks require the MCP management service.

## Provider management

- Existing typed provider adapter registry is surfaced without exposing credentials.
- Future AI, image, research, search, and voice adapters appear automatically after trusted registration.
- Production model routing continues through the existing server registry.

## Agent Studio

- Account-scoped reusable agent drafts with instructions, version metadata, tools, memory, files, Context Packs, and Project-ready fields.
- Drafts are never marked tested or executed without the agent runner.

## Universal AI Pipeline Builder and Workspace Simulator

- Typed input, agent, condition, tool, memory, context, schedule, and output nodes.
- Deterministic topological simulation detects duplicate IDs, invalid edges, cycles, missing input, and missing output.
- Backend-dependent nodes are explicitly listed as blocked rather than producing fake output.
- The simulator validates structure only; execution requires the Work/agent runner.

## Absolute backend requirements

- Realtime fan-out, presence expiry, cursor anchors, durable revisions, and conflict history.
- Voice signaling, media transport, transcription, synthesis, interruption, consent, and retention.
- Agent queues, leases, idempotency, approvals, attempts, logs, artifacts, retries, cancellation, and result persistence.
- Organization, team, invitation, role, SSO, SCIM, audit, compliance, retention, and policy services.
- MCP discovery, signed manifests, OAuth/grants, sandboxing, health probes, update service, and revocation.
- Encrypted provider credentials, health probes, quotas, routing, failover, and audit records.
- Durable Agent and Pipeline schemas, version history, sharing, execution, and deployment.
