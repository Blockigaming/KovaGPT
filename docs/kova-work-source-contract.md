# Kova Work request boundary

The Work catalog has 18 selections: Kova Cosmo, Kova Orion and Kova Nova,
each at Lite through Ultra. These display names follow the owner-approved Models
`config/current-product-policy.v3.json`; the family IDs remain `cosmo`, `orion`
and `nova`. They follow the approved Models v3 Free 0, Plus 18, Pro 18
entitlement policy. The existing application's Work runner still selects older
provider roles; it has no trusted active Kova model identity or Models job
service connection.

`POST /api/work/execution` now recognizes an explicit
`input.kovaModel: { family, effort }` only after its existing cross-site,
session, rate and bounded-JSON checks. It verifies the ordinary submission
fields and a strict Kova family/effort selection before consulting the
server-derived plan. Free and unsupported tiers receive 403; Plus and Pro
receive 503 until a trusted Models runtime and usage admission are connected.
The path creates no Work record, charges no usage, dispatches no old runner and
cannot choose a provider from browser input. Ordinary Work submissions without
`kovaModel` retain their existing path.

The pure boundary tests exercise all 18 selections for every tier, malformed
or mixed legacy payloads and the API call order. They do not prove an actual
request/response through a deployed app, browser delivery, or a live model.
Phase A A24/A36/A39 remain open at 30/40; Phase B is not ready.
