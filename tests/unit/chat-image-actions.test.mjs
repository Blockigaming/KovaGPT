import assert from "node:assert/strict";
import test from "node:test";
import { safeImageUrl } from "../../src/lib/safe-image-url.ts";
import { png } from "../helpers/image-fixture.mjs";
import {
  loadUiModule,
  createHookHarness,
  elements,
  text,
  deferred,
  settle,
} from "../helpers/ui-state-harness.mjs";

const bytes = png(2, 2);
const data = `data:image/png;base64,${bytes.toString("base64")}`;
function operations(overrides = {}) {
  const links = [],
    objects = [],
    requests = [],
    clipboard = [];
  class ImageURL extends URL {
    static createObjectURL(blob) {
      objects.push(blob);
      return `blob:https://kova.test/${objects.length}`;
    }
    static revokeObjectURL() {}
  }
  const source = loadUiModule(
    "src/lib/chat-image-actions.ts",
    { "./safe-image-url": { safeImageUrl } },
    {
      window: { location: { origin: "https://kova.test" } },
      URL: ImageURL,
      Blob,
      File,
      Uint8Array,
      DOMException,
      AbortController,
      atob,
      setTimeout: () => 1,
      clearTimeout() {},
      fetch: async (url, options) => {
        requests.push({ url, options });
        return new Response(bytes, { headers: { "content-type": "image/png" } });
      },
      ClipboardItem: class {
        constructor(values) {
          this.values = values;
        }
      },
      navigator: {
        clipboard: {
          write(items) {
            clipboard.push(items);
            return Promise.all(items.map((item) => item.values["image/png"])).then(() => {});
          },
        },
      },
      document: {
        body: { append() {} },
        createElement(tag) {
          assert.equal(tag, "a");
          const link = {
            click() {
              links.push({
                href: this.href,
                rel: this.rel,
                target: this.target,
                download: this.download,
              });
            },
            remove() {},
          };
          return link;
        },
      },
      ...overrides,
    },
  );
  return { ...source, links, objects, requests, clipboard };
}

test("download and attachment use the actual PNG bytes and preserve same-origin authentication", async () => {
  const image = operations();
  const file = await image.chatImageFile(data, () => true);
  assert.equal(file.type, "image/png");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  assert.match(file.name, /^kova-image-[a-f0-9-]+\.png$/);
  await image.downloadChatImage("/private-image.png", () => true);
  assert.deepEqual(Buffer.from(await image.objects[0].arrayBuffer()), bytes);
  assert.equal(image.links[0].download, "kova-image.png");
  assert.equal(image.requests[1].options.credentials, "same-origin");
  assert.equal(image.requests[1].options.referrerPolicy, "no-referrer");
});

test("copy starts inside the gesture and writes image bytes rather than URL text", async () => {
  const pending = deferred();
  const image = operations({ fetch: () => pending.promise });
  const write = image.copyChatImage(data, () => true);
  assert.equal(image.clipboard.length, 1);
  assert.equal(typeof image.clipboard[0][0].values["image/png"].then, "function");
  pending.resolve(new Response(bytes, { headers: { "content-type": "image/png" } }));
  await write;
  const copied = await image.clipboard[0][0].values["image/png"];
  assert.deepEqual(Buffer.from(await copied.arrayBuffer()), bytes);
});

test("unsupported clipboard and unsafe image URLs fail without claiming a copy", async () => {
  const image = operations({ ClipboardItem: undefined });
  await assert.rejects(
    image.copyChatImage(data, () => true),
    /Download a copy instead/,
  );
  for (const src of [
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "https://name:password@kova.test/image.png",
  ]) {
    assert.throws(() => image.openChatImage(src), /unavailable/);
  }
  assert.equal(image.links.length, 0);
});

test("a raster data image opens as a real blob tab with no opener", async () => {
  const image = operations();
  image.openChatImage(data);
  assert.equal(image.links[0].target, "_blank");
  assert.equal(image.links[0].rel, "noopener noreferrer");
  assert.match(image.links[0].href, /^blob:/);
  assert.deepEqual(Buffer.from(await image.objects[0].arrayBuffer()), bytes);
  image.openChatImage("https://images.example.test/photo.png");
  assert.equal(image.links[1].href, "https://images.example.test/photo.png");
});

test("invalid content and oversized streaming images never become downloads", async () => {
  const svg = operations({
    fetch: async () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
  });
  await assert.rejects(
    svg.downloadChatImage(data, () => true),
    /format/,
  );
  const large = operations({
    fetch: async () =>
      new Response(new Uint8Array(8 * 1024 * 1024 + 1), {
        headers: { "content-type": "image/png" },
      }),
  });
  await assert.rejects(
    large.downloadChatImage(data, () => true),
    /8 MB/,
  );
  assert.equal(svg.links.length + large.links.length, 0);
});

