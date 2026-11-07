# KovaGPT interface cleanup — review

Local branch: `fix/owner-interface-cleanup-20261107`. Based on main through PR #603, including the Free-only Thinking toggle and paid model controls. No production deployment or live Stripe purchase was performed.

| Request | Implemented behavior                                                                                                                                                                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2     | Rounded Projects filters and list/grid controls.                                                                                                                                                                                                                                        |
| 3       | Persisted project emojis, uploaded raster logos, background colors and uploaded backgrounds, with create and edit controls.                                                                                                                                                             |
| 4       | Projects directory and card grid fill available width.                                                                                                                                                                                                                                  |
| 5       | Responsive management and Settings spacing, wrapping and control sizing.                                                                                                                                                                                                                |
| 6       | Scheduled Tasks search matches filter height.                                                                                                                                                                                                                                           |
| 7–8     | Saved-context and connection/approval sections removed from the task editor. Existing saved task execution configuration is preserved.                                                                                                                                                  |
| 9       | Cancel and Save schedule use matching rounded controls.                                                                                                                                                                                                                                 |
| 10      | Settings rows and control columns wrap and align on narrow screens.                                                                                                                                                                                                                     |
| 11      | Chat archiving and Trash entry points removed. Permanent deletion confirms first, clears legacy device copies and queues content-free sync tombstones. Project chat deletion uses caller permissions and verifies the deleted row. Existing archived chats return to the ordinary list. |
| 12      | Shared chats, Folders, Chat Trash and Details removed from Library; retired folder preferences cannot hide items.                                                                                                                                                                       |
| 13      | Library search and favorites controls match filter sizing.                                                                                                                                                                                                                              |
| 14      | Checkout and subscription management navigate to full-page Stripe. Existing embedded checkout claims reconcile before replacement.                                                                                                                                                      |
| 15      | Team purchase form, exact recurring seat prices, paid-seat invitations, acceptance, removal, Stripe quantity review, lifecycle webhooks and billing holds.                                                                                                                              |
| 16      | Rounded Back to chat on Pricing.                                                                                                                                                                                                                                                        |
| 17–18   | Left-aligned Enterprise pricing explanation and Team seat cards, preserving the requested prices.                                                                                                                                                                                       |
| 19      | Sync respects Retry-After and bounded backoff, handles revision races, resumes when the page returns, and presents session/retry states in a rounded notice.                                                                                                                            |
| 20      | Images removed from sidebar choices; chat image tools retained. Continue working uses at most two actual recommendations, with spaced rounded cards.                                                                                                                                    |

## Validation

- 279 focused unit and regression tests passed, including billing reconciliation, deletion races, scoped UI state, Team SQL permissions/capacity, and preserved model controls.
- 61 additional billing retirement and account deletion checks passed; deleting an owner retires the separate Team Customer before Auth removal and blocks late checkout bindings.
- TypeScript check passed; ESLint reports zero errors and one existing component export warning.
- Production Azure build passed, including the built-source audit.
- Project appearance SQL was executed against an isolated database: valid appearance persists; invalid backgrounds, script-capable image formats, null assets and unknown keys are rejected.
- Migration manifest, database references and acceptance ledger checks passed.
- Responsive browser verification covers 320px, 390px and 1440px viewports using synthetic authenticated fixtures. It does not establish production acceptance.

## Production limits

The two additive migrations have not been applied to production. Team needs the four live recurring Stripe prices matching `team-billing-policy.mjs`, configured webhook delivery, reviewed tax configuration, and a real payment/invitation acceptance run. Both seat types currently use the existing Pro model-access entitlement; a separate Premium usage multiplier is not implemented or advertised.

Team customers are included in final account retirement, with database locking against late checkout bindings. Live diagnosis of the reported sync failure remains necessary; local retry/reconciliation tests cannot prove the production database and authentication configuration.

The GitHub push was rejected by automatic approval review. This branch has not been published, merged or deployed.
