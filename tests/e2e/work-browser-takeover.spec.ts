import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

for (const signedIn of [true, false]) {
  test(`retired private-browser bookmark ${signedIn ? "returns its owner to chat" : "requires an account"}`, async ({
    page,
  }) => {
    await fixture(page, "dark", signedIn);
    const commands: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/work/")) commands.push(request.url());
    });
    await page.goto("/work#browser");
    await waitForKovaHydration(page);
    await expect(page).toHaveURL((url) => url.pathname === "/" && url.search === "");
    await expect(
      page.getByRole("region", { name: "Private Work browser", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open browser controls", exact: true }),
    ).toHaveCount(0);
    if (signedIn) {
      await expect(
        page.getByRole("textbox", { name: "Message KovaGPT", exact: true }),
      ).toBeEnabled();
    } else {
      await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Create an account", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toHaveCount(
        0,
      );
    }
    expect(commands).toEqual([]);
  });
}
