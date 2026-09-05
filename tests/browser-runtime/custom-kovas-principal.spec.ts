import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
const A = "123e4567-e89b-42d3-a456-426614174000",
  B = "223e4567-e89b-42d3-a456-426614174000",
  K = "323e4567-e89b-42d3-a456-426614174000",
  V = "423e4567-e89b-42d3-a456-426614174000";
const root = process.cwd();
const mocks: Record<string, string> = {
  "@tanstack/react-router": `export const createFileRoute=()=>value=>({...value,useSearch:()=>({})});export const useNavigate=()=>async()=>{};export const Link=({children})=>children;`,
  "@/components/AppShell": `export const AppShell=({children})=>children;`,
  "@/components/auth/ClerkSafe": `export const useUser=()=>({isLoaded:true,user:{id:window.testOwner}});export const SignInButton=({children})=>children;`,
  "@/lib/custom-kovas-client": `export const requestKovas=(...args)=>window.testRequest(...args);export const newKovaLinkToken=()=>"x".repeat(43);`,
  "@/lib/chat-store": `export const loadConversations=()=>[];export const saveConversations=async()=>true;export const savePendingActive=()=>{};export const saveDraft=()=>{};`,
  "@/components/CustomKovaPreview": `export default function Preview(){return null}`,
};
const result = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{Route}from'./src/routes/kovas.tsx';const root=createRoot(document.getElementById('root'));window.testOwner=${JSON.stringify(A)};window.renderOwner=owner=>{window.testOwner=owner;root.render(React.createElement(Route.component))};window.renderOwner(window.testOwner);`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  plugins: [
    {
      name: "bounded-ui-fixtures",
      setup(builder) {
        builder.onResolve({ filter: /^@\// }, (args) =>
          mocks[args.path]
            ? { path: args.path, namespace: "fixture" }
            : { path: path.join(root, "src", args.path.slice(2)) },
        );
        builder.onResolve({ filter: /^@tanstack\/react-router$/ }, (args) => ({
          path: args.path,
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: mocks[args.path],
          loader: "tsx",
        }));
      },
    },
  ],
});
const script = result.outputFiles[0].text;
test.beforeEach(async ({ page }) => {
  await page.route("https://kova-ui.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' }),
  );
  await page.goto("https://kova-ui.test");
  await page.evaluate(
    ({ A, B, K, V }) => {
      const state = window as unknown as {
        testRequest: (
          owner: string,
          url: string,
          signal: AbortSignal,
          body?: unknown,
        ) => Promise<unknown>;
        pending: {
          resolve: (value: unknown) => void;
          owner: string;
          url: string;
          body?: unknown;
        }[];
        config: Record<string, unknown>;
        makeView: (owner: string) => Record<string, unknown>;
      };
      state.pending = [];
      state.config = {
        name: "Private Kova",
        icon: "✦",
        description: "Private description",
        instructions: "private-owner-body",
        mode: "medium",
        tools: [],
        apps: [],
        starters: [],
        knowledge: [],
        allowFork: false,
      };
      state.makeView = (owner) => ({
        id: K,
        owned: true,
        revision: 1,
        visibility: "private",
        blocked: false,
        versionId: V,
        publicationVersion: null,
        config: { ...state.config, name: owner === A ? "A private Kova" : "B private Kova" },
        knowledge: [],
      });
      state.testRequest = (owner, url, _signal, body) => {
        if (url.includes("scope=owned"))
          return Promise.resolve({
            rows: [
              {
                id: K,
                owned: true,
                revision: 1,
                visibility: "private",
                blocked: false,
                version_id: V,
                config: {
                  ...state.config,
                  name: owner === A ? "A private Kova" : "B private Kova",
                },
              },
            ],
          });
        if (url.includes("scope=versions"))
          return Promise.resolve({
            rows: [{ id: V, version: 1, created_at: new Date().toISOString(), size_bytes: 500 }],
          });
        return new Promise((resolve) => state.pending.push({ resolve, owner, url, body }));
      };
    },
    { A, B, K, V },
  );
  await page.addScriptTag({ content: script });
});
test("an old owner read cannot refill the builder after account switch", async ({ page }) => {
  await page.getByRole("button", { name: /A private Kova/ }).click();
  await page.evaluate(
    (B) => (window as unknown as { renderOwner: (id: string) => void }).renderOwner(B),
    B,
  );
  await expect(page.getByRole("button", { name: /B private Kova/ })).toBeVisible();
  await page.evaluate((A) => {
    const state = window as unknown as {
      pending: { resolve: (value: unknown) => void }[];
      makeView: (owner: string) => unknown;
    };
    state.pending[0].resolve(state.makeView(A));
  }, A);
  await expect(page.getByRole("button", { name: /A private Kova/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Kova", exact: true })).toHaveCount(0);
});
test("privacy reset during uncertain save clears private bodies and ignores the late completion", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Create a Kova", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Private draft");
  await page
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("Do not restore after device reset");
  await page.getByRole("button", { name: "Save private version", exact: true }).click();
  await page.evaluate((A) => {
    window.dispatchEvent(
      new CustomEvent("kova:principal-browser-storage-cleared", {
        detail: { principal: `user:${A}` },
      }),
    );
  }, A);
  await expect(page.getByRole("status")).toContainText("Device data was cleared");
  await page.evaluate(
    ({ K, V }) => {
      const state = window as unknown as { pending: { resolve: (value: unknown) => void }[] };
      state.pending[0].resolve({
        id: K,
        revision: 1,
        versionId: V,
        visibility: "private",
        deleted: false,
      });
    },
    { K, V },
  );
  await expect(page.getByText("Do not restore after device reset", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish in community directory" })).toHaveCount(0);
});
