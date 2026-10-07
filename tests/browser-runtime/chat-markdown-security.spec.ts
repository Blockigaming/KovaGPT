import { test, expect } from "@playwright/test";
import { build } from "esbuild";

// Bundle the actual assistant component and Markdown pipeline. Only account/server
// boundaries are stubbed; unopened lazy dialogs remain unloaded, as in the app.
const mocks: Record<string, string> = {
  "@/components/auth/ClerkSafe": "export const useUser = () => ({ isSignedIn: false });",
  "@tanstack/react-start": "export const useServerFn = fn => fn;",
  "@/lib/auth-fetch": "export const authFetch = () => { throw new Error('Unexpected API call'); };",
  "@/lib/library.functions":
    "export const saveToLibrary = () => { throw new Error('Unexpected save'); };",
  "@/lib/feedback.functions":
    "export const getResponseFeedbackBatch = () => { throw new Error('Unexpected feedback load'); }; export const submitResponseFeedback = () => { throw new Error('Unexpected feedback submission'); };",
};
const result = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { ChatMessage } from './src/components/ChatMessage';
      const root = createRoot(document.getElementById('root'));
      window.renderAssistant = (content, streaming = false) => flushSync(() => root.render(
        <ChatMessage message={{id: 'remote-markdown', role: 'assistant', content}}
          streaming={streaming} userKey={null} principalResolved={true} />
      ));
    `,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  plugins: [
    {
      name: "markdown-account-fixtures",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (mocks[args.path]) return { path: args.path, namespace: "fixture" };
          if (args.kind === "dynamic-import") return { path: args.path, external: true };
        });
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: mocks[args.path],
          loader: "js",
        }));
      },
    },
  ],
});
const script = result.outputFiles[0].text;
const imageOrigin = "https://remote-image.test";

test("assistant Markdown images make no request until explicitly clicked", async ({
  page,
  context,
}) => {
  await page.route("https://kova-markdown.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' }),
  );
  await page.goto("https://kova-markdown.test/");

  // Observe attempts at the context level, including a popup's initial request.
  // Fulfill locally so even a regression cannot send fixture data to the Internet.
  const requests: { url: string; navigation: boolean; referer: string | undefined }[] = [];
  context.on("request", (request) => {
    requests.push({
      url: request.url(),
      navigation: request.isNavigationRequest(),
      referer: request.headers().referer,
    });
  });
  await context.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Image destination</title>",
    }),
  );
  await page.addScriptTag({ content: script });

  const images = [
    { name: "Inline image", url: `${imageOrigin}/inline.png?connector=synthetic` },
    { name: "Reference image", url: `${imageOrigin}/reference.png` },
    { name: "Open image", url: `${imageOrigin}/empty-alt.png` },
    { name: "Protocol relative", url: `${imageOrigin}/relative.png` },
    { name: "Linked image", url: `${imageOrigin}/linked.png` },
  ];
  const markdown = [
    `![Inline image](${images[0].url} "Remote title")`,
    "![Reference image][remote]",
    `![](${images[2].url})`,
    "![Protocol relative](//remote-image.test/relative.png)",
    `[![Linked image](${images[4].url})](${imageOrigin}/outer-link)`,
    `<img src="${imageOrigin}/raw.png" srcset="${imageOrigin}/raw-2x.png 2x">`,
    `[remote]: ${images[1].url}`,
  ].join("\n\n");
  for (const streaming of [true, false]) {
    await page.evaluate(
      ({ markdown, streaming }) =>
        (
          window as unknown as { renderAssistant: (text: string, streaming: boolean) => void }
        ).renderAssistant(markdown, streaming),
      { markdown, streaming },
    );
    await expect(page.getByRole("article", { name: "KovaGPT response" })).toBeVisible();
    // A bounded quiet window catches eager resource loads after React commits.
    await page.waitForTimeout(250);
    expect(requests).toEqual([]);
    await expect(page.locator("img")).toHaveCount(0);
  }

  for (const { name, url } of images) {
    const link = page.getByRole("link", { name: `${name} (opens in a new tab)`, exact: true });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noreferrer noopener");
    const destination = name === "Linked image" ? `${imageOrigin}/outer-link` : url;
    expect(await link.evaluate((element) => (element as HTMLAnchorElement).href)).toBe(destination);
    await expect(page.locator("a a")).toHaveCount(0);
    await link.focus();
    await link.hover();
    await page.waitForTimeout(250);
    expect(requests).toEqual([]);

    const popupPromise = context.waitForEvent("page");
    await link.click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    expect(popup.url()).toBe(destination);
    expect(requests).toEqual([{ url: destination, navigation: true, referer: undefined }]);
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    await popup.close();
    requests.length = 0;
  }
});
