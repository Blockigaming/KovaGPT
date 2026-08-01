import { createClient } from "@supabase/supabase-js";

const workerUrl = process.env.AGENT_WORKER_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!workerUrl || !supabaseUrl || !serviceKey)
  throw new Error("AGENT_WORKER_URL, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are required");

const readiness = await fetch(new URL("/readyz", workerUrl), {
  signal: AbortSignal.timeout(10_000),
});
const readinessBody = await readiness.json().catch(() => null);
if (
  readiness.status !== 503 ||
  readinessBody?.execution_enabled !== false ||
  readinessBody?.reason !== "agent_runtime_unavailable"
)
  throw new Error("Agent worker did not fail closed");

const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const [runEvents, jobEvents] = await Promise.all([
  db.from("agent_run_events").select("run_id,kind,safe_payload").limit(0),
  db.from("agent_job_events").select("job_id,event_type,payload").limit(0),
]);

if (runEvents.error) throw new Error("Constellation run-event schema is unavailable");
if (jobEvents.error) throw new Error("Helios job-event schema is unavailable");

console.log(
  JSON.stringify({
    status: "ok",
    execution_enabled: false,
    fail_closed: true,
    run_event_schema: true,
    job_event_schema: true,
    writes_performed: false,
  }),
);
