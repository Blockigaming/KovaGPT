/** Fresh Chromium checks of the actual-component, file:// review artifact. */
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const output = resolve(process.env.KOVA_CORE_REVIEW_OUTPUT || "../core-ui-review");
const file = resolve(output, "KovaGPT-Core-Review.html");
const screenshotDir = resolve(output, "screenshots");
await mkdir(screenshotDir, { recursive: true });
if (!process.env.KOVA_REVIEW_KEEP_SHOTS)
  for (const name of await readdir(screenshotDir))
    if (name.endsWith(".png")) await unlink(resolve(screenshotDir, name));
const manifest = JSON.parse(await readFile(resolve(output, "source-manifest.json"), "utf8"));
const launchBrowser = () =>
  chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      "/root/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell",
    args: ["--no-sandbox", "--single-process", "--no-zygote"],
  });
const failures = [],
  cases = [],
  screenshots = [],
  mobileHeaderTargets = [],
  pageErrors = [],
  externalRequests = [];
const filter = process.env.KOVA_REVIEW_ROUTES?.split(",");
const matrix = [
  {
    name: "plus-desktop-light",
    account: "plus",
    theme: "light",
    populated: true,
    width: 1440,
    height: 1000,
  },
  {
    name: "pro-phone-dark",
    account: "pro",
    theme: "dark",
    populated: true,
    width: 390,
    height: 1000,
  },
  {
    name: "guest-desktop-dark",
    account: "guest",
    theme: "dark",
    populated: false,
    width: 1440,
    height: 1000,
  },
  {
    name: "free-phone-light",
    account: "free",
    theme: "light",
    populated: false,
    width: 390,
    height: 1000,
  },
];
if (process.env.KOVA_REVIEW_CASES)
  matrix.splice(
    0,
    matrix.length,
    ...matrix.filter((item) => process.env.KOVA_REVIEW_CASES.split(",").includes(item.name)),
  );
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z3e0AAAAASUVORK5CYII=",
  "base64",
);
const sha = (data) => createHash("sha256").update(data).digest("hex");
async function capture(page, name) {
  await expect(page.frameLocator("iframe").locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 10000,
  });
  const path = resolve(screenshotDir, name + ".png");
  await page.locator("iframe").screenshot({ path, animations: "disabled" });
  screenshots.push({ path: "screenshots/" + name + ".png", sha256: sha(await readFile(path)) });
}
async function controls(page, action) {
  const toggle = page.locator("#controls-toggle");
  const mobile = await toggle.isVisible();
  if (mobile && (await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await action();
  if (mobile && (await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
}
async function choose(page, selector, value) {
  await controls(page, () => page.locator(selector).selectOption(value));
}
async function navigate(page, frame, path) {
  await choose(page, "#page", path);
  await expect(frame.locator("html")).toHaveAttribute("data-review-route", path);
  await frame.locator("body").evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(frame.getByText("Something went wrong!", { exact: true })).toHaveCount(0);
}
async function ensureSidebar(frame) {
  const sidebar = frame.locator(".kova-sidebar");
  if ((await sidebar.getAttribute("data-state")) !== "open")
    await frame
      .getByRole("button", { name: /Open menu|Open sidebar|Expand sidebar/ })
      .first()
      .click();
  await expect(sidebar).toHaveAttribute("data-state", "open");
}
async function mobileHeaderChecks(frame, item) {
  if (item.width >= 768) return;
  await ensureSidebar(frame);
  const sidebar = frame.locator(".kova-sidebar");
  for (const name of ["Search chats", "Close sidebar"]) {
    const button = sidebar.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    mobileHeaderTargets.push({ case: item.name, name, width: bounds.width, height: bounds.height });
  }
  await sidebar.getByRole("button", { name: "Close sidebar", exact: true }).click();
  await expect(sidebar).toHaveAttribute("data-state", "closed");
}
async function checkSwitch(frame) {
  const item = frame.getByRole("switch").first();
  if (!(await item.count())) return;
  for (let n = 0; n < 2; n++) {
    await item.click();
    await item.evaluate((element) =>
      Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    const bounds = await item.evaluate((element) => {
      const outer = element.getBoundingClientRect(),
        inner = element.firstElementChild.getBoundingClientRect();
      return [
        inner.left - outer.left,
        outer.right - inner.right,
        inner.top - outer.top,
        outer.bottom - inner.bottom,
      ];
    });
    expect(Math.min(...bounds)).toBeGreaterThanOrEqual(1.5);
  }
}
async function composerChecks(page, frame, item) {
  const draft = frame.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await expect(draft).toBeVisible();
  await draft.fill("One line");
  expect((await draft.boundingBox()).height).toBeLessThan(40);
  await draft.fill("First\nSecond");
  expect((await draft.boundingBox()).height).toBeGreaterThan(40);
  const send = frame.getByTestId("send-button");
  const sendBox = await send.boundingBox();
  expect(Math.abs(sendBox.width - sendBox.height)).toBeLessThan(1.5);
  expect(await send.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    item.theme === "dark" ? "rgb(255, 255, 255)" : "rgb(17, 17, 17)",
  );
  await draft.clear();
  const plus = frame.getByRole("button", { name: "Add files, tools, or prompts", exact: true });
  const plusBox = await plus.boundingBox();
  expect(Math.abs(plusBox.width - plusBox.height)).toBeLessThan(1.5);
  await plus.click();
  const menu = frame.getByRole("dialog", {
    name: /Add files, tools, or prompts|Add to your message/,
  });
  await expect(menu).toBeVisible();
  const labels =
    item.width < 768
      ? ["Photos", "Camera", "Files", "Library"]
      : ["Photos", "Files", "Library", "Drawings", "Create Image"];
  for (const name of labels)
    await expect(menu.getByRole("button", { name, exact: true })).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  if (item.width >= 768) {
    const plugins = menu.locator(".kova-composer-plugin-list");
    await expect(plugins.locator("a")).toHaveCount(13);
    expect(await plugins.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
  }
  await capture(page, item.name + "-attachments");
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  if (item.account === "guest") return;
  for (const label of item.width < 768 ? ["Photos", "Camera", "Files"] : ["Photos", "Files"]) {
    await plus.click();
    const chooser = page.waitForEvent("filechooser");
    await menu.getByRole("button", { name: label, exact: true }).click();
    const fileChooser = await chooser;
    if (label === "Camera")
      expect(await fileChooser.element().getAttribute("capture")).toBe("environment");
    const name = label === "Files" ? "review-attachment.txt" : `review-${label.toLowerCase()}.png`;
    await fileChooser.setFiles({
      name,
      mimeType: label === "Files" ? "text/plain" : "image/png",
      buffer: label === "Files" ? Buffer.from("Offline attachment fixture") : png,
    });
    const remove = frame.getByRole("button", { name: `Remove ${name}`, exact: true });
    await expect(remove).toBeVisible();
    await remove.click();
  }
  if (item.populated) {
    await plus.click();
    await menu.getByRole("button", { name: "Library", exact: true }).click();
    const library = frame.getByRole("dialog", { name: "Add from Library", exact: true });
    await expect(library).toBeVisible();
    await expect
      .poll(() => library.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await library.getByRole("button").filter({ hasText: "welcome-notes.txt" }).first().click();
    await expect(
      frame.getByRole("button", { name: "Remove welcome-notes.txt", exact: true }),
    ).toBeVisible();
    await frame.getByRole("button", { name: "Remove welcome-notes.txt", exact: true }).click();
  }
  if (item.width >= 768) {
    await plus.click();
    await menu.getByRole("button", { name: "Drawings", exact: true }).click();
    const drawing = frame.getByRole("dialog", { name: "Drawings", exact: true });
    await drawing.locator("canvas").click({ position: { x: 50, y: 50 } });
    await drawing.getByRole("button", { name: "Attach drawing", exact: true }).click();
    await frame.getByRole("button", { name: /^Remove Drawing(?:-[a-z0-9]+)?\.png$/i }).click();
    await plus.click();
    await menu.getByRole("button", { name: "Create Image", exact: true }).click();
    await frame.getByRole("button", { name: /Remove Create image/i }).click();
  }
}
async function populatedChatChecks(page, frame, item) {
  await ensureSidebar(frame);
  const row = frame.getByRole("button", {
    name: "Open chat A clear project plan · fixture",
    exact: true,
  });
  await expect(row).toBeVisible();
  if (item.width >= 768) {
    await row.dblclick();
    const rename = frame.getByRole("dialog", { name: "Rename chat", exact: true });
    await expect(rename).toBeVisible();
    await rename.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await row.click();
  await expect(frame.locator("[data-chat-transcript]")).toBeVisible();
  await expect(
    frame.getByRole("heading", { name: "A simple launch plan", exact: true }),
  ).toBeVisible();
  await capture(page, item.name + "-conversation");
  await ensureSidebar(frame);
  await frame
    .getByRole("button", { name: "Options for A clear project plan · fixture", exact: true })
    .click();
  for (const label of ["Rename", "Duplicate", "Archive", "Delete", "Add to project"])
    await expect(frame.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  await capture(page, item.name + "-chat-menu");
  await frame.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = frame.getByRole("dialog", { name: "Rename chat", exact: true });
  await expect(rename.getByRole("textbox", { name: "Chat name" })).toBeFocused();
  await rename.getByRole("button", { name: "Cancel", exact: true }).click();
  await frame
    .getByRole("button", { name: "Options for A clear project plan · fixture", exact: true })
    .click();
  await frame.getByRole("menuitem", { name: "Add to project", exact: true }).click();
  const project = frame.getByRole("dialog", { name: "Add to project", exact: true });
  await expect(project).toBeVisible();
  await project
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption("11111111-1111-4111-8111-111111111111");
  await expect(project.getByRole("textbox", { name: "Chat title", exact: true })).toHaveValue(
    "A clear project plan · fixture",
  );
  await capture(page, item.name + "-chat-project");
  await project.getByRole("button", { name: "Cancel", exact: true }).click();
}
for (const item of matrix) {
  console.log("Review case:", item.name);
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: item.width, height: item.height },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push({ case: item.name, message: error.message }));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url()))
      externalRequests.push({ case: item.name, url: request.url() });
  });
  await page.goto(pathToFileURL(file).href);
  const frame = page.frameLocator("iframe");
  try {
    await expect(
      frame.getByRole("textbox", { name: "Message KovaGPT", exact: true }),
    ).toBeVisible();
    await choose(page, "#account", item.account);
    await choose(page, "#data", item.populated ? "populated" : "empty");
    await choose(page, "#theme", item.theme);
    await expect
      .poll(() => frame.locator("html").evaluate((element) => element.classList.contains("dark")))
      .toBe(item.theme === "dark");
    if (!filter) {
      await composerChecks(page, frame, item);
      await mobileHeaderChecks(frame, item);
      if (item.populated) {
        await populatedChatChecks(page, frame, item);
        await navigate(page, frame, "/");
      }
    }
  } catch (error) {
    console.log("Interaction failure:", item.name, error.message);
    failures.push({ case: item.name, stage: "interactions", error: error.message });
    await capture(page, item.name + "-interaction-failure");
  }
  for (const [path, label] of manifest.pages) {
    if (filter && !filter.includes(path)) continue;
    if (item.account === "guest" && path.startsWith("/projects/")) continue;
    try {
      await navigate(page, frame, path);
      if (path === "/settings") {
        if (item.width < 768) {
          await frame.getByRole("tab", { name: "General", exact: true }).click();
          await expect(frame.getByRole("tabpanel", { name: "General", exact: true })).toBeVisible();
          await checkSwitch(frame);
          await frame.getByRole("button", { name: "Back to settings", exact: true }).click();
          await expect(
            frame.getByRole("textbox", { name: "Search settings", exact: true }),
          ).toBeFocused();
          await frame.getByRole("tab", { name: "About", exact: true }).click();
          await expect(frame.getByRole("tabpanel", { name: "About", exact: true })).toBeVisible();
          await frame.getByRole("button", { name: "Back to settings", exact: true }).click();
          await frame.locator(".kova-settings-nav").evaluate((element) => (element.scrollTop = 0));
        } else await checkSwitch(frame);
      }
      if (path === "/library" && item.populated) {
        await expect(
          frame.getByText("Welcome notes · fixture", { exact: true }).first(),
        ).toBeVisible();
        await frame.getByRole("button", { name: "List view", exact: true }).click();
        await capture(page, item.name + "-library-list");
        await frame.getByRole("button", { name: "Grid view", exact: true }).click();
      }
      if (item.account !== "guest" && path === "/apps") {
        const connect = frame.getByRole("button", { name: "Add Google account", exact: true });
        await expect(connect).toBeDisabled();
        expect(await connect.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
          "rgba(0, 0, 0, 0)",
        );
      }
      if (item.account !== "guest" && path === "/billing") {
        const manage = frame.getByRole("button", { name: "Manage subscription", exact: true });
        await expect(manage).toBeDisabled();
        expect(await manage.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
          "rgba(0, 0, 0, 0)",
        );
      }
      const overflow = await frame
        .locator("body")
        .evaluate(
          () =>
            Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
        );
      expect(overflow).toBeLessThanOrEqual(1);
      await capture(
        page,
        item.name +
          "-" +
          (path === "/" ? "assistant" : label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")),
      );
      cases.push({ case: item.name, path, status: "passed", overflow });
    } catch (error) {
      console.log("Route failure:", item.name, path, error.message);
      failures.push({ case: item.name, path, error: error.message });
      await capture(
        page,
        item.name + "-failure-" + label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
      );
    }
  }
  await context.close();
  await browser.close();
}
if (!filter && !process.env.KOVA_REVIEW_CASES) {
  for (const [name, width, height] of [
    ["narrow", 320, 740],
    ["tablet", 768, 1024],
    ["landscape", 844, 390],
  ]) {
    const browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    try {
      await page.goto(pathToFileURL(file).href);
      const frame = page.frameLocator("iframe");
      await expect(
        frame.getByRole("textbox", { name: "Message KovaGPT", exact: true }),
      ).toBeVisible();
      const overflow = await frame
        .locator("body")
        .evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await capture(page, name + "-guest-assistant");
      cases.push({ case: name, path: "/", status: "passed", overflow });
    } catch (error) {
      failures.push({ case: name, error: error.message });
    }
    await context.close();
    await browser.close();
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  artifactSha256: sha(await readFile(file)),
  browser: "Chromium",
  cases,
  failures,
  pageErrors,
  externalRequests,
  mobileHeaderTargets,
  screenshotCount: screenshots.length,
  limitations: [
    "Synthetic offline data; live providers, auth, billing, AI, camera hardware and Safari not certified.",
    "No assertion here substitutes for production service integration tests.",
  ],
};
await writeFile(
  resolve(output, process.env.KOVA_REVIEW_REPORT || "audit.json"),
  JSON.stringify(report, null, 2) + "\n",
);
await writeFile(
  resolve(output, process.env.KOVA_REVIEW_SHOT_REPORT || "screenshots.json"),
  JSON.stringify(screenshots, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    cases: cases.length,
    screenshots: screenshots.length,
    failures: failures.length,
    pageErrors: pageErrors.length,
    externalRequests: externalRequests.length,
  }),
);
if (failures.length || pageErrors.length || externalRequests.length) {
  console.log(JSON.stringify({ failures, pageErrors, externalRequests }, null, 2));
  process.exitCode = 1;
}
