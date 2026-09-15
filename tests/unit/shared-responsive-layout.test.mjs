import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { twMerge } from "tailwind-merge";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const publicSite = read("src/components/public/PublicSite.tsx");

for (const [file, primitive, variable] of [
  ["popover", "Popover", "popover"],
  ["dropdown-menu", "DropdownMenu", "dropdown-menu"],
  ["context-menu", "ContextMenu", "context-menu"],
]) {
  const source = read(`src/components/ui/${file}.tsx`);
  for (const part of primitive === "Popover" ? ["Content"] : ["Content", "SubContent"]) {
    test(`${primitive}${part} keeps long content reachable within its collision boundary`, () => {
      const name = `${primitive}${part}`;
      const start = source.indexOf(`const ${name} = React.forwardRef<`);
      const end = source.indexOf(`${name}.displayName`, start);
      assert.ok(start >= 0 && end > start, `${name} must remain a forwarded-ref component`);
      const body = source.slice(start, end);
      assert.ok(
        body.includes(`--radix-${variable}-content-available-height,var(--kova-overlay-vh)`),
      );
      assert.ok(body.includes(`--radix-${variable}-content-available-width,100vw`));
      assert.ok(body.includes("[--kova-overlay-vh:100vh]"));
      assert.ok(body.includes("calc(var(--kova-overlay-vh)-1rem)"));
      assert.ok(body.includes("supports-[height:100dvh]:[--kova-overlay-vh:100dvh]"));
      assert.ok(body.includes("calc(100vw-1rem)"));
      for (const token of [
        "overflow-y-auto",
        "overflow-x-hidden",
        "overscroll-contain",
        "[overflow-wrap:anywhere]",
        "collisionPadding = 8",
        "collisionPadding={collisionPadding}",
        "ref={ref}",
        "{...props}",
      ]) {
        assert.ok(body.includes(token), `${name} must retain ${token}`);
      }
      assert.doesNotMatch(body, /\boverflow-hidden\b/);
      assert.match(body, /\[overflow-wrap:anywhere\][^"]*",\s*className,/);
      const defaults = body.match(/"([^"]*\[--kova-overlay-vh:100vh\][^"]*)"/)?.[1];
      assert.ok(defaults);
      const overridden = twMerge(defaults, "max-h-20");
      assert.match(overridden, /\bmax-h-20\b/);
      assert.doesNotMatch(overridden, /\bmax-h-\[min\(/);
      if (part === "SubContent") {
        assert.ok(
          body.includes(`min-w-[min(8rem,var(--radix-${variable}-content-available-width,100vw))]`),
        );
      }
    });
  }
}

test("both public layouts wrap long content instead of relying on clipping", () => {
  const roots = [...publicSite.matchAll(/<main\s[^>]*>/g)];
  assert.equal(roots.length, 2);
  for (const [root] of roots) {
    assert.match(root, /id="main-content"/);
    assert.match(root, /tabIndex=\{-1\}/);
    assert.match(root, /min-w-0 \[overflow-wrap:anywhere\]/);
  }
});

test("nested breadcrumbs wrap and keep the current-page text readable", () => {
  const breadcrumb = publicSite.match(/<nav\s[^>]*aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(breadcrumb);
  assert.match(breadcrumb, /flex-wrap/);
  assert.match(breadcrumb, /gap-x-2 gap-y-1/);
  assert.match(breadcrumb, /aria-current="page"/);
  assert.match(breadcrumb, /currentPageSlug\.replaceAll/);
  assert.doesNotMatch(breadcrumb, /\btruncate\b|\bwhitespace-nowrap\b|\bline-clamp-/);
  assert.doesNotMatch(breadcrumb, /className="contents"/);
  assert.match(
    breadcrumb,
    /inline-flex min-w-0 items-baseline gap-2[\s\S]*aria-hidden="true">\/[\s\S]*category\.replaceAll/,
  );
  assert.match(
    breadcrumb,
    /inline-flex min-w-0 items-baseline gap-2[\s\S]*aria-hidden="true">\/[\s\S]*aria-current="page"/,
  );
  assert.match(breadcrumb, /sectionLanding\?\.to \?\? `\/\$\{item\.section\}`/);
});

test("all public action pills can wrap with padding and visible keyboard focus", () => {
  const actions = [...publicSite.matchAll(/<Link\s[^>]*className="([^"]*min-h-11[^"]*)"[^>]*>/g)];
  assert.equal(actions.length, 5);
  for (const [, classes] of actions) {
    for (const token of [
      "min-w-0",
      "max-w-full",
      "justify-center",
      "py-2.5",
      "text-center",
      "focus-visible:ring-2",
    ]) {
      assert.ok(classes.split(" ").includes(token), `Missing ${token} from action`);
    }
  }
  assert.equal((publicSite.match(/className="h-4 w-4 shrink-0"/g) ?? []).length, 3);
});

test("public cards and the closing action remain shrinkable and bounded", () => {
  assert.match(publicSite, /className="min-w-0 rounded-3xl/);
  assert.match(publicSite, /className="group min-w-0 rounded-2xl/);
  assert.match(publicSite, /focus-visible:ring-offset-foreground md:max-w-xs/);
  assert.match(publicSite, /md:flex-row md:flex-wrap md:items-center/);
  assert.match(publicSite, /className="min-w-0 md:flex-1 md:basis-64"/);
  assert.match(publicSite, /item\.closing \?\?/);
  assert.match(publicSite, /data-public-primary/);
});
