import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { z } from "zod";
import { CollaborationError } from "../../src/lib/collaboration-client.mjs";
const migration = await readFile(
  new URL(
    "../../supabase/migrations/20260905000905_project_canvas_collaboration.sql",
    import.meta.url,
  ),
  "utf8",
);
const owner = "11111111-1111-4111-8111-111111111111",
  editor = "22222222-2222-4222-8222-222222222222",
  viewer = "33333333-3333-4333-8333-333333333333",
  outsider = "44444444-4444-4444-8444-444444444444";
const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  chat = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  session = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
async function fixture() {
  const db = new PGlite();
  await db.exec(`
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema kova_private;grant usage on schema auth,kova_private to authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table auth.users(id uuid primary key,deleted_at timestamptz);insert into auth.users(id) values('${owner}'),('${editor}'),('${viewer}'),('${outsider}');
create table public.account_deletion_fences(user_id uuid primary key);
create table public.projects(id uuid primary key,owner_id uuid references auth.users);
create table public.project_members(project_id uuid,user_id uuid,role text,primary key(project_id,user_id));
create function public.is_project_member(p uuid,u uuid)returns boolean language sql stable security definer as $$select exists(select 1 from public.projects where id=p and owner_id=u) or exists(select 1 from public.project_members where project_id=p and user_id=u)$$;
create function public.can_edit_project(p uuid,u uuid)returns boolean language sql stable security definer as $$select exists(select 1 from public.projects where id=p and owner_id=u) or exists(select 1 from public.project_members where project_id=p and user_id=u and role='editor')$$;
create table public.project_chats(id uuid primary key,project_id uuid,snapshot jsonb);
create table public.project_notes(id uuid primary key default gen_random_uuid(),project_id uuid unique,content text,updated_by uuid,updated_at timestamptz default now());
create table public.project_activity(id uuid primary key default gen_random_uuid(),project_id uuid,actor_id uuid,kind text,summary text);
create table public.project_comments(id uuid primary key,project_id uuid,author_id uuid,body text,anchor text,mentions jsonb default '[]',created_at timestamptz default now(),updated_at timestamptz default now());
grant select,insert,update,delete on public.project_notes,public.project_comments to authenticated;
create table public.chat_message_versions(id uuid primary key default gen_random_uuid(),owner_id uuid,chat_id text,message_id text,source text,original_content text,content text,version integer,accepted boolean,created_at timestamptz default now());
create function public.kova_record_message_version(p_chat_id text,p_message_id text,p_source text,p_content text,p_accepted boolean default true) returns void language plpgsql as $$begin
 perform pg_advisory_xact_lock(hashtextextended('kova:chat-version:'||auth.uid()::text||':'||p_chat_id||':'||p_message_id,0));
 update public.chat_message_versions set accepted=false where owner_id=auth.uid() and chat_id=p_chat_id and message_id=p_message_id;
 insert into public.chat_message_versions(owner_id,chat_id,message_id,content,version,accepted)values(auth.uid(),p_chat_id,p_message_id,p_content,(select coalesce(max(version),0)+1 from public.chat_message_versions where owner_id=auth.uid() and chat_id=p_chat_id and message_id=p_message_id),p_accepted);
end$$;
insert into public.projects values('${project}','${owner}');insert into public.project_members values('${project}','${editor}','editor'),('${project}','${viewer}','viewer');
insert into public.project_chats values('${chat}','${project}','{"messages":[{"role":"assistant","content":"Shared text"}]}');
`);
  await db.exec(migration);
  await db.exec(
    "create function kova_private.auth_user_exists(u uuid)returns boolean language sql as $$select exists(select 1 from auth.users where id=u and deleted_at is null)$$;",
  );
  const workflow = await readFile(
    "supabase/migrations/20260910210000_workflow_skill_packages.sql",
    "utf8",
  );
  await db.exec(workflow.slice(0, workflow.indexOf("create table public.workflow_skills")));
  await db.exec(
    await readFile(
      process.env.KOVA_CANVAS_TITLE_MIGRATION ??
        "supabase/migrations/20261012053000_canvas_document_titles.sql",
      "utf8",
    ),
  );
  return db;
}
async function as(db, user, operation, data) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try {
    return (
      await db.query("select public.collaboration_rpc($1,$2::jsonb) as result", [
        operation,
        JSON.stringify(data),
      ])
    ).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}
const personal = {
  chatId: "personal-chat",
  messageId: "personal-message",
  content: "One 😀 selection here",
};
const shared = {
  projectId: project,
  chatId: chat,
  messageId: `project-${chat}-0`,
  content: "Shared text",
};

