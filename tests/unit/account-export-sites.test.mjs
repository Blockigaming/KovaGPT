import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { readAccountExportSiteFiles } from "../../src/lib/account-export-sites.mjs";
const OWNER = "123e4567-e89b-42d3-a456-426614174000";
const SITE = "223e4567-e89b-42d3-a456-426614174000";
const VERSION = "323e4567-e89b-42d3-a456-426614174000";

function fixture(count, { size = 3, missing = false, corrupt = false, account = false } = {}) {
  const content = Buffer.alloc(size, 97).toString("base64");
  const rows = Array.from({ length: count }, (_, index) => ({
    owner_id: OWNER,
    site_id: SITE,
    version_id: VERSION,
    path: `${String(index).padStart(5, "0")}.txt`,
    mime_type: "text/plain",
    size_bytes: size,
    sha256: createHash("sha256").update(Buffer.alloc(size, 97)).digest("hex"),
    content_base64_bytes: content.length,
  }));
  const calls = [];
  const admin = createClient("https://export.example", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(input);
        const metadata = url.pathname.endsWith("kova_site_file_export_metadata");
        if (account && !metadata && !url.pathname.endsWith("/kova_site_files"))
          return Response.json([]);
        assert.equal(url.searchParams.get("owner_id"), `eq.${OWNER}`);
        calls.push({ metadata, select: url.searchParams.get("select") });
        if (metadata) {
          assert.equal(url.searchParams.get("order"), "version_id.asc,path.asc");
          assert.ok(!url.searchParams.get("select").split(",").includes("content_base64"));
          const offset = Number(url.searchParams.get("offset"));
          return Response.json(rows.slice(offset, offset + Number(url.searchParams.get("limit"))));
        }
        assert.equal(url.searchParams.get("select"), "content_base64");
        assert.equal(url.searchParams.get("site_id"), `eq.${SITE}`);
        assert.equal(url.searchParams.get("version_id"), `eq.${VERSION}`);
        assert.ok(rows.some((row) => url.searchParams.get("path") === `eq.${row.path}`));
        return Response.json(missing ? null : { content_base64: corrupt ? "YmJi" : content });
      },
    },
  });
  return { admin, rows, calls, content };
}

async function accountWorker(client, identity) {
  const admin = {
    from: client.from.bind(client),
    auth: {
      admin: {
        getUserById: async () => {
          assert.equal(identity, undefined, "an owned export must not contact hosted Auth");
          return { data: { user: { id: OWNER, email: "owner@example.invalid" } }, error: null };
        },
      },
    },
    rpc: async (name, args) => {
      assert.equal(name, "kova_auth_account_snapshot");
      assert.deepEqual(args, {
        p_account_id: OWNER,
        p_allow_legacy: false,
        p_require_verified: false,
      });
      return { data: identity, error: null };
    },
  };
  let source = await readFile(
    new URL("../../src/lib/account-export.server.ts", import.meta.url),
    "utf8",
  );
  source = source.replace(
    'import { supabaseAdmin } from "@/integrations/supabase/client.server";',
    'const supabaseAdmin = globalThis[Symbol.for("site-export-worker-test")];',
  );
  source = source.replaceAll(/"(?:@\/lib\/|\.\/)([^"\n]+)"/gu, (_, path) =>
    JSON.stringify(new URL(`../../src/lib/${path}`, import.meta.url).href),
  );
  globalThis[Symbol.for("site-export-worker-test")] = admin;
  try {
    return await import(
      `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}#${crypto.randomUUID()}`
    );
  } finally {
    delete globalThis[Symbol.for("site-export-worker-test")];
  }
}

test("a multi-page GiB Site account is rejected before any encoded file body is requested", async () => {
  const f = fixture(600, { size: 2 * 1024 * 1024 });
  await assert.rejects(readAccountExportSiteFiles(f.admin, OWNER, 50 * 1024 * 1024), /too_large/);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls.every((call) => call.metadata));
});

