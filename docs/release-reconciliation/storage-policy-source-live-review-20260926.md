# Storage policy replay review: current source versus live catalog

Status on September 26 ET / September 27 UTC: **source and read-only catalog review, not an approval to modify production or replay policies.** M17 and M18 remain open.

The fresh [managed-schema comparison](managed-schema-production-vs-empty-20260926.md) found nine `storage.objects` policies in production and zero in an empty version-matched target. The September 23 [named production policy catalog](managed-schema-recovery-catalog-20260923.json) lists the same nine names. Review the current source migrations in order before replaying any of them:

| Live policy names | Later source operation | Recovery interpretation |
| --- | --- | --- |
| `agent evidence owner read` | `20260902013000_storage_bucket_and_default_privilege_reconciliation.sql:38-47` drops this old name and recreates only `Owners read agent evidence`. | Do not automatically carry forward the old-name policy. |
| `Owners read agent evidence` | That September 2 migration drops and recreates the same name with `TO authenticated`. | Compare the live definition and target role semantics before replay. |
| `Users read own library images` | Created by `20260625135417_6425af75-f761-4dd6-9fcc-069b8c504829.sql`; the later September 5 removal addresses its sibling write/delete policies, not this read policy. | Review against the current private-bucket access contract. |
| `Users upload to own library folder`, `Users delete own library images` | `20260905033500_library_image_storage_quota.sql:35-36` drops both after introducing the reservation/quota model. | Do not replay browser upload/delete access into that model without a separate decision. |
| `project_files_read` | `20260904200000_project_file_upload_integrity.sql:1087-1108` drops and recreates this name with a ready-item and membership predicate. | Compare the live predicate with the later source definition before replay. |
| `project_files_write`, `project_files_update`, `project_files_delete` | `20260904200000_project_file_upload_integrity.sql:1087-1090` drops all three; that migration recreates only the read policy. | Do not automatically carry forward direct browser write/update/delete access. |

Thus **six live policy names are explicitly dropped by later source migrations without same-name recreation**: the old agent-evidence policy, two library image write/delete policies, and three project-file write/update/delete policies. The three other live names require definition review; a matching name alone is not semantic proof. This is a comparison to the current source tree, which has 185 migration files, while the reviewed production checkpoint contains 98 remote versions. The later source migrations have not been approved for production application, so the difference does not establish a production fault.

The read-only September 27 bucket observation has `agent-evidence` (private) and `brand-assets` (public), but no `library-images` or `project-files` bucket. Source migrations define those later buckets. Reconcile bucket creation, policies, ACLs, and object bytes together on an approved isolated target. Keep the production project unchanged pending the history/schema proofs, recovery packet, and separate production authorization.
