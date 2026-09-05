# Kova capability evidence index

Updated **2026-09-05**, source `1eb7ef53`; progress baseline remains **23.2%**.

The canonical human-readable inventory is [feature-parity.md](../feature-parity.md). Its [machine-readable companion](capability-audit.json) contains all 27 master areas with separate source, local, hosted, staging and production fields. Keep those records together when a package lands; do not maintain a second contradictory feature table here.

| Evidence                           | Authority / interpretation                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Source scope and exact limitations | [27-area inventory](../feature-parity.md), feature-specific source documents and actual runtime paths.                        |
| Actual tests                       | Per-surface test paths in the inventory. Test existence is not a current pass result.                                         |
| Pending implementation/integration | [Remaining work](../remaining-chatgpt-gaps.md), including Work delegation/Sites, skills and active packages.                  |
| Current public reference           | [Official source audit](chatgpt-surface-audit.md); unauthenticated public documents only.                                     |
| Hosted CI/review                   | Exact final published commit/tree and terminal checks; this audit does not supply them.                                       |
| Staging/production                 | Approved deployment record, real-provider/account canaries and rollback; not exercised by this audit.                         |
| Exclusions                         | [Scope register](intentionally-excluded.md), including all voice/audio/dictation and native/proprietary/regulated boundaries. |

A green local suite, source-complete adapter, empty exact-app manifest or route count must never be converted into full product parity, an available paid entitlement or production readiness.
