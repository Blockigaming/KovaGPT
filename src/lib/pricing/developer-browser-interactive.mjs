import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { developerBrowserUrl } from "./developer-browser-policy.mjs";
const context = (globalThis[Symbol.for("kovagpt.developer-browser-interactive")] ??=
  new AsyncLocalStorage());
const fail = (code = "developer_browser_invalid") => {
  throw Error(code);
};
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join();
const point = (value) =>
  Number.isSafeInteger(value.x) &&
  value.x >= 0 &&
  value.x < 840 &&
  Number.isSafeInteger(value.y) &&
  value.y >= 0 &&
  value.y < 540;
export function parseBrowserAction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  switch (value.type) {
    case "navigate":
      if (!exact(value, ["type", "url"])) fail();
      return { type: value.type, url: developerBrowserUrl(value.url).href };
    case "click":
      if (!exact(value, ["type", "x", "y", "button"]) || !point(value) || value.button !== "left")
        fail();
      return { type: value.type, x: value.x, y: value.y, button: "left" };
    case "scroll":
      if (
        !exact(value, ["type", "x", "y", "scroll_x", "scroll_y"]) ||
        !point(value) ||
        ![value.scroll_x, value.scroll_y].every(
          (n) => Number.isSafeInteger(n) && Math.abs(n) <= 1200,
        )
      )
        fail();
      return { ...value };
    case "wait":
    case "screenshot":
    case "finish":
      if (!exact(value, ["type"])) fail();
      return { ...value };
    default:
      fail();
  }
}
// The current snapshot is a single-use authorization fence. No action is queued
// before a view is emitted or while another action is executing.
export function createBrowserChannel(emit, signal) {
  let pending,
    closed = false;
  const close = () => {
    closed = true;
    pending?.reject(Error("developer_browser_cancelled"));
    pending = undefined;
  };
  signal?.addEventListener("abort", close, { once: true });
  return {
    next(view, remaining) {
      signal?.throwIfAborted();
      if (closed || pending) fail("developer_browser_conflict");
      if (remaining <= 0) return Promise.resolve({ type: "finish" });
      const snapshot_id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = undefined;
          resolve({ type: "finish" });
        }, remaining);
        timer.unref?.();
        pending = {
          id: snapshot_id,
          resolve: (action) => {
            clearTimeout(timer);
            pending = undefined;
            resolve(action);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
        try {
          emit({ kind: "browser.snapshot", snapshot_id, ...view });
        } catch (error) {
          clearTimeout(timer);
          pending = undefined;
          reject(error);
        }
      });
    },
    accept(value, computerAllowed) {
      if (
        !exact(value, ["snapshot_id", "approved", "source", "action"]) ||
        value.approved !== true ||
        !["browser", "computer"].includes(value.source)
      )
        fail();
      if (value.source === "computer" && !computerAllowed) fail("developer_scope_required");
      if (closed || !pending || pending.id !== value.snapshot_id)
        fail("developer_browser_conflict");
      const action = parseBrowserAction(value.action);
      if (value.source === "computer" && action.type === "navigate") fail();
      pending.resolve(action);
    },
    close() {
      signal?.removeEventListener("abort", close);
      close();
    },
  };
}
export function withDeveloperBrowserChannel(channel, action) {
  return context.run(channel, action);
}
export function developerBrowserChannel() {
  return context.getStore();
}
// Only isolated, read-only navigation and viewport operations. Never execute a
// webpage's click handler, form submission, keyboard sequence or arbitrary JS.
export async function executeInteractiveBrowser({
  initial,
  channel,
  check,
  capture,
  navigate,
  linkAt,
  scroll,
  wait,
  signal,
  now = Date.now,
  deadline,
}) {
  let url = developerBrowserUrl(initial),
    view = await capture(url);
  for (let i = 0; i < 8; i++) {
    signal?.throwIfAborted();
    await check(url);
    signal?.throwIfAborted();
    const action = await channel.next(view, Math.max(0, deadline - now()));
    if (action.type === "finish") return view;
    signal?.throwIfAborted();
    await check(url);
    signal?.throwIfAborted();
    if (now() >= deadline) fail("developer_browser_expired");
    if (action.type === "navigate" || action.type === "click") {
      const target = developerBrowserUrl(
        action.type === "navigate" ? action.url : await linkAt(action.x, action.y),
      );
      if (target.origin !== url.origin) fail("developer_browser_scope_required");
      await check(target);
      signal?.throwIfAborted();
      if (now() >= deadline) fail("developer_browser_expired");
      await navigate(target);
      url = target;
    } else if (action.type === "scroll") await scroll(action);
    else if (action.type === "wait") await wait();
    else if (action.type !== "screenshot") fail();
    signal?.throwIfAborted();
    await check(url);
    view = await capture(url);
  }
  return view;
}
