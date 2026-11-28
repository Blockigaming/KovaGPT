import { expect, test } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { resolveFixtureFunctionName } from "./server-function-fixture";
import { waitForKovaHydration } from "./hydration";
import { revealSidebar } from "./current-ui";

const account = {
  id: "77777777-7777-4777-8777-777777777777",
  label: "review@example.invalid",
  provider: "gmail",
  canModify: true,
  canReply: true,
};
const email = {
  id: "synthetic-mail-1",
  from: "Alex Morgan",
  subject: "Project notes for Monday",
  preview: "Here are the updated notes for our next meeting.",
  body: "Here are the updated notes for our next meeting. Please share any changes.",
  date: "2026-11-26T15:00:00Z",
  unread: true,
};
const messages = [
  email,
  {
    ...email,
    id: "synthetic-mail-2",
    from: "Design team",
    subject: "Updated design review",
    preview: "The new layout is ready to review.",
    unread: false,
  },
];
const notice = {
  id: "66666666-6666-4666-8666-666666666666",
  source: "application",
  type: "product_update",
  title: "Product update — sample",
  preview: "Synthetic notification for interface review only.",
  actionUrl: null,
  readAt: null,
  createdAt: "2026-11-27T15:00:00Z",
};

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: connected Inbox, reply, shared toast and Trash review`, async ({
    page,
  }, info) => {
    test.skip(!["desktop-1440x900", "phone-390x844"].includes(info.project.name));
    test.setTimeout(90_000);
    await coreFixture(page, theme, "pro");
    let trashed = false;
    let replies = 0;
    await page.route("**/_serverFn/**", async (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
      const name = (resolveFixtureFunctionName(id) ?? "").split("_")[0];
      const body = decodeURIComponent(route.request().url()) + (route.request().postData() ?? "");
      const reads: Record<string, unknown> = {
        listInboxAccounts: [account],
        listInboxMessages: {
          messages: body.includes("trash")
            ? trashed
              ? [email]
              : []
            : messages.filter((item) => !trashed || item.id !== email.id),
          next: null,
        },
        listNotifications: [notice],
        readInboxMessage: email,
        markNotificationsRead: { ok: true },
        updateInboxMessage: { ok: true },
        replyInboxMessage: { sent: true },
      };
      if (!(name in reads)) return route.fallback();
      if (name === "replyInboxMessage") replies++;
      if (name === "updateInboxMessage" && body.includes("trash")) trashed = true;
      return route.fulfill({ json: { result: reads[name], context: {} } });
    });
    const capture = async (name: string) =>
      page.screenshot({ path: info.outputPath(`${theme}-${name}.png`), animations: "disabled" });

    await page.goto("/inbox");
    await waitForKovaHydration(page);
    await expect(page.getByText(email.subject, { exact: true })).toBeVisible();
    await expect(page.getByText(notice.title, { exact: true })).toBeVisible();
    await capture("inbox-list");
    const navigation = await revealSidebar(page);
    await expect(navigation.getByRole("link", { name: "Inbox", exact: true })).toBeVisible();
    await capture("inbox-sidebar");
    await page.goto("/inbox");
    await expect(page.getByText(email.subject, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Project notes for Monday/ }).click();
    await expect(page.getByRole("heading", { name: email.subject })).toBeVisible();
    await page.getByLabel("Reply to sender").fill("Thanks for sharing the notes.");
    await capture("inbox-reply");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Email sent" });
    await expect(toast).toBeVisible();
    expect(replies).toBe(1);
    const toaster = page.locator("[data-sonner-toaster]").filter({ has: toast });
    await expect(toaster).toHaveAttribute(
      "data-x-position",
      info.project.name === "desktop-1440x900" ? "right" : "center",
    );
    await capture("inbox-shared-toast");
    await page.getByRole("button", { name: "Move to Trash" }).click();
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(page.getByText(email.subject, { exact: true })).toBeVisible();
    await capture("inbox-trash");
    await page.goto("/settings/appearance");
    await waitForKovaHydration(page);
    await page.getByText("Inbox appearance", { exact: true }).scrollIntoViewIfNeeded();
    await capture("inbox-appearance");
  });
}
