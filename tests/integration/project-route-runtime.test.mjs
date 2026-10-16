import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToString } from "react-dom/server";
import * as routing from "@tanstack/react-router";
import { isServer as routerBundleIsServer } from "@tanstack/router-core/isServer";
import { projectTabSearch } from "../../src/lib/project-tab-search.ts";

// Use the application's route declarations, wrappers and generated topology.
// Only business-page bodies are fixtures: no account, backend or browser access.
function execute(source, bindings = {}) {
  const exports = {};
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    ...bindings,
    require(name) {
      assert.equal(name, "react/jsx-runtime");
      return jsx;
    },
  });
  return exports;
}

function statements(path) {
  const source = readFileSync(path, "utf8");
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    .statements;
}

function route(path) {
  const source = statements(path)
    .filter((node) =>
      ts.isVariableStatement(node)
        ? node.declarationList.declarations.some((d) => d.name.getText() === "Route")
        : ts.isFunctionDeclaration(node) && /Route$/.test(node.name?.text ?? ""),
    )
    .map((node) => node.getText())
    .join("\n");
  return execute(source, {
    ...routing,
    projectTabSearch,
    ProjectsPage: () => React.createElement("h1", null, "Projects overview"),
    ProjectDetailPage: () => React.createElement("h1", null, "Project workspace"),
    ProjectChatPage: () => React.createElement("h1", null, "Project chat"),
  }).Route;
}

function makeRouter(path, isServer = true) {
  const bindings = { rootRouteImport: routing.createRootRoute({ component: routing.Outlet }) };
  const generated = statements("src/routeTree.gen.ts");
  for (const node of generated) {
    if (!ts.isImportDeclaration(node) || !node.moduleSpecifier.text.startsWith("./routes/projects"))
      continue;
    const variable = node.importClause.namedBindings.elements[0].name.text;
    bindings[variable] = route(`src/${node.moduleSpecifier.text.replace("./", "")}.tsx`);
  }
  const source = generated
    .filter(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.every((d) => d.name.getText().startsWith("Projects")),
    )
    .map((node) => node.getText())
    .join("\n");
  const { tree } = execute(
    `${source}\nexports.tree = rootRouteImport.addChildren([ProjectsRouteWithChildren]);`,
    bindings,
  );
  return routing.createRouter({
    routeTree: tree,
    history: routing.createMemoryHistory({ initialEntries: [path] }),
    isServer,
  });
}

function content(router) {
  return renderToString(React.createElement(routing.RouterProvider, { router })).replace(
    /<!--\/?\$-->/g,
    "",
  );
}

function serverRedirect(router) {
  // The installed router's SSR request handler reads _serverResult. Older
  // retained Router versions exposed the same redirect through state instead.
  return router._serverResult?.type === "redirect"
    ? router._serverResult.redirect
    : router.state.redirect;
}

test("the overview belongs exclusively to the index; its parent is an unconditional outlet", async () => {
  const router = makeRouter("/projects");
  await router.load();
  assert.equal(router.routesById["/projects"].options.component, routing.Outlet);
  assert.equal(router.state.matches.at(-1).routeId, "/projects/");
  assert.equal(content(router), "<h1>Projects overview</h1>");
});

test("direct project and chat URLs select their leaf without rendering the overview", async () => {
  for (const [path, expected, routeId] of [
    ["/projects/offline-project", "Project workspace", "/projects/$projectId"],
    ["/projects/offline-project?tab=files", "Project workspace", "/projects/$projectId"],
    [
      "/projects/offline-project/chat/offline-chat",
      "Project chat",
      "/projects/$projectId/chat/$chatId",
    ],
  ]) {
    const router = makeRouter(path);
    await router.load();
    assert.equal(router.state.matches.at(-1).routeId, routeId, path);
    assert.equal(router.state.matches.at(-1).params.projectId, "offline-project", path);
    assert.equal(content(router), `<h1>${expected}</h1>`, path);
    assert.ok(!router.state.matches.some((match) => match.routeId === "/projects/"), path);
  }
});

test("a trailing slash redirects to the same project, never to the overview", async () => {
  const router = makeRouter("/projects/offline-project/");
  await router.load();
  assert.equal(serverRedirect(router)?.options.statusCode, 307);
  assert.equal(serverRedirect(router)?.options.href, "/projects/offline-project");
});

test("the integrated project route retains its real tab validation and unrelated search state", async () => {
  for (const [query, tab] of [
    ["tab=files&from=library", "files"],
    ["tab=not-a-tab&from=library", "overview"],
  ]) {
    let router = makeRouter(`/projects/offline-project?${query}`);
    await router.load();
    if (serverRedirect(router)) {
      const href = serverRedirect(router).options.href;
      const target = new URL(href, "https://fixture.invalid");
      assert.equal(target.pathname, "/projects/offline-project");
      assert.equal(target.searchParams.get("tab"), tab);
      assert.equal(target.searchParams.get("from"), "library");
      router = makeRouter(href);
      await router.load();
    }
    const leaf = router.state.matches.at(-1);
    assert.ok(
      leaf,
      JSON.stringify({
        expectedPath: "/projects/offline-project",
        pathname: router.state.location.pathname,
        search: router.state.location.search,
        status: router.state.status,
        statusCode: router.state.statusCode,
        redirectedTo: serverRedirect(router)?.options.href,
      }),
    );
    assert.equal(leaf.routeId, "/projects/$projectId");
    assert.equal(leaf.search.tab, tab);
    assert.equal(leaf.search.from, "library");
    assert.equal(content(router), "<h1>Project workspace</h1>");
  }
});

test("reactive router navigation switches overview, workspace, chat and back without retaining the list", async () => {
  if (routerBundleIsServer === true) {
    // The Node production export intentionally disables client navigation.
    // The package's development export honors isServer=false for this explicit
    // client-router fixture without pretending SSR navigation is a browser.
    const child = spawnSync(
      process.execPath,
      [
        "--conditions=development",
        "--import",
        "./tests/fixtures/azure-local-network-guard.mjs",
        "--test",
        "--test-name-pattern=^reactive router navigation",
        fileURLToPath(import.meta.url),
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PORT: process.env.PORT ?? "43187" },
        encoding: "utf8",
        timeout: 15000,
      },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, (child.stdout ?? "") + (child.stderr ?? ""));
    return;
  }
  const router = makeRouter("/projects", false);
  await router.load();
  assert.equal(content(router), "<h1>Projects overview</h1>");
  for (const [to, expected] of [
    ["/projects/offline-project", "Project workspace"],
    ["/projects/offline-project/chat/offline-chat", "Project chat"],
    ["/projects/another-project", "Project workspace"],
    ["/projects", "Projects overview"],
  ]) {
    await router.navigate({ to });
    assert.equal(content(router), `<h1>${expected}</h1>`, to);
  }
});
