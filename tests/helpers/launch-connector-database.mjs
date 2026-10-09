import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
const ident = (value) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("unsafe test identifier");
  return `"${value}"`;
};
export const OWNER_A = "11111111-1111-4111-8111-111111111111";
export const OWNER_B = "22222222-2222-4222-8222-222222222222";
export async function connectorDatabase() {
  const sql = new PGlite();
  await sql.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    insert into auth.users values('${OWNER_A}'),('${OWNER_B}');`);
  const original = await readFile(
    new URL(
      "../../supabase/migrations/20260727210000_constellation_connectors_agents.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await sql.exec(original.split("create table if not exists public.agent_runs")[0]);
  await sql.exec(`grant usage on schema public,auth to authenticated,service_role;
    grant select on public.integration_linked_accounts to authenticated;
    grant all on all tables in schema public to service_role;
    alter table public.integration_linked_accounts enable row level security;
    create policy "linked account owner read" on public.integration_linked_accounts for select using(auth.uid()=owner_id);`);
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20261008153032_launch_connector_runtime.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await sql.exec(migration);
  await sql.exec(migration); // Must remain safe to replay.
  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.values = [];
      this.columns = "*";
      this.kind = "select";
    }
    select(columns = "*") {
      this.columns = columns;
      this.returning = true;
      return this;
    }
    insert(data) {
      this.kind = "insert";
      this.payload = data;
      return this;
    }
    update(data) {
      this.kind = "update";
      this.payload = data;
      return this;
    }
    eq(key, value) {
      this.values.push(value);
      this.filters.push(`${ident(key)}=$${this.values.length}`);
      return this;
    }
    gt(key, value) {
      this.values.push(value);
      this.filters.push(`${ident(key)}>$${this.values.length}`);
      return this;
    }
    is(key, value) {
      if (value !== null) throw new Error("fixture only supports IS NULL");
      this.filters.push(`${ident(key)} is null`);
      return this;
    }
    maybeSingle() {
      this.single = true;
      return this;
    }
    then(resolve, reject) {
      return this.run().then(resolve, reject);
    }
    async run() {
      try {
        const cols = this.columns === "*" ? "*" : this.columns.split(",").map(ident).join(",");
        const values = [...this.values];
        const where = this.filters.length ? ` where ${this.filters.join(" and ")}` : "";
        let statement;
        if (this.kind === "select")
          statement = `select ${cols} from public.${ident(this.table)}${where}`;
        else {
          const keys = Object.keys(this.payload);
          const marks = keys.map((key) => {
            values.push(this.payload[key]);
            return `$${values.length}`;
          });
          statement =
            this.kind === "insert"
              ? `insert into public.${ident(this.table)}(${keys.map(ident).join(",")}) values(${marks.join(",")})`
              : `update public.${ident(this.table)} set ${keys.map((key, i) => `${ident(key)}=${marks[i]}`).join(",")}${where}`;
          if (this.returning) statement += ` returning ${cols}`;
        }
        const result = await sql.query(statement, values);
        if (this.single && result.rows.length > 1) throw new Error("multiple rows");
        return { data: this.single ? (result.rows[0] ?? null) : result.rows, error: null };
      } catch (error) {
        return { data: null, error };
      }
    }
  }
  const db = {
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      try {
        let query, values;
        if (name === "settle_launch_connector") {
          query =
            "select public.settle_launch_connector($1::uuid,$2::text,$3::uuid,$4::text,$5::jsonb) as value";
          values = [
            args.p_owner,
            args.p_provider,
            args.p_state,
            args.p_nonce_hash,
            JSON.stringify(args.p_account),
          ];
        } else if (name === "disconnect_launch_connector") {
          query = "select public.disconnect_launch_connector($1::uuid,$2::text,$3::uuid) as value";
          values = [args.p_owner, args.p_provider, args.p_account];
        } else throw new Error("unsupported RPC");
        return { data: (await sql.query(query, values)).rows[0].value, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
  return { db, sql, close: () => sql.close() };
}
