import { randomUUID, createHash } from "node:crypto";
const fail = () => {
  throw new Error("work_browser_action_denied");
};
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Runs only in the networkless browser image. Tests supply a real local browser.
 * No screenshots, video, HAR, console/network logging or storageState export. */
export async function createInteractiveBrowser({ chromium, exchange }) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-default-apps",
      "--disable-breakpad",
      "--no-pings",
    ],
  });
  let closed = false,
    mode = "takeover",
    sequence = 0,
    view = null,
    targets = new Map(),
    activeActor = null;
  const context = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: "block",
    permissions: [],
    viewport: { width: 1280, height: 900 },
  });
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(10000);
  await context.routeWebSocket("**/*", (socket) =>
    socket.close({ code: 1008, reason: "Unavailable" }),
  );
  await context.route("**/*", async (route) => {
    try {
      if (closed || !activeActor) fail();
      const actor = activeActor,
        requestSequence = sequence;
      const request = route.request(),
        body = request.postDataBuffer() ?? Buffer.alloc(0);
      if (body.length > 65536) fail();
      const result = await exchange(
        {
          url: request.url(),
          method: request.method(),
          headers: await request.allHeaders(),
          bodyBase64: body.toString("base64"),
        },
        { actor, sequence: requestSequence },
      );
      if (
        closed ||
        activeActor !== actor ||
        sequence !== requestSequence ||
        !result ||
        !Number.isSafeInteger(result.status) ||
        result.status < 200 ||
        result.status > 599 ||
        typeof result.bodyBase64 !== "string" ||
        result.bodyBase64.length > 2800000
      )
        fail();
      const bytes = Buffer.from(result.bodyBase64, "base64");
      if (bytes.toString("base64") !== result.bodyBase64 || bytes.length > 2 * 1024 * 1024) fail();
      await route.fulfill({ status: result.status, headers: result.headers, body: bytes });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  const page = await context.newPage();
  context.on("page", (candidate) => {
    if (candidate !== page) void candidate.close();
  });
  page.on("download", (download) => void download.cancel());
  page.on("dialog", (dialog) => void dialog.dismiss());
  const safeUrl = () => {
    try {
      const url = new URL(page.url());
      return url.origin + url.pathname;
    } catch {
      return "about:blank";
    }
  };
  async function describe(handle) {
    return handle.evaluate((element) => {
      const rect = element.getBoundingClientRect(),
        style = getComputedStyle(element);
      if (
        !element.isConnected ||
        !rect.width ||
        !rect.height ||
        style.visibility === "hidden" ||
        style.display === "none"
      )
        return null;
      const tag = element.tagName.toLowerCase(),
        type = element.getAttribute("type") ?? "",
        name = element.getAttribute("name") ?? "";
      const label = (
        element.getAttribute("aria-label") ||
        element.labels?.[0]?.innerText ||
        element.innerText ||
        element.getAttribute("placeholder") ||
        name ||
        tag
      ).slice(0, 200);
      const href = element instanceof HTMLAnchorElement ? element.href : null,
        action = element.form?.action ?? null;
      if (name.length > 200 || (href?.length ?? 0) > 4096 || (action?.length ?? 0) > 4096)
        return null;
      return {
        tag,
        type,
        name,
        label,
        href,
        action,
        method: element.form?.method ?? null,
        disabled: Boolean(element.disabled),
        editable:
          element instanceof HTMLInputElement
            ? ![
                "hidden",
                "file",
                "button",
                "submit",
                "reset",
                "checkbox",
                "radio",
                "image",
              ].includes(type)
            : element instanceof HTMLTextAreaElement,
      };
    });
  }
  async function snapshot(actor) {
    if (actor === "agent" && mode !== "agent") fail();
    for (const old of targets.values()) await old.handle.dispose().catch(() => {});
    targets = new Map();
    view = randomUUID();
    const nodes = [];
    const locator = page.locator('a[href],button,input,textarea,select,[role="button"]');
    const limit = Math.min(await locator.count(), actor === "owner" ? 60 : 20);
    for (let index = 0; index < limit; index++) {
      const handle = await locator.nth(index).elementHandle();
      if (!handle) continue;
      const description = await describe(handle).catch(() => null);
      if (!description) continue;
      const id = randomUUID();
      targets.set(id, { handle, fingerprint: digest(description) });
      nodes.push({
        id,
        label: description.label,
        kind: description.tag,
        inputType: description.type,
        editable: description.editable,
        disabled: description.disabled,
      });
    }
    const text = await page
      .evaluate(
        (maximum) => {
          if (!document.body) return "";
          const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let output = "",
            count = 0,
            node;
          while ((node = walk.nextNode()) && count++ < 2000 && output.length < maximum) {
            if (node.parentElement?.closest("script,style,input,textarea,noscript")) continue;
            output += (node.textContent ?? "").slice(0, maximum - output.length) + " ";
          }
          return output.slice(0, maximum);
        },
        actor === "owner" ? 6000 : 1500,
      )
      .catch(() => "");
    const result = {
      sequence,
      mode,
      view,
      url: safeUrl(),
      title: await page.evaluate(() => document.title.slice(0, 200)),
      text: text.slice(0, actor === "owner" ? 6000 : 3000),
      nodes,
    };
    // Work effect accounting bounds serialized UTF-8, not JavaScript characters.
    const maximum = actor === "owner" ? 50000 : 10000;
    while (Buffer.byteLength(JSON.stringify(result)) > maximum && nodes.length) {
      const removed = nodes.pop(),
        saved = targets.get(removed.id);
      targets.delete(removed.id);
      await saved?.handle.dispose().catch(() => {});
    }
    while (Buffer.byteLength(JSON.stringify(result)) > maximum && result.text.length)
      result.text = result.text.slice(0, Math.floor(result.text.length / 2));
    if (Buffer.byteLength(JSON.stringify(result)) > maximum) fail();
    return result;
  }
  async function target(command) {
    if (command.view !== view || typeof command.target !== "string") fail();
    const saved = targets.get(command.target);
    if (!saved) fail();
    const current = await describe(saved.handle).catch(() => null);
    if (!current || current.disabled || digest(current) !== saved.fingerprint) fail();
    return { handle: saved.handle, description: current };
  }
  return {
    async command(command) {
      if (
        closed ||
        !command ||
        !["owner", "agent"].includes(command.actor) ||
        !Number.isSafeInteger(command.sequence) ||
        command.sequence <= sequence ||
        command.sequence > 1000000
      )
        fail();
      if (command.actor === "agent" && mode !== "agent") fail();
      if (
        command.actor === "owner" &&
        mode !== "takeover" &&
        !["takeover", "close"].includes(command.operation)
      )
        fail();
      sequence = command.sequence;
      activeActor = command.actor;
      try {
        if (command.operation === "close") {
          closed = true;
          await browser.close();
          return { closed: true, sequence };
        }
        if (command.operation === "takeover") {
          if (command.actor !== "owner") fail();
          mode = "takeover";
          return await snapshot("owner");
        }
        if (command.operation === "release") {
          if (command.actor !== "owner" || mode !== "takeover") fail();
          // Credentials and owner-entered form values are never returned to the model.
          await page.locator("input,textarea").evaluateAll((elements) => {
            for (const element of elements) if ("value" in element) element.value = "";
          });
          mode = "agent";
          view = null;
          targets = new Map();
          return { sequence, mode, url: safeUrl() };
        }
        if (command.operation === "navigate") {
          if (
            typeof command.url !== "string" ||
            command.url.length > 4096 ||
            !/^https:\/\//.test(command.url)
          )
            fail();
          await page.goto(command.url, { waitUntil: "domcontentloaded" });
        } else if (command.operation === "click") {
          const selected = await target(command);
          await selected.handle.click({ timeout: 5000 });
        } else if (command.operation === "fill") {
          if (
            command.actor !== "owner" ||
            typeof command.text !== "string" ||
            command.text.length > 4096
          )
            fail();
          const selected = await target(command);
          if (!selected.description.editable) fail();
          await selected.handle.fill(command.text, { timeout: 5000 });
        } else if (command.operation === "press") {
          if (
            command.actor !== "owner" ||
            !["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "Space"].includes(command.key)
          )
            fail();
          const selected = await target(command);
          await selected.handle.press(command.key, { timeout: 5000 });
        } else if (command.operation === "scroll") {
          if (!Number.isInteger(command.delta) || Math.abs(command.delta) > 900) fail();
          await page.mouse.wheel(0, command.delta);
        } else if (command.operation !== "snapshot") fail();
        if (["navigate", "click", "press"].includes(command.operation))
          await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
        return await snapshot(command.actor);
      } finally {
        activeActor = null;
      }
    },
    async close() {
      closed = true;
      activeActor = null;
      targets.clear();
      await browser.close();
    },
  };
}
