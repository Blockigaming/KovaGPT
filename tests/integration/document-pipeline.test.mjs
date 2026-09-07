import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import ts from "typescript";
import { fonts, load } from "../helpers/document-writers.mjs";

test(
  "built browser worker extracts real PDF and Office files, rejects unsafe input, and honors abort",
  { timeout: 60_000 },
  async () => {
    const fixtures = new Map();
    const markdown =
      "# Evidence\n\nCafé Ελληνικά\n\n| Item | Value |\n| --- | --- |\n| Final | =1+1 |";
    for (const [extension, method] of [
      ["pdf", "createDocumentPdf"],
      ["docx", "createDocumentDocx"],
      ["xlsx", "createDocumentXlsx"],
      ["pptx", "createDocumentPptx"],
    ])
      fixtures.set(
        `/sample.${extension}`,
        await load(`src/lib/writing-export/${extension}.ts`)[method](
          "Browser document",
          markdown,
          fonts,
        ),
      );
    const manifest = JSON.parse(readFileSync("dist/client/.vite/manifest.json", "utf8"));
    const client = manifest["src/lib/document-extraction/client.ts"]?.file?.replace(
      /^assets\//u,
      "",
    );
    assert.ok(client, "production document extraction entry is missing");
    const server = createServer((request, response) => {
      if (request.url === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end("<!doctype html><title>Document extraction fixture</title>");
      } else if (fixtures.has(request.url)) response.end(fixtures.get(request.url));
      else if (/^\/assets\/[A-Za-z0-9_.-]+\.js$/u.test(request.url ?? "")) {
        response.setHeader("Content-Type", "text/javascript");
        try {
          response.end(readFileSync(join("dist/client", request.url)));
        } catch {
          response.writeHead(404).end();
        }
      } else response.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      let externalRequests = 0;
      await page.route("**/*", (route) =>
        route
          .request()
          .url()
          .startsWith(origin + "/")
          ? route.continue()
          : (externalRequests++, route.abort()),
      );
      await page.goto(origin);
      const results = await page.evaluate(
        async ({ client }) => {
          const { extractDocumentFile } = await import(`/assets/${client}`);
          const results = [];
          for (const extension of ["pdf", "docx", "xlsx", "pptx"]) {
            const bytes = await (await fetch(`/sample.${extension}`)).arrayBuffer();
            results.push(await extractDocumentFile(new File([bytes], `sample.${extension}`)));
          }
          const controller = new AbortController();
          controller.abort();
          try {
            await extractDocumentFile(new File(["%PDF-"], "x.pdf"), controller.signal);
            results.push("unexpected success");
          } catch (error) {
            results.push(error.name);
          }
          try {
            await extractDocumentFile(new File(["PrivateSensitivePayload"], "x.pdf"));
            results.push("unexpected success");
          } catch (error) {
            results.push(error.message);
          }
          return results;
        },
        { client },
      );
      for (const result of results.slice(0, 4)) {
        assert.match(result.text, /Café Ελληνικά/);
        assert.match(result.text, /=1\+1/);
      }
      assert.equal(results[4], "AbortError");
      assert.match(results[5], /supported PDF/);
      assert.doesNotMatch(results[5], /PrivateSensitivePayload/);
      // Execute the same pure paste converter against a browser's inert template,
      // asserting that remote images/scripts and hidden text never become output.
      const compiled = ts.transpileModule(readFileSync("src/lib/composer-paste.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const paste = await page.evaluate(
        ({ compiled }) => {
          const exports = {};
          new Function("exports", compiled)(exports);
          const html =
            '<h2>Heading</h2><p><strong>Bold</strong> and <em>emphasis</em></p><ul><li>Item</li></ul><img src="https://invalid.test/private"><script>window.stolen=true</script><p hidden>HiddenSecret</p><a href="javascript:alert(1)">Visible link</a>';
          const text = exports.prepareComposerPaste(
            "Heading Bold and emphasis Item Visible link",
            html,
          );
          let oversized = "";
          try {
            exports.prepareComposerPaste("x".repeat(80001), "");
          } catch (error) {
            oversized = error.message;
          }
          return { text, stolen: window.stolen, oversized };
        },
        { compiled },
      );
      assert.match(paste.text, /## Heading/);
      assert.match(paste.text, /\*\*Bold\*\*/);
      assert.match(paste.text, /- Item/);
      assert.doesNotMatch(paste.text, /HiddenSecret|invalid.test|javascript|stolen/);
      assert.equal(externalRequests, 0);
      assert.equal(paste.stolen, undefined);
      assert.match(paste.oversized, /nothing has been truncated/);
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
