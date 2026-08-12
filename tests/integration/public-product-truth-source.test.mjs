import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL("../../" + path, import.meta.url), "utf8");

const AUDITED_PUBLIC_PATHS = new Set([
  "/",
  "/images",
  "/pricing",
  "/modes",
  "/changelog",
  "/status",
  "/blog/best-ai-assistants",
  "/blog/ai-market-research-guide",
  "/blog/best-ai-market-research-tools",
  "/privacy",
  "/terms",
  "/refund",
  "/ai-safety",
  "/contact-support",
  "/getting-started",
  "/help",
  "/ai-image-generator",
  "/study-assistant",
  "/code-helper",
  "/ai-writer",
  "/research-assistant",
  "/chatgpt-alternative",
  "/ai-humanizer",
  "/humanize-ai-text",
]);

const AUDITED_PUBLIC_ASSETS = new Set([
  "/og/code.jpg",
  "/og/home.jpg",
  "/og/images.jpg",
  "/og/writer.jpg",
]);

const ROUTE_SOURCE = new Map([
  ["/blog/best-ai-assistants", "src/routes/blog.best-ai-assistants.tsx"],
  ["/blog/ai-market-research-guide", "src/routes/blog.ai-market-research-guide.tsx"],
  ["/blog/best-ai-market-research-tools", "src/routes/blog.best-ai-market-research-tools.tsx"],
  ["/privacy", "src/routes/privacy.tsx"],
  ["/contact-support", "src/routes/contact-support.tsx"],
  ["/getting-started", "src/routes/getting-started.tsx"],
  ["/ai-image-generator", "src/routes/ai-image-generator.tsx"],
  ["/study-assistant", "src/routes/study-assistant.tsx"],
  ["/code-helper", "src/routes/code-helper.tsx"],
  ["/research-assistant", "src/routes/research-assistant.tsx"],
  ["/ai-humanizer", "src/routes/ai-humanizer.tsx"],
  ["/humanize-ai-text", "src/routes/humanize-ai-text.tsx"],
]);

