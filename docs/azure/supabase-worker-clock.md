# Replace paid Azure worker starts with the existing Supabase clock

Scope: production project `mfbycmbjygcfkrsuepxf`, existing Kova HTTPS endpoints,
and the existing scheduled-task and email-worker credentials. No new hosting
resource, API key, spending limit, model setting, or user account is required.

1. Obtain confirmation to copy the two existing worker credentials from Azure
   into this project's encrypted Vault. Never display them, put them in shell
   history, commit them, or include them in a receipt.
2. Install `scripts/azure/supabase-worker-clock-bootstrap.sql` as postgres. Read
   existing application secrets inside the authenticated Azure operator process
   and POST only those two credentials to the fixed project's import RPC using
   its existing service-role credential. Reject redirects; suppress all provider
   error bodies. The RPC returns only a boolean and does not start scheduling.
3. Drop the temporary import RPC. Verify the two secret names exist without
   reading their values back to the operator.
4. Execute `scripts/azure/supabase-worker-clock.sql` as postgres. It fails before
   activation if prerequisites are missing or the named job already exists.
5. Observe successful 2xx JSON `ok:true` receipts for both fixed endpoints using
   `net._http_response`. Verify cron execution and the normal scheduled-task
   heartbeat. HTTP enqueue success alone does not prove delivery.
6. Suspend `kovagpt-scheduled-execution` and `kovagpt-auth-email` in Azure only
   after both lanes work. Preserve both job configurations for rollback. Verify
   no new Azure executions start after suspension, allowing in-flight runs to
   finish.

This replaces the trigger, preserving one-minute cadence, signed email requests,
fixed empty request bodies, existing application authorization, and queue leases.
It removes Azure job compute use; existing database and website usage remains.
It does not itself disable self-hosted authentication or change email recipients.

Rollback: unschedule only `kova-worker-clock`, then resume the two existing Azure
jobs. Do not delete Vault credentials or existing Azure jobs during the cutover.

## Validation performed before activation

The exact clock SQL ran against the installed production extensions inside an
explicit transaction with synthetic credentials, followed by rollback. Both
queued requests had the fixed HTTPS destination, POST, `{}` body and 120-second
timeout. PostgreSQL's email HMAC matched the existing Node signing function.
A fresh query confirmed zero fixture secrets, cron jobs, and HTTP requests
remained. No HTTP request was committed or sent by this test. Real credential
transfer, real endpoint receipts and Azure suspension remain activation gates.
