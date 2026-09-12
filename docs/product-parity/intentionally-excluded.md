# Scope boundaries and required unavailable capabilities

Updated **2026-09-12** against reviewed PR #319 implementation head
`20940476881dadabfcedbfeadb4aba328dd8cd52`.

This register distinguishes genuine external/product boundaries from required KovaGPT work that is not
implemented yet. An unavailable requirement must not be mislabeled as an intentional exclusion.
See the [controlling final goal](../release/kova-final-goal-2026-09-11.md), its
[machine-readable contract](../release/final-goal-contract.json), and the
[current acceptance ledger](../release/acceptance-ledger.md).

## Required scope that is currently unavailable or incomplete

| Item | Current status | Required boundary |
| --- | --- | --- |
| Live voice, audio, microphone input, captions, read-aloud, and recording | Required; unavailable | Do not expose a control or availability claim until consent, safety, latency, provider, device, accessibility, privacy, and per-minute plus backend-compute cost gates are implemented and verified. |
| Native macOS, Windows, Linux, iOS, and Android experiences | Required where needed; incomplete | Responsive web/PWA does not establish native background work, voice, camera, notifications, sharing, or physical-device behavior. Implement only with explicit permissions and full release evidence. |
| Astra-class premium reasoning | Required; unavailable until verified | Keep provider-neutral routing and an explicit premium choice. Do not silently select an expensive model or claim availability without entitlement, eval, quota, latency, metering, and cost proof. |
| Flare-class and Sunburst-class image routes | Required; unavailable until verified | Fast and precision paths need truthful provider capability discovery, visible quality/cost controls, reservations, safety, provenance, and acceptance evidence. |
| WebMCP and safe signed-in browser work | Required; incomplete | Website tool discovery and browser actions need trust, least privilege, previews, confirmations, bounded execution, audit, revocation, and recovery. |

## Genuine boundaries and non-claims

| Item | Classification | Reason and Kova boundary |
| --- | --- | --- |
| Unapproved OS surveillance, unrestricted device control, local-folder access, Apple Messages access, or hidden background capture | Permission and privacy boundary | Kova may implement approved native/browser capabilities, but no feature may exceed explicit user consent, platform permissions, least privilege, or auditable product policy. |
| Identical models, private routing/ranking, or provider-managed proprietary hosting internals | Proprietary/external | Kova uses approved provider-neutral interfaces. Required capability outcomes do not imply access to private source, weights, ranking, or infrastructure. |
| Regulated healthcare/clinician, BAA/HIPAA/FedRAMP, residency, or legal-hold guarantees | Unsubstantiated claim excluded | Contracts, policy, operations, controls, and independent evidence are required before any such claim. General research, privacy source, or audit exports are not certification. |
| Proprietary scientific-specialist or trusted-access cybersecurity programs | Provider/access boundary | Named external programs and operating policies are not available through generic Kova credentials. Portable analysis and safe code/security work remain bounded product capabilities. |
| Institutional education deployments and exclusive partner products | External institutional boundary | School agreements, administration, policy, and third-party permissions are distinct from Kova Study and ordinary organization roles. |
| Arbitrary user-generated server code or provider-private database/storage internals | Outside reviewed runtime shape | Current Sites is static and isolated; Work supports fixed sandboxed tools. Portable authenticated state and analytics require separate reviewed designs. |
| Unsupported formats, unpurchasable plans, unverified providers, or empty route aliases | Truthfulness boundary | Expose only implemented and configured journeys. A label, mock, route, or provider name is never success, entitlement, or availability. |
| OpenAI branding, assets, private copy/source, or exact trade dress | Independent-product boundary | Preserve Kova branding, product judgment, and provider flexibility without copying proprietary assets or implying affiliation. |
| Private, authenticated, or geographically restricted reference surfaces without authorized access | Audit limitation | Do not bypass controls. Record unobserved variants; later supplied authorized access may enable a lawful verification. |

These classifications do not prove production readiness and do not recalculate the owner-declared
**76.5%** overall checkpoint or separate **1%** UI assessment.