test("every in-scope route is canonically branded and links to an audited public target", async () => {
  for (const [path, sourcePath] of ROUTE_SOURCE) {
    const source = await readSource(sourcePath);
    assert.match(
      source,
      new RegExp("createFileRoute\\(" + JSON.stringify(path) + "\\)", "u"),
      path,
    );
    assert.ok(
      source.includes("https://kovagpt.com" + path) ||
        (source.includes("seoLandingHead") && source.includes('path: "' + path + '"')),
      path + " must declare a KovaGPT canonical",
    );
    assert.doesNotMatch(source, /https?:\/\/[^"']*lovable/iu, path);

    const publicAssets = [
      ...source.matchAll(/(?:https:\/\/kovagpt\.com)?(\/(?:og\/[^"'\s)]+|favicon[^"'\s)]*))/gu),
    ].map((match) => match[1]);
    for (const asset of new Set(publicAssets)) {
      assert.equal(
        AUDITED_PUBLIC_ASSETS.has(asset),
        true,
        path + " references an unavailable public asset " + asset,
      );
    }

    const staticTargets = [
      ...source.matchAll(/\bto=(?:"([^"]+)"|'([^']+)')/gu),
      ...source.matchAll(/\bto:\s*(?:"([^"]+)"|'([^']+)')/gu),
    ].map((match) => match[1] ?? match[2]);
    for (const target of staticTargets) {
      if (!target.startsWith("/")) continue;
      assert.equal(
        AUDITED_PUBLIC_PATHS.has(target),
        true,
        path + " links to unknown public route " + target,
      );
    }
  }
});

test("public research copy states provider and verification limits without guarantees", async () => {
  const paths = [
    "src/routes/blog.best-ai-assistants.tsx",
    "src/routes/blog.ai-market-research-guide.tsx",
    "src/routes/blog.best-ai-market-research-tools.tsx",
  ];
  const sources = await Promise.all(paths.map(readSource));

  for (const [index, source] of sources.entries()) {
    assert.match(source, /provider/iu, paths[index]);
    assert.match(source, /verif/iu, paths[index]);
    assert.match(
      source,
      /can make mistakes|can still|does not guarantee|cannot guarantee|guarantee that a claim/iu,
      paths[index],
    );
    assert.doesNotMatch(
      source,
      /live web \+ fresh news|citations on every claim|cited on every answer|low hallucination|single default mode|source-verified market brief|Research mode free|live web search.*on by default|internal owner override/iu,
      paths[index],
    );
  }
  assert.match(sources[0], /not affiliated\s+with,\s*endorsed by, or sponsored by/iu);
  assert.doesNotMatch(sources[0], /best general-purpose default|best for long documents/iu);
});

test("privacy avoids unsupported security, retention, export, and training guarantees", async () => {
  const privacy = await readSource("src/routes/privacy.tsx");
  const privacyText = privacy.replace(/\s+/gu, " ");

  assert.match(privacyText, /some conversation history is kept on your device/iu);
  assert.match(privacyText, /Third-party providers process data under the provider terms/iu);
  assert.match(privacyText, /does not include a Kova-owned model-training workflow/iu);
  assert.match(privacyText, /Authorized operators may access account or content data/iu);
  assert.match(privacyText, /Data may remain in backups/iu);
  assert.match(
    privacyText,
    /may require identity or account verification before processing a deletion request/iu,
  );
  assert.match(privacyText, /uses HTTPS for data in transit/iu);
  assert.doesNotMatch(
    privacyText,
    /we do not read your chats|never used to train|does not intentionally use.*train|contractually prohibited|once the response is returned|encrypted .* at rest|audit-logged|short-lived security|limited time in backups|Deletion requests are authenticated/iu,
  );
});

test("capability landing pages do not promise detector evasion, legal rights, or verified output", async () => {
  const paths = [
    "src/routes/ai-image-generator.tsx",
    "src/routes/ai-humanizer.tsx",
    "src/routes/humanize-ai-text.tsx",
    "src/routes/code-helper.tsx",
    "src/routes/study-assistant.tsx",
    "src/routes/research-assistant.tsx",
  ];
  const combined = (await Promise.all(paths.map(readSource))).join("\n");

  assert.doesNotMatch(
    combined,
    /commercial-use rights|commercial-safe|usually 5 to 15|passes AI detection|beat AI detectors|passes as human|drops most detector scores|answer that compiles|publishable prose in seconds|pointers back to the relevant sections|especially good at explaining|continue tomorrow|quizzes on any topic|request supported aspect ratios and image settings|make it sound like I wrote it|reads like a real person|Rewrite AI Text to Sound Human/iu,
  );
  assert.match(combined, /does not guarantee that an output is clear of third-party rights/iu);
  assert.match(combined, /does not promise that rewritten text will receive a particular score/iu);
  assert.match(combined, /not guaranteed to compile/iu);
  assert.match(combined, /verify the result/iu);
  assert.match(combined, /does not expose output-format or transparency controls/iu);
  assert.match(combined, /same browser while that history remains available/iu);
});

test("public copy does not advertise retired modes, voice, or unlimited/free provider features", async () => {
  const combined = (await Promise.all([...ROUTE_SOURCE.values()].map(readSource))).join("\n");

  assert.doesNotMatch(
    combined,
    /Basic Mode|Auto Mode|Creative Mode|Precise Mode|Code Mode|Study Mode|Reasoning Mode|Research Mode|Writer Pro|Tutor Pro/iu,
  );
  assert.doesNotMatch(
    combined,
    /voice mode|voice chat|spoken conversation|talk (?:to|with) KovaGPT|real-time voice/iu,
  );
  assert.doesNotMatch(
    combined,
    /unlimited (?:chat|messages|images|uploads|search|research)|free (?:live )?web search|Deep Research (?:is )?free|generate images without (?:an )?account/iu,
  );
});

test("the shared public footer carries product and affiliation caveats", async () => {
  const footer = await readSource("src/components/PublicFooter.tsx");
  const footerText = footer.replace(/\s+/gu, " ");
  assert.match(footerText, /features can depend on plan eligibility and external providers/iu);
  assert.match(footerText, /independently developed/u);
  assert.match(footerText, /do not imply sponsorship, endorsement, or affiliation/u);
  assert.doesNotMatch(footerText, /Lovable/u);
});
