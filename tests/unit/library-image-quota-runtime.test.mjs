import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  publishLibraryImageBytes,
  deletePrivateLibraryImage,
  sweepLibraryImageUploads,
  prepareLibraryImageAccountDeletion,
} from "../../src/lib/library-image-storage.server.mjs";
const owner = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  gen = "33333333-3333-4333-8333-333333333333";
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]),
  sha = createHash("sha256").update(bytes).digest("hex"),
  fingerprint = "a".repeat(64),
  path = `${owner}/${gen}.png`;
const input = {
  id,
  bytes,
  contentType: "image/png",
  fingerprint,
  title: "Image",
  prompt: "prompt",
  source: "images",
};
function fixture(options = {}) {
  const events = [],
    row = {
      generation: gen,
      owner_id: owner,
      item_id: id,
      storage_path: path,
      size_bytes: bytes.length,
      sha256: sha,
      mime_type: "image/png",
      save_fingerprint: fingerprint,
      state: "pending",
    };
  let uploaded = false,
    settled = false,
    retired = false,
    lost = options.lost;
  const admin = {
    rpc(name, args) {
      events.push(name);
      let data = true,
        error = null;
      if (name === "reserve_library_image_upload") {
        assert.equal(args.p_size, bytes.length);
        assert.equal(args.p_sha256, sha);
        assert.equal(args.p_owner, owner);
        assert.equal(args.p_id, id);
        if (options.quota) error = { message: "library_storage_limit" };
        if (row.save_fingerprint !== args.p_fingerprint)
          error = { message: "library_image_conflict" };
        data = { ...row, state: settled ? "ready" : row.state };
      }
      if (name === "read_library_image_upload")
        data = options.missing ? null : { ...row, state: retired ? "retired" : "ready" };
      if (name === "settle_library_image_upload") {
        assert.equal(uploaded, true);
        assert.equal(args.p_fingerprint, fingerprint);
        if (options.refused) data = false;
        else {
          settled = true;
          if (lost) {
            lost = false;
            error = { message: "lost settlement" };
          }
        }
      }
      if (name === "retire_library_image_upload") {
        if (settled && !args.p_delete) data = null;
        else {
          retired = true;
          data = { ...row, state: "retired" };
        }
      }
      if (name === "claim_library_image_cleanup")
        data = [{ ...row, state: "retired", ...(options.claim ?? {}) }];
      if (name === "prepare_library_image_account_deletion") data = options.accountReady ?? false;
      if (name === "record_library_image_cleanup") {
        assert.equal(uploaded, false);
        data = options.recorded ?? true;
      }
      return {
        abortSignal: async (signal) => {
          signal.throwIfAborted();
          return { data, error };
        },
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "library-images");
        return {
          upload: async (p, b, o) => {
            assert.equal(p, path);
            assert.deepEqual(b, bytes);
            assert.equal(o.upsert, false);
            events.push("upload");
            uploaded = true;
            return { error: options.uploadError ? { message: "duplicate" } : null };
          },
          createSignedUrl: async () => ({
            data: {
              signedUrl:
                options.signedUrl ??
                `https://fixture.supabase.co/storage/v1/object/sign/library-images/${path}?token=private`,
            },
            error: null,
          }),
          remove: async (paths) => {
            assert.deepEqual(paths, [path]);
            events.push("remove");
            if (options.removeError) return { error: { message: "network" } };
            uploaded = false;
            return { error: null };
          },
        };
      },
    },
  };
  const transport = {
    signal: AbortSignal.timeout(10000),
    supabaseUrl: "https://fixture.supabase.co",
    fetchImpl: async (url, opts) => {
      assert.equal(opts.redirect, "error");
      assert.equal(opts.credentials, "omit");
      events.push("read-actual");
      return new Response(options.body ?? bytes, { status: 200 });
    },
  };
  return {
    admin,
    transport,
    events,
    get settled() {
      return settled;
    },
    get retired() {
      return retired;
    },
  };
}
test("actual stored image bytes are verified before metadata settlement and quota denial prevents all Storage I/O", async () => {
  const f = fixture();
  assert.equal((await publishLibraryImageBytes(f.admin, owner, input, f.transport)).id, id);
  assert.deepEqual(f.events, [
    "reserve_library_image_upload",
    "upload",
    "read-actual",
    "settle_library_image_upload",
  ]);
  const denied = fixture({ quota: true });
  await assert.rejects(
    publishLibraryImageBytes(denied.admin, owner, input, denied.transport),
    /storage limit/,
  );
  assert.deepEqual(denied.events, ["reserve_library_image_upload"]);
});
test("corrupt or oversized stored bytes and foreign signed hosts cannot publish", async () => {
  for (const options of [
    { body: new Uint8Array([1]) },
    { body: new Uint8Array(8388609) },
    { signedUrl: "https://foreign.supabase.co/storage/v1/object/sign/library-images/x" },
  ]) {
    const f = fixture(options);
    await assert.rejects(publishLibraryImageBytes(f.admin, owner, input, f.transport));
    assert.equal(f.settled, false);
    assert.equal(f.retired, true);
    assert.equal(f.events.includes("settle_library_image_upload"), false);
  }
});
test("lost successful settlement and identical upload conflicts preserve the one immutable image on retry", async () => {
  const f = fixture({ lost: true, uploadError: true });
  await assert.rejects(publishLibraryImageBytes(f.admin, owner, input, f.transport));
  assert.equal(f.settled, true);
  assert.equal(f.retired, false);
  assert.equal((await publishLibraryImageBytes(f.admin, owner, input, f.transport)).id, id);
  assert.equal(f.events.filter((x) => x === "upload").length, 1);
  assert.equal(f.events.includes("remove"), false);
  await assert.rejects(
    publishLibraryImageBytes(
      f.admin,
      owner,
      { ...input, fingerprint: "b".repeat(64) },
      f.transport,
    ),
  );
  assert.equal(f.events.filter((x) => x === "upload").length, 1);
});
test("refused publication retires its own generation and stale actors cannot pass byte validation", async () => {
  const f = fixture({ refused: true });
  await assert.rejects(publishLibraryImageBytes(f.admin, owner, input, f.transport));
  assert.equal(f.retired, true);
  assert.equal(f.settled, false);
  const aborted = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    publishLibraryImageBytes(aborted.admin, owner, input, {
      ...aborted.transport,
      signal: controller.signal,
    }),
  );
  assert.equal(aborted.events.includes("upload"), false);
});
test("delete and cleanup release quota only after confirmed object removal; failure stays retryable", async () => {
  const f = fixture();
  assert.equal(await deletePrivateLibraryImage(f.admin, owner, id, id, f.transport.signal), true);
  assert.ok(f.events.indexOf("remove") < f.events.indexOf("record_library_image_cleanup"));
  const failed = fixture({ removeError: true });
  await assert.rejects(
    deletePrivateLibraryImage(failed.admin, owner, id, id, failed.transport.signal),
  );
  assert.equal(failed.events.includes("record_library_image_cleanup"), false);
  const retry = fixture({ recorded: false });
  await assert.rejects(
    deletePrivateLibraryImage(retry.admin, owner, id, id, retry.transport.signal),
  );
  for (const claim of [
    { owner_id: gen },
    { storage_path: `${owner}/../foreign` },
    { state: "ready" },
  ]) {
    const invalid = fixture({ claim });
    await assert.rejects(sweepLibraryImageUploads(invalid.admin, owner, invalid.transport.signal));
    assert.equal(invalid.events.includes("remove"), false);
  }
});
test("account preparation remains false while immutable upload leases or cleanup charges remain", async () => {
  const f = fixture();
  assert.equal(await prepareLibraryImageAccountDeletion(f.admin, owner, f.transport.signal), false);
  assert.deepEqual(f.events, [
    "prepare_library_image_account_deletion",
    "claim_library_image_cleanup",
    "remove",
    "record_library_image_cleanup",
    "prepare_library_image_account_deletion",
  ]);
});

test("concurrent identical image saves settle the same immutable generation", async () => {
  const f = fixture({ uploadError: true });
  const values = await Promise.all([
    publishLibraryImageBytes(f.admin, owner, input, f.transport),
    publishLibraryImageBytes(f.admin, owner, input, f.transport),
  ]);
  assert.equal(values[0].id, values[1].id);
  assert.equal(f.settled, true);
  assert.equal(f.retired, false);
  assert.equal(f.events.includes("remove"), false);
});
