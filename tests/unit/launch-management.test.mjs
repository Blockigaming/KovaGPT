import assert from "node:assert/strict";
import test from "node:test";
import { readLaunchManagement } from "../../src/integrations/launch-management.server.mjs";
import { connectorDatabase, OWNER_A, OWNER_B } from "../helpers/launch-connector-database.mjs";
test("management uses real schema, bounded owner/provider pages and never returns credentials", async (t) => {
  const store = await connectorDatabase();
  t.after(() => store.close());
  await store.sql
    .exec(`insert into integration_linked_accounts(id,owner_id,provider_id,provider_account_id,account_label,access_token_ciphertext,granted_scopes)
    select ('33333333-3333-4333-8333-' || lpad(i::text,12,'0'))::uuid,'${OWNER_A}','outlook',i::text,'Account '||i,'NEVER-RETURN',array['Mail.Read'] from generate_series(1,23) i;
    insert into integration_linked_accounts(owner_id,provider_id,provider_account_id,access_token_ciphertext) values
    ('${OWNER_B}','outlook','foreign','FOREIGN-SECRET'),('${OWNER_A}','notion','other-provider','OTHER-SECRET');`);
  const input = { db: store.db, ownerId: OWNER_A, connector: "outlook" };
  const first = await readLaunchManagement(input);
  assert.equal(first.accounts.length, 20);
  assert.equal(first.certified, false);
  assert.ok(!JSON.stringify(first).includes("SECRET"));
  assert.ok(!JSON.stringify(first).includes("NEVER-RETURN"));
  const second = await readLaunchManagement({ ...input, cursor: first.nextCursor });
  assert.equal(second.accounts.length, 3);
  const end = await readLaunchManagement({ ...input, cursor: second.nextCursor });
  assert.equal(end.nextCursor, null);
  assert.equal(first.accounts[0].identity, "1");
  await assert.rejects(readLaunchManagement({ ...input, cursor: "bad" }), /invalid_cursor/);
  await store.sql.exec("drop table integration_linked_accounts cascade");
  await assert.rejects(readLaunchManagement(input), /connector_store_unavailable/);
});
