import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalWorkspace } from "../../desktop/workspace-files.mjs";
import { createLocalCommandRunner } from "../../desktop/workspace-process.mjs";

for (const width of [720, 1170]) {
  test(`local workspace renders and runs actual local commands at ${width}px`, async ({ page }) => {
    const root = mkdtempSync(join(tmpdir(), "kova-ui-local-"));
    const files = createLocalWorkspace();
    const commands = createLocalCommandRunner();
    const script = join(root, "task.mjs");
    writeFileSync(
      script,
      'console.log("real task result"); setTimeout(() => console.log("done"), 1500);',
    );
    writeFileSync(join(root, "example.ts"), "const original = true;\n");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.setViewportSize({ width, height: 850 });
      await page.exposeFunction(
        "workspaceRequest",
        async (operation: string, ...args: unknown[]) => {
          if (operation === "chooseFolder") return files.chooseFolder(root);
          if (operation === "info") return files.info();
          if (operation === "list") return files.list(args[0]);
          if (operation === "open") return files.open(args[0]);
          if (operation === "preview") return files.preview(...args);
          if (operation === "save") return { ...files.save(...args), saved: true };
          if (operation === "runCommand")
            return { ...commands.start(root, args[0]), started: true };
          if (operation === "commandHistory") return commands.snapshot();
          if (operation === "cancelCommand") return commands.cancel();
          if (operation === "clearCommandHistory") {
            commands.clear();
            return { cleared: true };
          }
          if (operation === "closeFolder") {
            commands.clear();
            files.close();
            return { selected: false };
          }
          if (operation === "git") return { output: "Fixture source control view" };
          throw new Error("Unknown fixture operation");
        },
      );
      await page.addInitScript(() => {
        const methods = [
          "chooseFolder",
          "info",
          "list",
          "open",
          "preview",
          "save",
          "runCommand",
          "commandHistory",
          "cancelCommand",
          "clearCommandHistory",
          "closeFolder",
          "git",
        ];
        window.kovaWorkspace = Object.fromEntries(
          methods.map((method) => [method, (...args) => window.workspaceRequest(method, ...args)]),
        );
      });
      await page.route("http://workspace.test/**", async (route) => {
        const script = new URL(route.request().url()).pathname.endsWith(".js");
        await route.fulfill({
          contentType: script ? "text/javascript" : "text/html",
          body: readFileSync(
            join(process.cwd(), "desktop", script ? "workspace-ui.js" : "workspace.html"),
            "utf8",
          ),
        });
      });
      await page.goto("http://workspace.test/");
      await page.getByRole("button", { name: "Open folder…", exact: true }).click();
      await page.getByRole("button", { name: /example.ts/ }).click();
      await page.getByLabel("Source file editor").fill("const original = false;\n");
      await page.getByRole("button", { name: "Review changes", exact: true }).click();
      await expect(page.getByLabel("Changes preview")).toContainText("+ const original = false;");
      await page.getByRole("button", { name: "Save to disk…", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Saved the selected local file");
      expect(readFileSync(join(root, "example.ts"), "utf8")).toBe("const original = false;\n");
      await page.getByText("Local terminal", { exact: true }).click();
      await page
        .getByLabel("Local command", { exact: true })
        .fill(`"${process.execPath}" "${script}"`);
      await expect(page.getByRole("button", { name: "Review and run…" })).toBeEnabled();
      await page.getByRole("button", { name: "Review and run…" }).click();
      await expect(page.getByLabel("Command output")).toContainText("real task result");
      await expect(page.getByLabel("Command output")).toContainText("completed · Exit 0");
      await expect(page.getByLabel("Command output")).toContainText("done");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      writeFileSync(script, "setInterval(() => {}, 1000);");
      await page.getByRole("button", { name: "Review and run…" }).click();
      await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(page.getByLabel("Command output")).toContainText("cancelled");
      await page.getByLabel("Local command history").selectOption({ index: 1 });
      await expect(page.getByLabel("Command output")).toContainText("real task result");
      await page.getByRole("button", { name: "Clear history", exact: true }).click();
      await expect(page.getByLabel("Command output")).toHaveText("No commands have run.");
      await page.getByRole("button", { name: "Close folder", exact: true }).click();
      await expect(page.getByLabel("Local command", { exact: true })).toBeDisabled();
      expect(errors).toEqual([]);
    } finally {
      commands.dispose();
      await page.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
