import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { planUpgrade } from "../../scripts/release/upgrade-database.mjs";

// Only the pre-Day-15 dependencies are stubbed. All ten captured production
// workspace migrations and all five pending source migrations execute verbatim.
test("populated production workspace history upgrades without losing canonical data or RLS", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,service_role;
    create table public.projects(id uuid primary key,owner_id uuid,system_prompt text);
    create table public.project_members(project_id uuid,user_id uuid);
    create table public.project_files(id uuid primary key,project_id uuid,name text,mime_type text);
    create table public.project_file_chunks(file_id uuid,project_id uuid,content text,chunk_index integer);
    create table public.user_library_items(id uuid primary key,user_id uuid,title text,item_type text,file_name text,file_type text,content_text text);
    grant select on public.projects,public.project_members,public.project_files,
      public.project_file_chunks,public.user_library_items to authenticated;
    alter table public.projects enable row level security;
    alter table public.project_members enable row level security;
    alter table public.project_files enable row level security;
    alter table public.project_file_chunks enable row level security;
    alter table public.user_library_items enable row level security;
    create policy members_self on public.project_members for select to authenticated
      using(user_id=(select auth.uid()));
    create policy projects_access on public.projects for select to authenticated
      using(owner_id=(select auth.uid()) or exists(
        select 1 from public.project_members m where m.project_id=projects.id and m.user_id=(select auth.uid())));
    create policy files_access on public.project_files for select to authenticated
      using(exists(select 1 from public.projects p where p.id=project_files.project_id));
    create policy chunks_access on public.project_file_chunks for select to authenticated
      using(exists(select 1 from public.projects p where p.id=project_file_chunks.project_id));
    create policy library_self on public.user_library_items for select to authenticated
      using(user_id=(select auth.uid()));

      create function public.touch_updated_at() returns trigger language plpgsql as
        $$begin new.updated_at=now(); return new; end$$;
      create function public.disconnect_github_account(uuid,boolean) returns jsonb
        language sql as $$select '{}'::jsonb$$;
      create function public.promote_agent_deliverable(uuid,text,uuid,text,text,boolean)
        returns jsonb language sql as $$select '{}'::jsonb$$;
      create function public.validate_agent_dependency_edge() returns trigger
        language plpgsql as $$begin return new; end$$;
      create function public.set_deep_research_updated_at() returns trigger
        language plpgsql as $$begin return new; end$$;
      create function public.prevent_financial_entry_mutation() returns trigger
        language plpgsql as $$begin return new; end$$;
    `);
    const baseline = planUpgrade().baseline.filter((row) => row.path.includes("day15"));
    assert.equal(baseline.length, 10);
    for (const migration of baseline) await db.exec(migration.content.toString());
    await db.exec(
      readFileSync(
        new URL("../../scripts/release/upgrade-database-seed.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const filename of [
      "20260823220701_day15_chat_workspace_production_contract.sql",
      "20260823220805_day15_chat_workspace_atomic_rpcs.sql",
      "20260824090000_day15_chat_workspace_reconciliation.sql",
      "20260824094500_day15_canonical_workspace_rpc_aliases.sql",
      "20260904230332_canonical_chat_workspace_lineage_reconciliation.sql",
    ]) {
      await db.exec(
        readFileSync(new URL(`../../supabase/migrations/${filename}`, import.meta.url), "utf8"),
      );
    }
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      "11111111-1111-4111-8111-111111111111",
    ]);
    assert.deepEqual(
      (
        await db.query(
          "select source,instruction,selection_start,selection_end,accepted from public.chat_message_versions",
        )
      ).rows,
      [
        {
          source: "retry",
          instruction: "Keep this instruction",
          selection_start: 0,
          selection_end: 2,
          accepted: true,
        },
      ],
    );
    assert.equal(
      (await db.query("select status from public.chat_pinned_files")).rows[0].status,
      "active",
    );
    assert.equal(
      (await db.query("select char_length(chat_id) as length from public.chat_branches")).rows[0]
        .length,
      200,
    );
    await assert.rejects(
      db.query(
        `select public.create_chat_message_version(
      p_chat_id=>$1,p_message_id=>'invalid-selection',p_content=>'text',
      p_original_content=>'😀',p_selection_start=>0,p_selection_end=>3)`,
        ["x".repeat(200)],
      ),
      /invalid_selection_range/,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      "22222222-2222-4222-8222-222222222222",
    ]);
    for (const table of ["chat_message_versions", "chat_branches", "chat_pinned_files"]) {
      assert.equal(
        (await db.query(`select count(*)::integer as count from public.${table}`)).rows[0].count,
        0,
      );
    }
  } finally {
    await db.close();
  }
});
