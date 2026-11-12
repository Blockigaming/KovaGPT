import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("../../src/routes/images.tsx", import.meta.url), "utf8");
const body = source.slice(
  source.indexOf("  async function copyGeneratedImage("),
  source.indexOf("  async function generate("),
);
const js = ts.transpileModule(body, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture() {
  let resolveFetch, resolveWrite;
  const epoch = { current: 1 },
    events = [];
  const dependencies = {
    generationRef: epoch,
    ClipboardItem: class {
      constructor(data) {
        this.data = data;
      }
    },
    navigator: {
      clipboard: {
        write: () => {
          events.push("write");
          return new Promise((r) => {
            resolveWrite = r;
          });
        },
      },
    },
    fetch: () =>
      new Promise((r) => {
        resolveFetch = r;
      }),
    publishKovaNotice: (notice) => {
      assert.equal(notice.id, "image_copied");
      assert.equal(notice.confirmed, true);
      events.push("success");
    },
    toast: { success: () => events.push("success"), error: () => events.push("error") },
  };
  const copy = new Function(...Object.keys(dependencies), js + ";return copyGeneratedImage;")(
    ...Object.values(dependencies),
  );
  return {
    epoch,
    events,
    copy,
    read: () =>
      resolveFetch({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) }),
    write: () => resolveWrite(),
  };
}
test("image copy does not write old-account content after pending read resolves", async () => {
  const f = fixture();
  const pending = f.copy("blob:old-account");
  f.epoch.current++;
  f.read();
  await pending;
  assert.deepEqual(f.events, []);
});
test("image copy suppresses old-account notification after clipboard write resolves", async () => {
  const f = fixture();
  const pending = f.copy("blob:current");
  f.read();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.events, ["write"]);
  f.epoch.current++;
  f.write();
  await pending;
  assert.deepEqual(f.events, ["write"]);
});
test("current image copy writes and reports success", async () => {
  const f = fixture();
  const pending = f.copy("blob:current");
  f.read();
  await new Promise((r) => setImmediate(r));
  f.write();
  await pending;
  assert.deepEqual(f.events, ["write", "success"]);
});
test("unmount invalidates generation-scoped image actions", () => {
  assert.match(
    source,
    /return \(\) => \{\s*generationRef\.current \+= 1;\s*saveGenerationRef\.current \+= 1;\s*savePendingRef\.current = false;\s*historyLoadGuard\.invalidate\(\)/,
  );
});

function saveFixture() {
  let resolveSave, rejectSave;
  const state = { busy: false, saves: 0, notices: [] };
  const saveEpoch = { current: 1 },
    pending = { current: false },
    owner = { current: "owner" };
  const block = source.slice(
    source.indexOf("  async function saveGeneratedImage("),
    source.indexOf("  async function copyGeneratedImage("),
  );
  const code = ts.transpileModule(block, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    isSignedIn: true,
    userKey: "owner",
    resultOwnerRef: owner,
    saveGenerationRef: saveEpoch,
    savePendingRef: pending,
    setLoginOpen() {},
    setSavingImage: (value) => {
      state.busy = value;
    },
    imageUrlForLibrary: async (url) => url,
    saveImage: ({ data }) => {
      state.saves++;
      state.request = data;
      return new Promise((resolve, reject) => {
        resolveSave = resolve;
        rejectSave = reject;
      });
    },
    publishKovaNotice: (notice) => {
      if (["file_saved", "reference_saved"].includes(notice.id))
        assert.equal(notice.confirmed, true);
      state.notices.push(notice.id);
    },
  };
  const save = new Function(...Object.keys(dependencies), code + "; return saveGeneratedImage;")(
    ...Object.values(dependencies),
  );
  return {
    state,
    saveEpoch,
    pending,
    owner,
    save,
    finish: (receipt = { id: "saved-image" }) => resolveSave(receipt),
    fail: () => rejectSave(new Error("Library unavailable")),
  };
}
test("image Library save ignores duplicate clicks and releases the pending control", async () => {
  const f = saveFixture();
  const item = { prompt: "draft", imageUrl: "data:image/png;base64,test" };
  const first = f.save(item);
  await new Promise((r) => setImmediate(r));
  await f.save(item);
  assert.equal(f.state.saves, 1);
  assert.equal(f.state.busy, true);
  f.finish();
  await first;
  assert.equal(f.state.busy, false);
  assert.equal(f.pending.current, false);
  assert.deepEqual(f.state.notices, ["file_saved"]);
});
test("image Library save cannot report success or clear a new account action", async () => {
  const f = saveFixture();
  const first = f.save({ prompt: "old", imageUrl: "data:image/png;base64,test" });
  await new Promise((r) => setImmediate(r));
  f.saveEpoch.current++;
  f.state.busy = true;
  f.finish();
  await first;
  assert.deepEqual(f.state.notices, []);
  assert.equal(f.state.busy, true);
});

test("image save failure emits once for the current account and never for a stale account", async () => {
  for (const stale of [false, true]) {
    const f = saveFixture();
    const result = f.save({ prompt: "draft", imageUrl: "data:image/png;base64,test" });
    await new Promise((resolve) => setImmediate(resolve));
    if (stale) f.saveEpoch.current++;
    f.fail();
    await result;
    assert.deepEqual(f.state.notices, stale ? [] : ["image_save_failed"]);
    if (!stale) assert.equal(f.pending.current, false);
  }
});

test("a named reference uses the expected account and reports only a confirmed Library save", async () => {
  const item = { prompt: "draft", imageUrl: "data:image/png;base64,test" };
  const reference = { title: "Paper bird", idempotencyKey: crypto.randomUUID() };
  for (const outcome of ["saved", "missing", "switched"]) {
    const f = saveFixture();
    const result = f.save(item, reference);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.state.request, {
      ...item,
      ...reference,
      expectedOwnerId: "owner",
    });
    assert.deepEqual(f.state.notices, []);
    if (outcome === "switched") f.owner.current = "next-owner";
    f.finish(outcome === "missing" ? {} : undefined);
    if (outcome === "missing") await assert.rejects(result, /could not be confirmed/);
    else assert.equal(await result, outcome === "saved");
    assert.deepEqual(f.state.notices, outcome === "saved" ? ["reference_saved"] : []);
  }
});

test("image-edit fields keep full-width rounded phone geometry and 44px controls", () => {
  const edit = readFileSync(
    new URL("../../src/components/ImageEditControls.tsx", import.meta.url),
    "utf8",
  );
  assert.equal((edit.match(/<label className="grid min-w-0 gap-2">/g) || []).length, 2);
  assert.equal(
    (edit.match(/<SelectTrigger[\s\S]*?className="min-h-11 w-full min-w-0"/g) || []).length,
    2,
  );
  assert.match(edit, /SelectContent,\s*SelectItem,\s*SelectTrigger,\s*SelectValue/);
  assert.doesNotMatch(edit, /<select\b/);
  assert.equal((edit.match(/min-h-11 items-center justify-center rounded-full/g) || []).length, 3);
  assert.match(
    source,
    /Output shape[\s\S]*?<SelectTrigger[\s\S]*?aria-label="Output image shape"[\s\S]*?className="min-h-11 w-auto max-w-full"/,
  );
  const sharedSelect = readFileSync(
    new URL("../../src/components/ui/select.tsx", import.meta.url),
    "utf8",
  );
  assert.match(sharedSelect, /rounded-full/);
  assert.match(sharedSelect, /\[@media\(pointer:coarse\)\]:min-h-11/);
});
