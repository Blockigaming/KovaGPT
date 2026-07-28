import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.WORKER_SMOKE_EMAIL;
const password = process.env.WORKER_SMOKE_PASSWORD;
if (!url || !serviceKey || !email || !password)
  throw new Error(
    "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_SMOKE_EMAIL and WORKER_SMOKE_PASSWORD are required",
  );
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let user = (await admin.auth.admin.listUsers()).data.users.find(
  (candidate) => candidate.email === email,
);
if (!user) {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  user = created.data.user;
}
const queued = await admin
  .from("agent_jobs")
  .insert({ owner_id: user.id, kind: "browser", input: { url: "https://example.com/" } })
  .select()
  .single();
if (queued.error) throw queued.error;
const deadline = Date.now() + 90000;
let job;
while (Date.now() < deadline) {
  job = (await admin.from("agent_jobs").select("*").eq("id", queued.data.id).single()).data;
  if (["completed", "failed"].includes(job?.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (job?.status !== "completed" || !job.result?.text)
  throw new Error(`Browser run did not complete: ${job?.status}`);
const event = (
  await admin
    .from("agent_run_events")
    .select("*")
    .eq("job_id", job.id)
    .eq("event_type", "screenshot")
    .single()
).data;
if (!event) throw new Error("Screenshot event missing");
const downloaded = await admin.storage.from("agent-evidence").download(event.payload.storage_path);
if (downloaded.error) throw downloaded.error;
const actual = createHash("sha256")
  .update(Buffer.from(await downloaded.data.arrayBuffer()))
  .digest("hex");
if (actual !== event.payload.sha256) throw new Error("Screenshot SHA-256 mismatch");
await admin.storage.from("agent-evidence").remove([event.payload.storage_path]);
const second = await admin
  .from("agent_jobs")
  .insert({
    owner_id: user.id,
    kind: "browser",
    status: "paused",
    input: { url: "https://example.com/" },
  })
  .select()
  .single();
if (second.error) throw second.error;
const cancelled = await admin
  .from("agent_jobs")
  .update({ status: "cancelled", completed_at: new Date().toISOString() })
  .eq("id", second.data.id)
  .eq("status", "paused")
  .select()
  .single();
if (cancelled.error || cancelled.data.status !== "cancelled")
  throw new Error("Cancellation verification failed");
await admin.from("agent_jobs").delete().in("id", [job.id, second.data.id]);
console.log(
  JSON.stringify({
    status: "ok",
    screenshot_sha256: actual,
    textual_result: true,
    cleanup: true,
    cancellation: true,
  }),
);