test("the actual account worker uses the metadata-only Site path and rejects oversized accounts before body fetch", async () => {
  for (const oversized of [false, true]) {
    const f = fixture(oversized ? 600 : 2, {
      size: oversized ? 2 * 1024 * 1024 : 3,
      account: true,
    });
    const worker = await accountWorker(f.admin);
    if (oversized) {
      await assert.rejects(worker.buildAccountExport(OWNER, VERSION), /too_large/);
      assert.ok(f.calls.every((call) => call.metadata));
    } else {
      const artifact = await worker.buildAccountExport(OWNER, VERSION);
      const rows = JSON.parse(artifact.text).records.kova_site_files;
      assert.equal(rows.length, 2);
      assert.ok(rows.every((row) => row.content_base64 === f.content));
    }
    assert.ok(
      f.calls.every((call) => call.select !== "*"),
      "the generic collector must never fetch Site file bodies",
    );
  }
});

test("all metadata pages reserve the remaining account budget before exact single-file reads", async () => {
  const f = fixture(65);
  const expected = f.rows.map(({ content_base64_bytes: ignored, ...row }) => ({
    ...row,
    content_base64: f.content,
  }));
  const cost = Buffer.byteLength(JSON.stringify(expected)) - 2;
  await assert.rejects(readAccountExportSiteFiles(f.admin, OWNER, cost - 1), /too_large/);
  assert.ok(f.calls.every((call) => call.metadata));
  f.calls.length = 0;
  assert.deepEqual(await readAccountExportSiteFiles(f.admin, OWNER, cost), expected);
  assert.deepEqual(
    f.calls.slice(0, 2).map((call) => call.metadata),
    [true, true],
  );
  assert.equal(f.calls.slice(2).filter((call) => !call.metadata).length, 65);
});

test("the actual owned account export includes the real verified email with no hosted Auth call or credential fields", async () => {
  const previous = process.env.KOVA_AUTH_MODE;
  process.env.KOVA_AUTH_MODE = "kova";
  try {
    const f = fixture(2, { account: true });
    const worker = await accountWorker(f.admin, {
      id: OWNER,
      email: "real@example.invalid",
      email_confirmed_at: "2026-01-01T00:00:00Z",
      app_metadata: { provider: "kova", secret: "must-not-export" },
      encrypted_password: "must-not-export",
      user_metadata: { full_name: "Real Person", token: "must-not-export" },
    });
    const artifact = await worker.buildAccountExport(OWNER, VERSION);
    const exported = JSON.parse(artifact.text);
    assert.equal(exported.account.email, "real@example.invalid");
    assert.equal(exported.account.id, OWNER);
    assert.equal(exported.account.app_metadata.provider, "kova");
    assert.doesNotMatch(artifact.text, /must-not-export|shadow\+|encrypted_password/u);
  } finally {
    if (previous === undefined) delete process.env.KOVA_AUTH_MODE;
    else process.env.KOVA_AUTH_MODE = previous;
  }
});

test("identity-store outages preserve the account worker retry class before any private data read", async () => {
  const previous = process.env.KOVA_AUTH_MODE;
  process.env.KOVA_AUTH_MODE = "kova";
  try {
    const calls = [];
    const worker = await accountWorker({
      rpc: async () => ({ data: null, error: { message: "private provider detail" } }),
      from() {
        calls.push("records");
        throw new Error("must not read");
      },
    });
    await assert.rejects(
      worker.buildAccountExport(OWNER, VERSION),
      /^AccountExportError: account_export_database_unavailable$/u,
    );
    assert.deepEqual(calls, []);
  } finally {
    if (previous === undefined) delete process.env.KOVA_AUTH_MODE;
    else process.env.KOVA_AUTH_MODE = previous;
  }
});

test("retirement or changed file bytes between metadata and body reads fails the entire export", async () => {
  for (const options of [{ missing: true }, { corrupt: true }]) {
    const f = fixture(1, options);
    await assert.rejects(
      readAccountExportSiteFiles(f.admin, OWNER, 4096),
      /unavailable|integrity_failed/,
    );
  }
});
