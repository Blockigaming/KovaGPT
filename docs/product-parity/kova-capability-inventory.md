# Kova capability evidence index

Updated **2026-09-12** against reviewed PR #319 implementation head
`20940476881dadabfcedbfeadb4aba328dd8cd52`.

Overall progress remains the owner-declared **76.5%** checkpoint. UI completion remains the separate
owner-declared **1%** quality assessment.

The canonical evidence sources are kept together:

| Evidence | Authority and interpretation |
| --- | --- |
| Controlling scope | [September 11 final goal](../release/kova-final-goal-2026-09-11.md). New requirements remain specified or partial until evidence proves otherwise. |
| Requirement metadata | [Final-goal contract](../release/final-goal-contract.json), with stable IDs, owner, dependencies, acceptance tests, mappings, status, evidence, and boundaries. |
| Current area status | [27-area acceptance ledger](../release/acceptance-ledger.md) and its generated five-stage snapshot. |
| Source/test evidence | This audit's [machine-readable surface inventory](capability-audit.json) plus feature-specific source documents and tests. Test existence is not a pass result. |
| Remaining work | [Current gap register](../remaining-chatgpt-gaps.md), including final-goal source gaps and genuine approval/live dependencies. |
| Hosted CI/review | Exact reviewed commit and terminal workflow evidence. It verifies only the implemented scope on that tree. |
| Staging/production | Approved deployment record, real provider/account canaries, deployed SHA/image, monitoring, backup/recovery, and rollback. Not established by this audit. |
| Boundaries | [Scope-boundary register](intentionally-excluded.md). Voice and native experiences are required incomplete scope, not exclusions. |

A green suite, route, model label, empty app manifest, or historical audit must never be converted into
full capability, provider availability, paid entitlement, production readiness, or a new progress
percentage.
