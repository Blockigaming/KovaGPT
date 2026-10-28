import { expect, test } from "@playwright/test";
import { build } from "esbuild";

let bundle = "";
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{EnterpriseContactDialog}from'./src/components/EnterpriseContactDialog';function Harness(){const[open,setOpen]=useState(true);return <EnterpriseContactDialog open={open} onOpenChange={setOpen}/>};createRoot(document.getElementById('root')).render(<Harness/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
  });
  bundle = result.outputFiles[0].text;
});

test("Enterprise team-size popup preserves required empty state, clearing and focus", async ({
  page,
}) => {
  await page.route("**/*", (route) =>
    route.request().url() === "https://enterprise-select-fixture.invalid/"
      ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' })
      : route.abort("blockedbyclient"),
  );
  await page.goto("https://enterprise-select-fixture.invalid/");
  await page.addScriptTag({ content: bundle });
  const dialog = page.getByRole("dialog", { name: "Build your Kova Enterprise workspace" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Your name", { exact: true }).fill("Review User");
  await dialog.getByLabel("Work email", { exact: true }).fill("review@example.invalid");
  await dialog.getByLabel("Company", { exact: true }).fill("Review workspace");
  await dialog.getByLabel("What are you looking for?", { exact: true }).fill("Interface review");
  const form = dialog.locator("form");
  const teamSize = dialog.getByRole("combobox", { name: "Team size", exact: true });
  await expect(teamSize).toContainText("Select a range");
  expect(await form.evaluate((element: HTMLFormElement) => element.checkValidity())).toBe(false);
  await teamSize.click();
  await expect(page.getByRole("option", { name: "50-249", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(teamSize).toBeFocused();
  await teamSize.click();
  await page.getByRole("option", { name: "50-249", exact: true }).click();
  await expect(teamSize).toContainText("50-249");
  await expect
    .poll(() => form.evaluate((element: HTMLFormElement) => element.checkValidity()))
    .toBe(true);
  await teamSize.click();
  await page.getByRole("option", { name: "Select a range", exact: true }).click();
  await expect(teamSize).toContainText("Select a range");
  await expect
    .poll(() => form.evaluate((element: HTMLFormElement) => element.checkValidity()))
    .toBe(false);
  await expect(dialog.getByRole("status")).toHaveCount(0);
});
