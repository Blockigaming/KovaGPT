# Response memory attribution

Normal chat responses carry the identifiers of saved context actually assembled for that model request. The UI calls this **Memory provided**: it does not claim the model used a particular fact. Chat memory references use the real `chat_memories.id`, and Project memory references include the real `project_memory.id` and Project ID. An accepted durable conversation summary can also use the `conversation_summary` reference kind.

The first `memory_sources` SSE prefix is authoritative. Later upstream deltas cannot replace it. Only identifiers and the original account ID are persisted with an assistant message in the existing account-scoped browser conversation/archive store. Titles and source contents are never copied into this metadata. Existing content-only share snapshots omit these references. Guests and both Temporary Chat modes receive no attribution metadata. Clean Temporary Chat also skips saved Project context.

The lazily loaded inspector checks the current authenticated account and uses its Supabase RLS client on every request. It fetches at most ten references per displayed page (the server accepts at most twenty), and explicitly scopes personal memory and summary queries by `user_id`. Project memory remains protected by Project membership RLS, with each result checked against the requested Project ID. Missing, deleted, and inaccessible sources share one unavailable state.

The inspector displays current saved contents, which can differ from the contents supplied with the original response. It sends `private, no-store` response headers, retains no source bodies in browser storage or a shared query cache, clears them when closed or hidden, and refreshes on focus. Account changes, data-clear events, and replaced inspections invalidate pending responses. The Memory Center announces edits/deletes so an open inspector discards its previous contents.

Validation is repository/local evidence, not proof of a deployed production feature:

- Unit coverage validates bounded identifier-only metadata, Temporary/account isolation, first-prefix authority, and delayed inspection cancellation.
- Executable integration coverage runs the real SSE consumer, message attribution helper, local conversation/archive storage, and owner-scoped source resolver. It verifies deletion and Project/owner mismatches do not return old source contents.
- Current-head hosted browser and database validation, merge approval, production migrations, and deployment remain separate release gates.
