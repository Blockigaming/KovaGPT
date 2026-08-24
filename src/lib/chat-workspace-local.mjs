// Canonical module name for the bounded, device-only guest workspace fallback.
//
// The implementation lives in `local-chat-workspace.mjs`; this module exists so
// callers can import the contract name used by the release documentation.
// Temporary Chat must never call any of these helpers — the caller decides, and
// passing a null storage makes every read empty and every write a no-op.
export * from "./local-chat-workspace.mjs";
