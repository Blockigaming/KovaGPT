import { expect, test } from "@playwright/test";
import { fixture, owner } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

for (const signedIn of [true, false]) {
  test(`private-browser bookmark ${signedIn ? "opens Work without starting a browser" : "requires an account"}`, async ({
    page,
  }) => {
    await fixture(page, "dark", signedIn, false, "pro");
    await page.route("**/api/work/sync**", (route) =>
      route.fulfill({
        json: {
          savedRecords: [],
          recentItems: [],
          nextCursor: 0,
          currentVersion: 0,
          hasMore: false,
        },
      }),
    );
    await page.route("**/api/work/execution**", (route) =>
      route.fulfill({
        json: {
          readiness: {
            available: true,
            reason: null,
            modelOptions: [
              {
                mode: "normal",
                label: "Normal",
                model: "kova-argon-4.6",
                available: true,
                reason: null,
                reasoningEfforts: [],
                maxOutputTokens: 4096,
              },
            ],
          },
          runs: [],
          nextCursor: null,
        },
      }),
    );
    const commands: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      // Readiness and owner history may load; bookmarks cannot start or recover a browser.
      const historyRead =
        request.method() === "GET" && ["/api/work/sync", "/api/work/execution"].includes(path);
      if (path.startsWith("/api/work/") && !historyRead) commands.push(request.url());
    });
    await page.goto("/work#browser");
    await waitForKovaHydration(page);
    await expect(page).toHaveURL((url) => url.pathname === "/work" && url.hash === "#browser");
    await expect(
      page.getByRole("region", { name: "Private Work browser", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open browser", exact: true })).toHaveCount(0);
    if (signedIn) {
      await expect(
        page.getByRole("main").getByRole("heading", { name: "Work", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("region", { name: "Work execution", exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("textbox", { name: "Email address", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Work execution", exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toHaveCount(
        0,
      );
    }
    expect(commands).toEqual([]);
  });
}

test("Work takeover displays the remote page directly inside the browser workspace", async ({
  page,
}) => {
  const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const frameId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const objective = "Review the Example Domain page";
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: viewport.width >= 1024 ? viewport.width - 280 : viewport.width,
    height: viewport.width >= 1024 ? viewport.height : viewport.height - 56,
  });
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width">
    <style>body { background: #eee; color: #222; font: 16px system-ui; }
    main { max-width: 600px; margin: 12vh auto; }
    h1 { font-size: 1.5em; } a { color: #348; }</style>
    <main><h1>Example Domain</h1><p>This domain is for use in documentation examples
    without needing permission. This is not a service: avoid relying on it for testing
    or monitoring purposes.</p><p><a href="https://iana.org/domains/example">Learn more</a></p></main>`);
  const jpeg = (await page.screenshot({ type: "jpeg" })).toString("base64");
  await page.setViewportSize(viewport);
  await fixture(page, "dark", true, false, "pro");
  await page.route("**/api/work/sync**", (route) =>
    route.fulfill({
      json: { savedRecords: [], recentItems: [], nextCursor: 0, currentVersion: 0, hasMore: false },
    }),
  );
  await page.route("**/api/work/execution**", (route) =>
    route.fulfill({
      json: {
        readiness: {
          available: true,
          reason: null,
          modelOptions: [
            {
              mode: "normal",
              label: "Normal",
              model: "kova-argon-4.6",
              available: true,
              reason: null,
              reasoningEfforts: [],
              maxOutputTokens: 4096,
            },
          ],
        },
        runs: [
          {
            id: runId,
            ownerId: owner,
            status: "paused",
            revision: 4,
            request: { objective },
            model: "kova-argon-4.6",
            directions: [],
            outputRefs: [],
            specialists: [],
            evidence: [],
            usage: { actions: 1, tokens: 280, costMicros: 0 },
            limits: { maxActions: 8, maxTokens: 4096 },
          },
        ],
        nextCursor: null,
      },
    }),
  );
  const actions: Array<{ kind: string; text?: string; x?: number; y?: number }> = [];
  let frameSize = { width: 1280, height: 900 };
  const expiresAt = Date.now() + 120000;
  await page.route("**/api/work/browser**", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          readiness: { available: true, visualTakeover: true },
          runRevision: 4,
          runStatus: "paused",
          sessions: [
            {
              id: sessionId,
              sequence: 2,
              mode: "agent",
              expires_at: new Date(expiresAt).toISOString(),
            },
          ],
        },
      });
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ runId, sessionId, expectedRevision: 4 });
    if (body.visual) actions.push(body.visual);
    if (body.visual?.kind === "frame" && body.visual.width)
      frameSize = { width: body.visual.width, height: body.visual.height };
    return route.fulfill({
      json: {
        expiresAt,
        result: {
          runId,
          sessionId,
          sequence: body.expectedSequence + (body.visual?.kind === "frame" ? 0 : 1),
          mode: body.operation === "release" ? "agent" : "takeover",
          ...(body.visual && { frame: { id: frameId, jpeg, ...frameSize } }),
        },
      },
    });
  });
  await page.goto("/work");
  await waitForKovaHydration(page);
  await page.getByText("Choose a run", { exact: true }).click();
  await page.getByText(`${objective} · paused`, { exact: true }).click();
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  const workspace = page.getByRole("dialog", { name: "Cloud browser", exact: true });
  const screen = workspace.getByRole("img", { name: "Live browser page" });
  await expect(screen).toBeVisible();
  await expect(workspace.getByText("Read current page", { exact: true })).toHaveCount(0);
  await expect(workspace.getByText("Page control", { exact: true })).toHaveCount(0);
  await expect(workspace.getByRole("button")).toHaveCount(2);
  const main = await page.locator(".kova-app-content").boundingBox();
  const bounds = await workspace.boundingBox();
  expect(main).not.toBeNull();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeCloseTo(main!.x, 0);
  expect(bounds!.width).toBeCloseTo(main!.width, 0);
  const image = (await screen.boundingBox())!;
  expect(image.x).toBeCloseTo(bounds!.x, 0);
  expect(image.y).toBeCloseTo(bounds!.y, 0);
  expect(image.width).toBeCloseTo(bounds!.width, 0);
  expect(image.height).toBeCloseTo(bounds!.height, 0);
  const scale = Math.min(1, 1600 / image.width, 1200 / image.height);
  const remoteWidth = Math.round(image.width * scale);
  const remoteHeight = Math.round(image.height * scale);
  await expect(screen).toHaveAttribute("width", String(remoteWidth));
  await expect(screen).toHaveAttribute("height", String(remoteHeight));
  // On narrow phones the browser midpoint can sit under Return control.
  const title = (await workspace.locator(".kova-browser-workspace-title").boundingBox())!;
  const controls = (await workspace.locator(".kova-browser-workspace-actions").boundingBox())!;
  const titleEnd = title.x + title.width;
  expect(controls.x).toBeGreaterThan(titleEnd);
  const clickPosition = { x: (titleEnd + controls.x) / 2 - image.x, y: 18 };
  await screen.click({ position: clickPosition });
  await expect.poll(() => actions.map(({ kind }) => kind)).toContain("click");
  const click = actions.find(({ kind }) => kind === "click")!;
  expect(Math.abs(click.x! - (clickPosition.x * remoteWidth) / image.width)).toBeLessThan(5);
  expect(Math.abs(click.y! - (clickPosition.y * remoteHeight) / image.height)).toBeLessThan(5);
  await page.keyboard.insertText("local fixture text");
  await expect
    .poll(() => actions.find(({ kind }) => kind === "input")?.text)
    .toBe("local fixture text");
  await workspace.getByRole("button", { name: "Return control", exact: true }).click();
  await expect(workspace).toBeHidden();
  await expect(page.getByRole("button", { name: "Take over", exact: true })).toBeFocused();
});
