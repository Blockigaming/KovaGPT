import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Omega exposes all backend-ready control surfaces without fake execution", async () => {
  const route = await read("src/routes/omega.tsx");
  for (const label of [
    "Collaboration",
    "Execution",
    "Enterprise",
    "MCP",
    "Providers",
    "Agent Studio",
    "Pipeline Builder",
  ])
    assert.match(route, new RegExp(label));
  assert.doesNotMatch(route, /VoicePanel|Check microphone permission|getUserMedia/);
  assert.match(route, /will not claim the service is running/);
  assert.match(route, /does not start\s+background work/);
  assert.match(route, /never\s+fabricates outputs\s+or claims execution/s);
});

test("realtime, voice, agent, and pipeline orchestration contracts are complete", async () => {
  const source = await read("src/platform/omega.ts");
  assert.match(source, /presence.*cursor.*typing.*revision.*activity/s);
  assert.match(source, /permission_required.*listening.*speaking.*interrupted.*reconnecting/s);
  assert.match(
    source,
    /queued.*waiting.*planning.*running.*approval_needed.*paused.*failed.*completed/s,
  );
  assert.match(source, /simulatePipeline/);
  assert.match(source, /Workflow contains a cycle/);
});

test("Project, Artifact, and Work surfaces expose graceful realtime degradation", async () => {
  const [project, artifact, work, status] = await Promise.all([
    read("src/components/ProjectCollaboration.tsx"),
    read("src/components/ArtifactEditor.tsx"),
    read("src/routes/work.tsx"),
    read("src/components/RealtimeReadiness.tsx"),
  ]);
  assert.match(project, /CollaborationStatus/);
  assert.match(artifact, /CollaborationStatus/);
  assert.match(work, /RealtimeReadiness/);
  assert.match(status, /Realtime unavailable/);
  const collaborationStatus = await read("src/components/CollaborationStatus.tsx");
  assert.match(collaborationStatus, /Reconnecting/);
  assert.match(collaborationStatus, /unavailable/);
});

test("MCP and enterprise configurations remain scoped drafts", async () => {
  const [route, store] = await Promise.all([
    read("src/routes/omega.tsx"),
    read("src/lib/omega-store.ts"),
  ]);
  assert.match(route, /Add unverified draft/);
  assert.match(route, /Organization service/);
  assert.match(store, /kova-omega:\$\{scope\}/);
});