test("late image reads cannot download or attach after the owning view changes", async () => {
  const response = deferred();
  const image = operations({ fetch: () => response.promise });
  let current = true;
  const download = image.downloadChatImage(data, () => current);
  current = false;
  response.resolve(new Response(bytes, { headers: { "content-type": "image/png" } }));
  await assert.rejects(download, { name: "AbortError" });
  assert.equal(image.links.length, 0);
  assert.equal(image.objects.length, 0);
});

function menuFixture() {
  const hooks = createHookHarness(),
    storage = new Map(),
    listeners = new Map(),
    focus = [];
  const errors = [],
    added = [];
  const image = loadUiModule(
    "src/components/ChatImage.tsx",
    {
      react: { ...hooks.react, useMemo: (factory) => factory() },
      "lucide-react": Object.fromEntries(
        ["Copy", "Download", "ExternalLink", "EyeOff", "ImagePlus"].map((name) => [name, name]),
      ),
      sonner: { toast: { error: (value) => errors.push(value), success() {} } },
      "./ui/context-menu": Object.fromEntries(
        [
          "ContextMenu",
          "ContextMenuContent",
          "ContextMenuItem",
          "ContextMenuSeparator",
          "ContextMenuTrigger",
        ].map((name) => [name, name]),
      ),
      "@/lib/chat-image-actions": {
        ...operations(),
        chatImageFile: async () => new File([bytes], "image.png", { type: "image/png" }),
      },
      "@/lib/principal-browser-storage.mjs": {
        principalScopedStorageKey: (base, owner) => `${base}:v2:user:${owner}`,
        safeBrowserStorage: () => ({
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
        }),
        PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT: "privacy-reset",
        isPrincipalBrowserStorageClearedEvent: (event, owner) => event.detail === owner,
      },
    },
    {
      Event,
      Error,
      File,
      window: {
        addEventListener: (name, fn) => {
          if (!listeners.has(name)) listeners.set(name, new Set());
          listeners.get(name).add(fn);
        },
        removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
        dispatchEvent: (event) => {
          for (const fn of listeners.get(event.type) ?? []) fn(event);
        },
        requestAnimationFrame: (fn) => {
          focus.push(fn);
          return 1;
        },
      },
    },
  );
  let props = {
      src: data,
      alt: "Chat image",
      actions: {
        ownerId: "owner-a",
        scope: "owner-a:chat-a:message-a",
        temporary: false,
        onAdd: async (file) => added.push(file),
      },
    },
    tree;
  const render = (next = {}) => {
    props = { ...props, ...next };
    tree = hooks.render(image.ChatImage, props);
    return tree;
  };
  render();
  render();
  return {
    render,
    storage,
    added,
    errors,
    hooks,
    menu: () => elements(tree, (node) => node.type === "ContextMenuItem"),
    choose: (label) =>
      elements(
        tree,
        (node) => node.type === "ContextMenuItem" && text(node).trim() === label,
      )[0].props.onSelect(),
    show: () =>
      elements(tree, (node) => node.type === "button" && text(node).trim() === "Show image")[0],
    reset: (owner) => {
      for (const fn of listeners.get("privacy-reset") ?? []) fn({ detail: owner });
    },
  };
}

test("the same five functional menu actions hide reversibly without changing message data", async () => {
  const view = menuFixture();
  assert.deepEqual(
    view.menu().map((node) => text(node).trim()),
    ["Download a copy", "Open image in new tab", "Copy image", "Add to chat", "Hide from chat"],
  );
  await view.choose("Add to chat");
  await settle();
  assert.equal(view.added.length, 1);
  view.render();
  view.choose("Hide from chat");
  view.render();
  assert.ok(view.show());
  const saved = [...view.storage.values()][0];
  assert.equal(saved.includes(data), false);
  assert.equal(saved.includes("owner-a"), false);
  assert.equal(JSON.parse(saved).length, 1);
  view.show().props.onClick();
  view.render();
  assert.equal(view.menu().length, 5);
  assert.equal(view.storage.values().next().value, "[]");
});

test("hidden image preferences are isolated by owner and cleared by account privacy reset", () => {
  const view = menuFixture();
  view.choose("Hide from chat");
  view.render();
  view.render({
    actions: {
      ownerId: "owner-b",
      scope: "owner-b:chat-a:message-a",
      temporary: false,
      onAdd: async () => {},
    },
  });
  view.render();
  assert.equal(view.show(), undefined);
  view.render({
    actions: {
      ownerId: "owner-a",
      scope: "owner-a:chat-a:message-a",
      temporary: false,
      onAdd: async () => {},
    },
  });
  view.render();
  assert.ok(view.show());
  view.storage.clear();
  view.reset("owner-a");
  view.render();
  assert.equal(view.show(), undefined);
});
