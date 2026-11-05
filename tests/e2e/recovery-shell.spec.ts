import { test, expect } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";

test("workspace search preserves the sidebar and restores its active dialog", async ({
  page,
}, info) => {
  await coreFixture(page, "dark", "free");
  // This fixture represents a returning Supabase user. In a dual-auth build,
  // resolve the real owned-cookie probe as empty before selecting that session.
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { session: null } }));
  await page.goto("/");
  await waitForKovaHydration(page);

  // Auth can settle after hydration and remount the shell. The signed-in rail
  // stays mounted below the desktop CSS breakpoint even though it is hidden.
  const rail = page.getByRole("navigation", {
    name: "Collapsed navigation",
    exact: true,
    includeHidden: true,
  });
  await expect(rail).toBeAttached();
  const mobile = page.viewportSize()!.width < 1024;
  const opener = mobile
    ? page.getByRole("button", { name: "Open menu", exact: true })
    : rail.getByRole("button", { name: "Expand sidebar", exact: true });
  await expect(opener).toBeVisible();
  await opener.click();

  const sidebar = page.locator("#kova-primary-navigation");
  await expect(sidebar).toHaveAttribute("data-state", "open");
  if (mobile) {
    await expect(
      page.getByRole("dialog", { name: "Primary navigation", exact: true }),
    ).toBeVisible();
    await expect(sidebar).toHaveAttribute("aria-modal", "true");
  }
  const account = sidebar.getByRole("button", { name: "Account menu", exact: true });
  await expect(account).toBeVisible();
  await expect(account).toContainText("Shell Parity");
  await sidebar.getByRole("button", { name: "Search chats", exact: true }).click();

  const search = page.getByRole("dialog", {
    name: "Search workspace, chats, and actions",
    exact: true,
  });
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute("aria-modal", "true");
  const clippedLabels = await search.getByRole("option").evaluateAll((options) =>
    options.flatMap((option) => {
      const bounds = option.getBoundingClientRect();
      return [...option.querySelectorAll(":scope > span")].flatMap((label) => {
        // Chat/workspace titles deliberately use ellipses; command labels and
        // explanations must remain readable within their own result rows.
        if (getComputedStyle(label).textOverflow === "ellipsis") return [];
        const range = document.createRange();
        range.selectNodeContents(label);
        return [...range.getClientRects()].some(
          (text) =>
            text.left < bounds.left - 1 ||
            text.right > bounds.right + 1 ||
            text.top < bounds.top - 1 ||
            text.bottom > bounds.bottom + 1,
        )
          ? [label.textContent]
          : [];
      });
    }),
  );
  expect(clippedLabels, "Command labels and disabled reasons must fit their rows").toEqual([]);
  await expect(
    search.getByRole("combobox", { name: "Search workspace, commands, and chats", exact: true }),
  ).toBeFocused();
  if (mobile) {
    await expect(sidebar).toHaveAttribute("data-state", "open");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await expect(sidebar).toHaveJSProperty("inert", true);
    await expect(sidebar).not.toHaveAttribute("aria-modal", "true");
  }
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("workspace-search.png"), animations: "disabled" });

  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect(sidebar).toHaveAttribute("data-state", "open");
  await expect(sidebar).toHaveJSProperty("inert", false);
  await expect(sidebar.getByRole("button", { name: "Search chats", exact: true })).toBeFocused();
  if (mobile) {
    await expect(sidebar).toHaveAttribute("aria-modal", "true");
    await expect(page.getByRole("main")).toHaveJSProperty("inert", true);
    await sidebar.getByRole("button", { name: "Close sidebar", exact: true }).click();
    await expect(sidebar).toHaveAttribute("data-state", "closed");
  }
  await expect(page.getByRole("main")).toHaveJSProperty("inert", false);
  const composer = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await expect(composer).toBeVisible();
  await expect(composer).toBeEnabled();
  await expect(composer).toBeEditable();
  await composer.click();
  await expect(composer).toBeFocused();
});

for (const input of ["pointer", "keyboard"] as const) {
  test(`search can explicitly close an open phone sidebar and focus the composer with ${input}`, async ({
    page,
  }) => {
    test.skip(page.viewportSize()!.width >= 1024);
    await coreFixture(page, "dark", "free");
    await page.goto("/");
    await waitForKovaHydration(page);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    const sidebar = page.locator("#kova-primary-navigation");
    await sidebar.getByRole("button", { name: "Search chats", exact: true }).click();
    const search = page.getByRole("dialog", { name: "Search workspace, chats, and actions" });
    await expect(search).toBeVisible();
    const action = search.getByRole("option", {
      name: "Close sidebar and focus message box",
      exact: true,
    });
    if (input === "keyboard") {
      const query = search.getByRole("combobox", {
        name: "Search workspace, commands, and chats",
        exact: true,
      });
      await query.fill("focus message box");
      await query.press("ArrowDown");
      await query.press("ArrowDown");
      await expect(query).toHaveAttribute(
        "aria-activedescendant",
        (await action.getAttribute("id"))!,
      );
      await query.press("Enter");
    } else await action.click();
    await expect(search).toBeHidden();
    await expect(sidebar).toHaveAttribute("data-state", "closed");
    await expect(page.getByRole("main")).toHaveJSProperty("inert", false);
    const composer = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    await expect(composer).toBeFocused();
    await composer.fill("A new draft after workspace search");
    await expect(composer).toHaveValue("A new draft after workspace search");
  });
}
