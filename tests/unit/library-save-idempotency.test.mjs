import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as idempotency from "../../src/lib/library-save-idempotency.mjs";
import { readResponseBytesBounded } from "../../src/lib/endpoint-reliability.mjs";

function load(file, artifacts = {}) {
  const exports = {};
  const createServerFn = () => {
    let validate = (input) => input;
    const builder = {
      middleware: () => builder,
      validator: (fn) => {
        validate = fn;
        return builder;
      },
      handler: (fn) => async (args) => fn({ ...args, data: validate(args.data) }),
    };
    return builder;
  };
  const dependencies = {
    zod: { z },
    "@tanstack/react-start": { createServerFn },
    "@/integrations/supabase/auth-middleware": {},
    "@/lib/library-storage-policy": {},
    "@/lib/lockdown-policy.mjs": {},
    "@/lib/safe-image-url": { MAX_SAFE_IMAGE_DATA_URL_CHARS: 12_000_000 },
    "@/lib/library-save-idempotency.mjs": idempotency,
    "@/lib/endpoint-reliability.mjs": { readResponseBytesBounded },
    "@/lib/account-storage-artifacts.server": {
      reserveAccountStorageArtifact: async () => {},
      settleAccountStorageArtifact: async () => true,
      retireAccountStorageArtifact: async () => {},
      ...artifacts,
    },
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in dependencies, `Unexpected dependency ${name}`);
        return dependencies[name];
      },
      console: { error() {} },
      crypto,
      atob,
      Uint8Array,
      TextDecoder,
      TextEncoder,
      Error,
    },
  );
  return exports;
}
function database({ ambiguous = false, concurrent = false } = {}) {
  const rows = new Map();
  const objects = new Map();
  const removed = [];
  let lookups = 0;
  let unblock;
  const barrier = new Promise((resolve) => {
    unblock = resolve;
  });
  const from = () => {
    const filters = [];
    let inserted;
    let deleting = false;
    const query = {
      select: () => query,
      delete: () => {
        deleting = true;
        return query;
      },
      then: (resolve, reject) =>
        Promise.resolve()
          .then(() => {
            if (deleting)
              for (const [id, row] of rows)
                if (filters.every(([k, v]) => row[k] === v)) rows.delete(id);
            return { error: null };
          })
          .then(resolve, reject),
      eq: (k, v) => {
        filters.push([k, v]);
        return query;
      },
      insert: (value) => {
        inserted = value;
        return query;
      },
      single: async () => {
        const id = inserted.id || crypto.randomUUID();
        if (rows.has(id)) return { data: null, error: { code: "23505" } };
        const row = { ...inserted, id };
        rows.set(id, row);
        return ambiguous
          ? { data: null, error: { message: "Response lost" } }
          : { data: row, error: null };
      },
      maybeSingle: async () => {
        const row =
          [...rows.values()].find((entry) => filters.every(([k, v]) => entry[k] === v)) ?? null;
        if (concurrent && ++lookups <= 2) {
          if (lookups === 2) unblock();
          await barrier;
        }
        return { data: row, error: null };
      },
    };
    return query;
  };
  const storage = {
    from: () => ({
      upload: async (path, bytes, options) => {
        assert.equal(options.upsert, false);
        assert.equal(objects.has(path), false);
        objects.set(path, bytes);
        return { error: null };
      },
      remove: async (paths) => {
        removed.push(...paths);
        for (const path of paths) objects.delete(path);
        return { error: null };
      },
    }),
  };
  return { from, storage, rows, objects, removed };
}
const key = "11111111-1111-4111-8111-111111111111";
const imageData = (last = 1) => ({
  imageUrl: `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, last]).toString("base64")}`,
  title: "image.png",
  source: "upload",
  idempotencyKey: key,
});
const context = (supabase) => ({ supabase, userId: "owner" });

test("text autosave retries return the same row and reject same-key changed content", async () => {
  const { saveToLibrary } = load("src/lib/library.functions.ts");
  const db = database();
  const data = {
    title: "notes.txt",
    item_type: "upload",
    source: "upload",
    content_text: "a".repeat(256 * 1024),
    idempotencyKey: key,
  };
  const first = await saveToLibrary({ data, context: context(db) });
  assert.equal((await saveToLibrary({ data, context: context(db) })).id, first.id);
  assert.equal(db.rows.size, 1);
  await assert.rejects(
    saveToLibrary({ data: { ...data, content_text: "changed" }, context: context(db) }),
    /different Library item/,
  );
});