test("title mutations share Canvas ownership/revision without changing body; stale and replay boundaries", async () => {
  const db = await fixture();
  try {
    const opened = await as(db, owner, "open", personal),
      id = opened.document.id,
      revision = opened.document.revision;
    const input = {
      documentId: id,
      expectedRevision: revision,
      title: "Current title",
      mutationId: crypto.randomUUID(),
    };
    const saved = await as(db, owner, "save_title", input);
    assert.equal(saved.document.content, personal.content);
    assert.equal(saved.document.title, "Current title");
    assert.equal(saved.document.revision, revision + 1);
    assert.equal((await as(db, owner, "save_title", input)).document.revision, revision + 1);
    await assert.rejects(
      as(db, owner, "save_title", { ...input, title: "Changed retry" }),
      /conflict/,
    );
    await assert.rejects(
      as(db, owner, "save", { documentId: id, expectedRevision: revision, content: "stale body" }),
      /conflict/,
    );
    const body = await as(db, owner, "save", {
      documentId: id,
      expectedRevision: revision + 1,
      content: "new body",
    });
    assert.equal(body.document.title, "Current title");
    const rows = await db.query(
      "select title from canvas_revisions where document_id=$1 order by revision desc",
      [id],
    );
    assert.equal(rows.rows[0].title, "Current title");
    await assert.rejects(
      as(db, outsider, "save_title", {
        ...input,
        expectedRevision: body.document.revision,
        mutationId: crypto.randomUUID(),
      }),
      /access_denied/,
    );
    const sharedDoc = await as(db, owner, "open", shared);
    const sharedInput = {
      ...input,
      documentId: sharedDoc.document.id,
      expectedRevision: sharedDoc.document.revision,
      mutationId: crypto.randomUUID(),
    };
    await assert.rejects(as(db, viewer, "save_title", sharedInput), /access_denied/);
    await as(db, editor, "save_title", sharedInput);
    await assert.rejects(
      as(db, owner, "save_title", {
        ...sharedInput,
        mutationId: crypto.randomUUID(),
        title: "competing owner",
      }),
      /conflict/,
    );
  } finally {
    await db.close();
  }
});

// Compile the production schema/parser directly; no duplicate permissive schema.
const parserSource = await readFile("src/lib/collaboration.ts", "utf8");
const parserAst = ts.createSourceFile(
  "collaboration.ts",
  parserSource,
  ts.ScriptTarget.Latest,
  true,
);
const declarations = parserAst.statements.filter(
  (node) =>
    (ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((d) =>
        ["Anchor", "CanvasSnapshot"].includes(d.name.getText(parserAst)),
      )) ||
    (ts.isFunctionDeclaration(node) && node.name?.text === "parseCanvasSnapshot"),
);
assert.equal(declarations.length, 3);
const parserExports = {};
new Function(
  "exports",
  "z",
  "CollaborationError",
  ts.transpileModule(declarations.map((d) => d.getText(parserAst)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(parserExports, z, CollaborationError);

test("direct title RPC and persisted revision constraints agree with actual UTF-16 snapshot parser", async () => {
  const db = await fixture();
  try {
    let snapshot = await as(db, owner, "open", personal);
    const id = snapshot.document.id;
    for (const title of [
      "a".repeat(200),
      "😀".repeat(100),
      "a".repeat(198) + "😀",
      "e\u0301".repeat(100),
    ]) {
      assert.equal(title.length, 200);
      snapshot = await as(db, owner, "save_title", {
        documentId: id,
        expectedRevision: snapshot.document.revision,
        title,
        mutationId: crypto.randomUUID(),
      });
      assert.equal(parserExports.parseCanvasSnapshot(snapshot, owner).document.title, title);
      const reloaded = await as(db, owner, "get", { documentId: id });
      assert.equal(parserExports.parseCanvasSnapshot(reloaded, owner).document.title, title);
      const revision = await db.query(
        "select title,content from canvas_revisions where document_id=$1 and revision=$2",
        [id, snapshot.document.revision],
      );
      assert.equal(revision.rows[0].title, title);
      assert.equal(revision.rows[0].content, personal.content);
    }
    for (const title of ["a".repeat(201), "😀".repeat(101), "a".repeat(199) + "😀"]) {
      await assert.rejects(
        as(db, owner, "save_title", {
          documentId: id,
          expectedRevision: snapshot.document.revision,
          title,
          mutationId: crypto.randomUUID(),
        }),
        /collaboration_invalid_input/,
      );
      await assert.rejects(
        db.query("update canvas_documents set title=$1 where id=$2", [title, id]),
        /check constraint/,
      );
      await assert.rejects(
        db.query("update canvas_revisions set title=$1 where document_id=$2", [title, id]),
        /check constraint/,
      );
      const reloaded = await as(db, owner, "get", { documentId: id });
      assert.equal(
        parserExports.parseCanvasSnapshot(reloaded, owner).document.revision,
        snapshot.document.revision,
      );
      assert.equal(reloaded.document.title, snapshot.document.title);
    }
  } finally {
    await db.close();
  }
});
