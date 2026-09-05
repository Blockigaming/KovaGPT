import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
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

test("Canvas owner/member access, audience separation, revision CAS and replay", async () => {
  const db = await fixture();
  try {
    const a = await as(db, owner, "open", personal);
    const id = a.document.id;
    await assert.rejects(as(db, outsider, "get", { documentId: id }), /access_denied/);
    const b = await as(db, editor, "open", shared);
    assert.equal(b.document.project_id, project);
    assert.equal(b.document.private_owner_id, null);
    const read = await as(db, viewer, "get", { documentId: b.document.id });
    assert.equal(read.canEdit, false);
    await assert.rejects(
      as(db, viewer, "save", {
        documentId: b.document.id,
        expectedRevision: 1,
        content: "overwrite",
      }),
      /access_denied/,
    );
    await assert.rejects(
      as(db, editor, "open", { ...personal, projectId: project }),
      /invalid_project_origin/,
    );
    const saved = await as(db, owner, "save", {
      documentId: id,
      expectedRevision: 1,
      content: "Changed",
    });
    assert.equal(saved.document.revision, 2);
    assert.equal(
      (await as(db, owner, "save", { documentId: id, expectedRevision: 1, content: "Changed" }))
        .document.revision,
      2,
    );
    await assert.rejects(
      as(db, owner, "save", { documentId: id, expectedRevision: 1, content: "Other device" }),
      /revision_conflict/,
    );
    assert.equal(
      (await db.query("select content from public.chat_message_versions where accepted")).rows[0]
        .content,
      "Changed",
    );
    await db.query("delete from public.project_members where user_id=$1", [editor]);
    await assert.rejects(as(db, editor, "get", { documentId: b.document.id }), /access_denied/);
    await assert.rejects(
      as(db, editor, "presence", {
        kind: "canvas",
        resourceId: b.document.id,
        sessionId: session,
        sequence: 1,
      }),
      /access_denied/,
    );
  } finally {
    await db.close();
  }
});

test("legacy personal history is preserved only for its owner and old writes invalidate CAS", async () => {
  const db = await fixture();
  try {
    await db.query(
      "insert into public.chat_message_versions(owner_id,chat_id,message_id,content,version,accepted)values($1,$2,$3,'Old draft',1,false),($1,$2,$3,'Accepted draft',2,true)",
      [owner, personal.chatId, personal.messageId],
    );
    const a = await as(db, owner, "open", personal);
    assert.equal(a.document.content, "Accepted draft");
    assert.equal(a.versions.length, 3);
    assert.equal(
      (await as(db, owner, "get_version", { documentId: a.document.id, revision: 1 })).content,
      "Old draft",
    );
    await db.query(
      "update public.chat_message_versions set content='Other UI update' where owner_id=$1 and accepted",
      [owner],
    );
    await assert.rejects(
      as(db, owner, "save", {
        documentId: a.document.id,
        expectedRevision: a.document.revision,
        content: "Stale Canvas",
      }),
      /revision_conflict/,
    );
    const b = await as(db, outsider, "open", personal);
    assert.equal(b.document.content, personal.content);
    const s = await as(db, editor, "open", shared);
    assert.equal(s.versions.length, 1);
  } finally {
    await db.close();
  }
});

