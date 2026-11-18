# Local Picomatch security backport

This is Picomatch 4.0.7 under its original MIT license, with a local parser
hardening for GHSA-fc5q-39xc-vjpf. It is not an upstream patched release.
The source tarball integrity and the reviewed local file hashes are recorded in
`scripts/security/picomatch-backport.json`.

The parser permits repetition only over nonempty, prefix-free literal
alternatives made of ASCII letters, digits, `_`, `.`, `/`, and `-`. Complex
repeated extglobs, including wildcard and nested bodies, use Picomatch's existing
escaped-literal safety fallback. This deliberately changes those complex
patterns' semantics; ordinary globs and non-repeating extglobs retain upstream
behavior. The safety rule also applies when callers disable the upstream
recursion limit. This backport is scoped to this advisory, not a claim that
arbitrary regular expressions are safe.

The original package name and version remain visible to `npm audit`. The
dependency gate reports the exact known advisory as locally patched only after
verifying every installed copy, file fingerprints, and bounded-process
regressions. New advisories, changed advisory identity/range, extra installed
copies, tampered files, audit network failures, and all other high/critical
findings block release. The raw registry finding is printed, not concealed.

Remove this local copy, its override, and the narrowly scoped audit handling
after an upstream release fixes the advisory and passes the same regressions.
