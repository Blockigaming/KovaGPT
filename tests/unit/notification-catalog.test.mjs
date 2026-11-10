import test from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_GROUPS, NOTIFICATION_IDS, notificationDefinition, selectNotificationQueue } from "../../src/lib/notification-catalog.mjs";
test("catalog covers distinct notification identifiers across all major families", () => {
  assert.ok(Object.keys(NOTIFICATION_GROUPS).length >= 12);
  assert.ok(NOTIFICATION_IDS.length >= 180);
  assert.equal(new Set(NOTIFICATION_IDS).size, NOTIFICATION_IDS.length);
  assert.equal(notificationDefinition("missing_event"), null);
});
test("status claims require confirmed server success", () => {
  assert.equal(selectNotificationQueue([{id:"workspace_join_requested"}]).length,0);
  assert.equal(selectNotificationQueue([{id:"workspace_join_requested",confirmed:true}]).length,1);
  assert.equal(selectNotificationQueue([{id:"offer_available"}]).length,0);
});
test("security confirmation outranks promotion and promotions do not interrupt typing", () => {
  const events=[{id:"whats_new"},{id:"confirm_account_delete"},{id:"copied"}];
  assert.equal(selectNotificationQueue(events)[0].id,"confirm_account_delete");
  assert.equal(selectNotificationQueue(events,{isComposing:true}).some(x=>x.id==="whats_new"),false);
});
test("same event is not shown multiple times simultaneously", () => {
  assert.equal(selectNotificationQueue([{id:"copied"},{id:"copied"}]).length,1);
});
