# Fresh database isolated-run tail

Generated on the stacked draft branch using a local ephemeral Supabase instance.
No hosted Supabase or Azure resource was accessed.

Exit status: `1`

```text
Applying migration 20260718151609_cefd6de4-78df-4847-9616-1156e2feae22.sql...
Applying migration 20260718152250_f4747acd-8022-4ff5-90f3-8cdc49e59086.sql...
NOTICE (00000): policy "Members can read project chunks" for relation "public.project_file_chunks" does not exist, skipping
Applying migration 20260718154259_5b0dc97b-80d5-4ee2-927a-3927dad6c020.sql...
Applying migration 20260721211500_deep_research_runs.sql...
NOTICE (00000): trigger "deep_research_runs_updated_at" for relation "public.deep_research_runs" does not exist, skipping
Applying migration 20260722123000_connectors_tasks_sharing_settings_audit.sql...
NOTICE (00000): policy "connected accounts owner read" for relation "public.connected_accounts" does not exist, skipping
NOTICE (00000): policy "connected accounts owner delete" for relation "public.connected_accounts" does not exist, skipping
NOTICE (00000): policy "task runs owner read" for relation "public.scheduled_task_runs" does not exist, skipping
NOTICE (00000): policy "notifications owner read" for relation "public.notification_deliveries" does not exist, skipping
NOTICE (00000): policy "share links owner crud" for relation "public.chat_share_links" does not exist, skipping
NOTICE (00000): policy "preferences owner crud" for relation "public.user_preferences" does not exist, skipping
NOTICE (00000): policy "audit owner read" for relation "public.account_audit_entries" does not exist, skipping
Applying migration 20260722130000_product_completeness_reliability.sql...
Applying migration 20260727090000_context_packs.sql...
Applying migration 20260727120000_professional_os.sql...
Applying migration 20260727150000_prompt_studio_2.sql...
Applying migration 20260727210000_constellation_connectors_agents.sql...
Applying migration 20260727230000_apollo_agent_graphs.sql...
Applying migration 20260728090000_helios_agent_runtime.sql...
Applying migration 20260728120000_zenith_work_graph.sql...
Applying migration 20260728150000_forge_deliverable_resources.sql...
Applying migration 20260728180000_mercury_github.sql...
Applying migration 20260728200000_mercury_github_oauth.sql...
Applying migration 20260728220000_mercury_github_operations.sql...
Applying migration 20260731120000_feedback_submissions_hardening.sql...
NOTICE (00000): trigger "feedback_submissions_set_updated_at" for relation "public.feedback_submissions" does not exist, skipping
NOTICE (00000): policy "Owners insert response feedback" for relation "public.feedback_submissions" does not exist, skipping
NOTICE (00000): policy "Owners read response feedback" for relation "public.feedback_submissions" does not exist, skipping
NOTICE (00000): policy "Owners update response feedback" for relation "public.feedback_submissions" does not exist, skipping
NOTICE (00000): policy "Owners delete response feedback" for relation "public.feedback_submissions" does not exist, skipping
Applying migration 20260801120000_writing_documents.sql...
Applying migration 20260801123000_research_session_management.sql...
Applying migration 20260801235959_agent_runtime_event_schema_compatibility.sql...
NOTICE (42P07): relation "agent_job_events" already exists, skipping
NOTICE (42P07): relation "agent_job_events_job_idx" already exists, skipping
Applying migration 20260802003000_google_oauth_tokens_server_only.sql...
NOTICE (00000): policy "own tokens select" for relation "public.google_oauth_tokens" does not exist, skipping
NOTICE (00000): policy "own tokens delete" for relation "public.google_oauth_tokens" does not exist, skipping
Applying migration 20260802120000_agent_definitions.sql...
Applying migration 20260802130000_agent_definition_lifecycle.sql...
Applying migration 20260802131000_agent_run_attribution.sql...
Applying migration 20260802132000_operational_analytics.sql...
Applying migration 20260803100000_knowledge_provenance.sql...
Applying migration 20260803101000_agent_run_retry_hardening.sql...
Applying migration 20260803110000_release_security_hardening.sql...
NOTICE (42701): column "processed_at" of relation "processed_stripe_events" already exists, skipping
Applying migration 20260803120000_schema_contract_health.sql...
Applying migration 20260803121000_stripe_event_ordering.sql...
Applying migration 20260803122000_distributed_diagnostics_limit.sql...
Applying migration 20260803123000_stripe_lifecycle_metadata.sql...
Applying migration 20260803130000_ai_usage_accounting.sql...
Applying migration 20260803143000_developer_api_profit_protection.sql...
Applying migration 20260803184741_2fcabe55-857e-40eb-aa49-9e3d29d99bad.sql...
NOTICE (42P07): relation "writing_documents" already exists, skipping
NOTICE (42P07): relation "writing_documents_owner_updated_idx" already exists, skipping
NOTICE (42P07): relation "writing_document_versions" already exists, skipping
NOTICE (42701): column "last_stripe_event_created_at" of relation "subscriptions" already exists, skipping
Applying migration 20260803184803_f1160e45-5203-486e-8a06-8119fae9efd6.sql...
NOTICE (42701): column "last_stripe_event_id" of relation "subscriptions" already exists, skipping
Applying migration 20260803200951_6057d47d-9e48-4651-8c9b-918d92d5de25.sql...
NOTICE (00000): policy "project_files_update" for relation "storage.objects" does not exist, skipping
Applying migration 20260803202921_1e097656-2cd6-4be0-ba5c-dcfd1146e02e.sql...
Applying migration 20260804004928_dd95bde0-8a33-4045-bf61-b54fed5230e4.sql...
NOTICE (00000): policy "banned_users_deny_clients" for relation "public.banned_users" does not exist, skipping
NOTICE (00000): policy "ai_generation_events_deny_clients" for relation "public.ai_generation_events" does not exist, skipping
NOTICE (00000): policy "pending_tool_actions_deny_clients" for relation "public.pending_tool_actions" does not exist, skipping
NOTICE (00000): policy "processed_stripe_events_deny_clients" for relation "public.processed_stripe_events" does not exist, skipping
NOTICE (00000): policy "plaid_items_deny_clients" for relation "public.plaid_items" does not exist, skipping
NOTICE (00000): policy "google_oauth_tokens_deny_client_reads" for relation "public.google_oauth_tokens" does not exist, skipping
Applying migration 20260804015247_b1e57b1d-0fd3-4abb-93f0-4b0b462124fe.sql...
Applying migration 20260805123909_98bb0463-448a-425d-ad2b-f91759cf12fa.sql...
WARN: no files matched pattern: supabase/seed.sql
Restarting containers...
A new version of Supabase CLI is available: v2.113.0 (currently installed v2.111.0)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
A new version of Supabase CLI is available: v2.113.0 (currently installed v2.111.0)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
Finished [36msupabase db reset[39m on branch [36mfix/fresh-db-stripe-event-timestamp-index[39m.
Connecting to local database...

  
   Local            | Remote           | Time (UTC)            
  ------------------|------------------|-----------------------
   `20260622225346` | `20260622225346` | `2026-06-22 22:53:46` 
   `20260623005558` | `20260623005558` | `2026-06-23 00:55:58` 
   `20260623005610` | `20260623005610` | `2026-06-23 00:56:10` 
   `20260623145549` | `20260623145549` | `2026-06-23 14:55:49` 
   `20260623154814` | `20260623154814` | `2026-06-23 15:48:14` 
   `20260623154832` | `20260623154832` | `2026-06-23 15:48:32` 
   `20260623155803` | `20260623155803` | `2026-06-23 15:58:03` 
   `20260623161227` | `20260623161227` | `2026-06-23 16:12:27` 
   `20260623161519` | `20260623161519` | `2026-06-23 16:15:19` 
   `20260623194741` | `20260623194741` | `2026-06-23 19:47:41` 
   `20260623195646` | `20260623195646` | `2026-06-23 19:56:46` 
   `20260623201628` | `20260623201628` | `2026-06-23 20:16:28` 
   `20260624124535` | `20260624124535` | `2026-06-24 12:45:35` 
   `20260624124557` | `20260624124557` | `2026-06-24 12:45:57` 
   `20260624230040` | `20260624230040` | `2026-06-24 23:00:40` 
   `20260625132920` | `20260625132920` | `2026-06-25 13:29:20` 
   `20260625135417` | `20260625135417` | `2026-06-25 13:54:17` 
   `20260627004905` | `20260627004905` | `2026-06-27 00:49:05` 
   `20260627210732` | `20260627210732` | `2026-06-27 21:07:32` 
   `20260702142256` | `20260702142256` | `2026-07-02 14:22:56` 
   `20260702161114` | `20260702161114` | `2026-07-02 16:11:14` 
   `20260702163905` | `20260702163905` | `2026-07-02 16:39:05` 
   `20260702163922` | `20260702163922` | `2026-07-02 16:39:22` 
   `20260704033129` | `20260704033129` | `2026-07-04 03:31:29` 
   `20260707004617` | `20260707004617` | `2026-07-07 00:46:17` 
   `20260707005030` | `20260707005030` | `2026-07-07 00:50:30` 
   `20260712011732` | `20260712011732` | `2026-07-12 01:17:32` 
   `20260712013949` | `20260712013949` | `2026-07-12 01:39:49` 
   `20260713010018` | `20260713010018` | `2026-07-13 01:00:18` 
   `20260718151609` | `20260718151609` | `2026-07-18 15:16:09` 
   `20260718152250` | `20260718152250` | `2026-07-18 15:22:50` 
   `20260718154259` | `20260718154259` | `2026-07-18 15:42:59` 
   `20260721211500` | `20260721211500` | `2026-07-21 21:15:00` 
   `20260722123000` | `20260722123000` | `2026-07-22 12:30:00` 
   `20260722130000` | `20260722130000` | `2026-07-22 13:00:00` 
   `20260727090000` | `20260727090000` | `2026-07-27 09:00:00` 
   `20260727120000` | `20260727120000` | `2026-07-27 12:00:00` 
   `20260727150000` | `20260727150000` | `2026-07-27 15:00:00` 
   `20260727210000` | `20260727210000` | `2026-07-27 21:00:00` 
   `20260727230000` | `20260727230000` | `2026-07-27 23:00:00` 
   `20260728090000` | `20260728090000` | `2026-07-28 09:00:00` 
   `20260728120000` | `20260728120000` | `2026-07-28 12:00:00` 
   `20260728150000` | `20260728150000` | `2026-07-28 15:00:00` 
   `20260728180000` | `20260728180000` | `2026-07-28 18:00:00` 
   `20260728200000` | `20260728200000` | `2026-07-28 20:00:00` 
   `20260728220000` | `20260728220000` | `2026-07-28 22:00:00` 
   `20260731120000` | `20260731120000` | `2026-07-31 12:00:00` 
   `20260801120000` | `20260801120000` | `2026-08-01 12:00:00` 
   `20260801123000` | `20260801123000` | `2026-08-01 12:30:00` 
   `20260801235959` | `20260801235959` | `2026-08-01 23:59:59` 
   `20260802003000` | `20260802003000` | `2026-08-02 00:30:00` 
   `20260802120000` | `20260802120000` | `2026-08-02 12:00:00` 
   `20260802130000` | `20260802130000` | `2026-08-02 13:00:00` 
   `20260802131000` | `20260802131000` | `2026-08-02 13:10:00` 
   `20260802132000` | `20260802132000` | `2026-08-02 13:20:00` 
   `20260803100000` | `20260803100000` | `2026-08-03 10:00:00` 
   `20260803101000` | `20260803101000` | `2026-08-03 10:10:00` 
   `20260803110000` | `20260803110000` | `2026-08-03 11:00:00` 
   `20260803120000` | `20260803120000` | `2026-08-03 12:00:00` 
   `20260803121000` | `20260803121000` | `2026-08-03 12:10:00` 
   `20260803122000` | `20260803122000` | `2026-08-03 12:20:00` 
   `20260803123000` | `20260803123000` | `2026-08-03 12:30:00` 
   `20260803130000` | `20260803130000` | `2026-08-03 13:00:00` 
   `20260803143000` | `20260803143000` | `2026-08-03 14:30:00` 
   `20260803184741` | `20260803184741` | `2026-08-03 18:47:41` 
   `20260803184803` | `20260803184803` | `2026-08-03 18:48:03` 
   `20260803200951` | `20260803200951` | `2026-08-03 20:09:51` 
   `20260803202921` | `20260803202921` | `2026-08-03 20:29:21` 
   `20260804004928` | `20260804004928` | `2026-08-04 00:49:28` 
   `20260804015247` | `20260804015247` | `2026-08-04 01:52:47` 
   `20260805123909` | `20260805123909` | `2026-08-05 12:39:09` 

[31mfailed to open dump file: NotFound: FileSystem.writeFile (/home/runner/work/kovagpt-790c8a3a/kovagpt-790c8a3a/artifacts/release/isolated-schema.sql)[39m
Try rerunning the command with --debug to troubleshoot the error.

```

Diagnostic evidence only. Do not infer a migration fix without reviewing the exact failing operation.
