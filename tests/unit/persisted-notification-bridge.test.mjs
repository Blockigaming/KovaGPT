import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 persistedNoticeKind,pendingPersistedNotices,safePersistedNoticeActionUrl,
} from "../../src/lib/persisted-notification-policy.mjs";
const id="550e8400-e29b-41d4-a716-446655440000";
const task=(type)=>({id,type,title:"Task complete",preview:"Done",readAt:null,actionUrl:"/scheduled-tasks",source:"application"});
test("real persisted task results and errors map to catalog IDs",()=>{
 assert.equal(persistedNoticeKind(task("task_result")),"task_completed");
 assert.equal(persistedNoticeKind(task("task_failure")),"task_failed");
 assert.equal(persistedNoticeKind(task("not_a_real_type")),null);
 assert.equal(persistedNoticeKind({...task("task_result"),readAt:"2026-11-10T12:00:00Z"}),null);
});
test("only eligible unread notifications are surfaced and old inbox records remain",()=>{
 const rows=[task("task_result"),{...task("task_failure"),id:"650e8400-e29b-41d4-a716-446655440001"},
  {...task("task_result"),id:"750e8400-e29b-41d4-a716-446655440002"}];
 assert.equal(pendingPersistedNotices(rows,new Set(),2).length,2);
 assert.equal(pendingPersistedNotices(rows,new Set([id]),2).length,2);
 assert.equal(pendingPersistedNotices(rows,new Set(rows.map(r=>r.id)),2).length,0);
});
test("untrusted notification action links never leave app origin",()=>{
 assert.equal(safePersistedNoticeActionUrl("/scheduled-tasks"),"/scheduled-tasks");
 assert.equal(safePersistedNoticeActionUrl("/projects/abc?tab=activity"),"/projects/abc?tab=activity");
 for(const candidate of ["https://evil.test","//evil.test","javascript:alert(1)","/\\evil.test","/x\nHeader:bad"]){
  assert.equal(safePersistedNoticeActionUrl(candidate),null,candidate);
 }
});
test("root has one global host and an authenticated persisted-notice bridge",()=>{
 const root=readFileSync("src/routes/__root.tsx","utf8");
 assert.match(root,/<KovaNotificationSurface key=/);
 assert.match(root,/<PersistedNoticeBridge key=\{user\.id\}/);
 const bridge=readFileSync("src/components/PersistedNoticeBridge.tsx","utf8");
 assert.match(bridge,/listNotifications/);
 assert.match(bridge,/markNotificationsRead/);
 assert.match(bridge,/document\.visibilityState === "visible"/);
});

test("server-emitted project, connection, research and security events retain their semantics",()=>{
 const types={
   project_invitation:"invitation_received",
   project_role_change:"permission_changed",
   connector_reauth:"connection_expired",
   deep_research_complete:"research_completed",
   security_alert:"security_check",
 };
 for(const [type,id] of Object.entries(types)){
  assert.equal(persistedNoticeKind(task(type)),id,type);
 }
 for(const type of ["billing_issue","usage_threshold"]){
  assert.equal(persistedNoticeKind(task(type)),null,"no fabricated billing/usage status for "+type);
 }
});