test("anchored comments are immutable, idempotent, bounded and role protected", async () => {
  const db = await fixture();
  try {
    const a = await as(db, editor, "open", shared);
    const request = {
      documentId: a.document.id,
      expectedRevision: 1,
      commentId: session,
      body: "Check this",
      start: 0,
      end: 6,
    };
    const c = await as(db, editor, "comment", request);
    assert.equal(c.comments[0].anchor.quote, "Shared");
    assert.equal((await as(db, editor, "comment", request)).comments.length, 1);
    await assert.rejects(as(db, editor, "comment", { ...request, end: 5 }), /comment_id_conflict/);
    await assert.rejects(
      as(db, viewer, "comment", { ...request, commentId: viewer }),
      /access_denied/,
    );
    await assert.rejects(
      as(db, editor, "comment", { ...request, commentId: editor, start: -1 }),
      /invalid_comment_anchor/,
    );
    await assert.rejects(
      as(db, editor, "comment", { ...request, expectedRevision: 0 }),
      /revision_conflict/,
    );
    await assert.rejects(
      as(db, viewer, "delete_comment", { documentId: a.document.id, commentId: session }),
      /access_denied/,
    );
    assert.equal(
      (await as(db, owner, "delete_comment", { documentId: a.document.id, commentId: session }))
        .comments.length,
      0,
    );
    await assert.rejects(as(db, editor, "comment", request), /comment_id_conflict/);
    assert.equal(
      (await db.query("select body,anchor from public.canvas_comments where id=$1", [session]))
        .rows[0].body,
      "[deleted]",
    );
    assert.equal((await as(db, editor, "get", { documentId: a.document.id })).comments.length, 0);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [editor]);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("update public.canvas_documents set project_id=null"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("update public.project_notes set content='bypass'"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("insert into public.project_comments(id) values(gen_random_uuid())"),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});

test("presence expiry and author are server-controlled; leave cannot be resurrected", async () => {
  const db = await fixture();
  try {
    const input = {
      kind: "project",
      resourceId: project,
      sessionId: session,
      sequence: 1,
      actorId: outsider,
      expires_at: "2999-01-01",
    };
    await as(db, editor, "presence", input);
    const row = (await db.query("select * from public.collaboration_presence")).rows[0];
    assert.equal(row.actor_id, editor);
    assert.ok(new Date(row.expires_at).getTime() < Date.now() + 60000);
    assert.equal((await as(db, owner, "presence", { ...input, sessionId: owner })).peers, 1);
    await as(db, editor, "leave", { ...input, sequence: 2 });
    await as(db, editor, "presence", { ...input, sequence: 3 });
    assert.equal(
      (await as(db, owner, "presence", { ...input, sessionId: owner, sequence: 2 })).peers,
      0,
    );
    await as(db, viewer, "leave", { ...input, sessionId: viewer });
    await as(db, viewer, "presence", { ...input, sessionId: viewer });
    assert.equal(
      (
        await db.query("select closed from public.collaboration_presence where actor_id=$1", [
          viewer,
        ])
      ).rows[0].closed,
      true,
    );
    await db.query("delete from public.project_members where user_id=$1", [viewer]);
    await assert.rejects(
      as(db, viewer, "presence", { ...input, sessionId: viewer, sequence: 10 }),
      /access_denied/,
    );
  } finally {
    await db.close();
  }
});

test("shared notes use initial revision zero and reject stale overwrites", async () => {
  const db = await fixture();
  try {
    assert.equal((await as(db, viewer, "note_get", { projectId: project })).revision, 0);
    await assert.rejects(
      as(db, viewer, "note_save", { projectId: project, expectedRevision: 0, content: "Write" }),
      /access_denied/,
    );
    const first = await as(db, editor, "note_save", {
      projectId: project,
      expectedRevision: 0,
      content: "Editor note",
    });
    assert.equal(first.revision, 1);
    assert.equal(
      (
        await as(db, editor, "note_save", {
          projectId: project,
          expectedRevision: 0,
          content: "Editor note",
        })
      ).revision,
      1,
    );
    await assert.rejects(
      as(db, owner, "note_save", {
        projectId: project,
        expectedRevision: 0,
        content: "Conflicting note",
      }),
      /revision_conflict/,
    );
    await db.query("update public.project_notes set content='Legacy write' where project_id=$1", [
      project,
    ]);
    await assert.rejects(
      as(db, editor, "note_save", { projectId: project, expectedRevision: 1, content: "Stale" }),
      /revision_conflict/,
    );
  } finally {
    await db.close();
  }
});

test("Project comments recheck roles and mentions, redact deletion and retain retry tombstones", async () => {
  const db = await fixture();
  try {
    const input = {
      projectId: project,
      commentId: session,
      body: "Discuss this",
      anchor: "Notes",
      mentions: [viewer],
    };
    assert.equal((await as(db, editor, "project_comment", input)).length, 1);
    assert.equal((await as(db, editor, "project_comment", input)).length, 1);
    assert.equal((await db.query("select count(*)::int n from project_activity")).rows[0].n, 1);
    await assert.rejects(
      as(db, viewer, "project_comment", { ...input, commentId: viewer }),
      /access_denied/,
    );
    await assert.rejects(
      as(db, editor, "project_comment", { ...input, commentId: editor, mentions: [outsider] }),
      /invalid_mentions/,
    );
    await assert.rejects(
      as(db, editor, "project_comment", { ...input, body: "different" }),
      /comment_id_conflict/,
    );
    await assert.rejects(as(db, viewer, "project_comment_delete", input), /access_denied/);
    assert.equal((await as(db, owner, "project_comment_delete", input)).length, 0);
    await assert.rejects(as(db, editor, "project_comment", input), /comment_id_conflict/);
    assert.equal((await db.query("select body from project_comments")).rows[0].body, "[deleted]");
  } finally {
    await db.close();
  }
});
test("Canvas history preserves empty and long complete documents and respects deletion fences", async () => {
  const db = await fixture();
  try {
    const opened = await as(db, owner, "open", personal);
    let revision = opened.document.revision;
    for (const content of ["", "x".repeat(150000)]) {
      const saved = await as(db, owner, "save", {
        documentId: opened.document.id,
        expectedRevision: revision,
        content,
      });
      revision = saved.document.revision;
      assert.equal(saved.document.content, content);
      assert.equal(
        (await db.query("select content from chat_message_versions where accepted")).rows[0]
          .content,
        content,
      );
    }
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    await assert.rejects(as(db, owner, "get", { documentId: opened.document.id }), /access_denied/);
    await assert.rejects(as(db, owner, "open", personal), /access_denied/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [outsider]);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select * from canvas_documents")).rows.length, 0);
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