test("concurrent identical image saves retain one metadata row and only its object", async () => {
  const { saveImageToLibrary } = load("src/lib/library-images.functions.ts");
  const db = database({ concurrent: true });
  const results = await Promise.all([
    saveImageToLibrary({ data: imageData(), context: context(db) }),
    saveImageToLibrary({ data: imageData(), context: context(db) }),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(db.rows.size, 1);
  assert.equal(db.objects.size, 1);
  assert.equal(db.removed.length, 1);
  assert.ok(db.objects.has([...db.rows.values()][0].file_url));
});

test("same-key different image bytes cannot overwrite the winning object", async () => {
  const { saveImageToLibrary } = load("src/lib/library-images.functions.ts");
  const db = database({ concurrent: true });
  const results = await Promise.allSettled([
    saveImageToLibrary({ data: imageData(1), context: context(db) }),
    saveImageToLibrary({ data: imageData(2), context: context(db) }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(db.rows.size, 1);
  assert.equal(db.objects.size, 1);
  assert.match(
    results.find((result) => result.status === "rejected").reason.message,
    /different Library item/,
  );
});

test("an ambiguous successful metadata response never deletes its referenced image", async () => {
  const { saveImageToLibrary } = load("src/lib/library-images.functions.ts");
  const db = database({ ambiguous: true });
  assert.equal((await saveImageToLibrary({ data: imageData(), context: context(db) })).id, key);
  assert.equal(db.rows.size, 1);
  assert.equal(db.objects.size, 1);
  assert.equal(db.removed.length, 0);
});

test("Library generation is reserved before upload, then metadata is published before settlement", async () => {
  const db = database();
  const events = [];
  let reserved;
  const { saveImageToLibrary } = load("src/lib/library-images.functions.ts", {
    reserveAccountStorageArtifact: async (value) => {
      assert.equal(db.objects.size, 0);
      assert.equal(db.rows.size, 0);
      reserved = value;
      events.push("reserve");
    },
    settleAccountStorageArtifact: async (artifact) => {
      assert.equal(artifact.generation, reserved.generation);
      assert.equal(artifact.ownerId, reserved.ownerId);
      assert.equal(artifact.path, reserved.path);
      assert.equal(db.objects.size, 1);
      assert.equal(db.rows.size, 1);
      events.push("settle");
      return true;
    },
  });
  await saveImageToLibrary({ data: imageData(), context: context(db) });
  assert.deepEqual(events, ["reserve", "settle"]);
  assert.equal(reserved.path, `owner/${reserved.generation}.png`);
});

test("a refused generation cannot publish bytes or metadata, and post-insert refusal compensates only that attempt", async () => {
  const db = database();
  const blocked = load("src/lib/library-images.functions.ts", {
    reserveAccountStorageArtifact: async () => {
      throw new Error("deleting");
    },
  }).saveImageToLibrary;
  await assert.rejects(blocked({ data: imageData(), context: context(db) }), /deleting/);
  assert.equal(db.objects.size, 0);
  assert.equal(db.rows.size, 0);
  const retired = [];
  const refused = load("src/lib/library-images.functions.ts", {
    settleAccountStorageArtifact: async () => false,
    retireAccountStorageArtifact: async (id) => retired.push(id),
  }).saveImageToLibrary;
  await assert.rejects(
    refused({ data: imageData(), context: context(db) }),
    /could not be completed/,
  );
  assert.equal(db.objects.size, 0);
  assert.equal(db.rows.size, 0);
  assert.ok(retired.length >= 1);
});

test("ambiguous settlement preserves its object and replays settlement before confirming success", async () => {
  const db = database();
  let attempts = 0;
  const retired = [];
  const { saveImageToLibrary } = load("src/lib/library-images.functions.ts", {
    settleAccountStorageArtifact: async () => {
      attempts++;
      if (attempts === 1) throw new Error("response lost");
      return true;
    },
    retireAccountStorageArtifact: async (id) => retired.push(id),
  });
  await assert.rejects(
    saveImageToLibrary({ data: imageData(), context: context(db) }),
    /response lost/,
  );
  assert.equal(db.objects.size, 1);
  assert.equal(db.rows.size, 1);
  assert.ok(retired.length >= 1);
  assert.equal((await saveImageToLibrary({ data: imageData(), context: context(db) })).id, key);
  assert.equal(attempts, 2);
  assert.equal(db.objects.size, 1);
});
