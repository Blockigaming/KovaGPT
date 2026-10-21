import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reactFixture, nodes, text } from "../helpers/kova-react-fixture.mjs";
import * as appearance from "../../src/lib/appearance-preferences.mjs";
import * as profile from "../../src/lib/profile-preferences.mjs";
import * as timeFormat from "../../src/lib/time-format.ts";

const original = Object.freeze({
  mode: "light",
  readingSize: 20,
  readingWidth: 900,
  density: "compact",
  motion: "reduced",
  displayName: "Current nickname",
  email: "verified@example.test",
  customInstructions: "Preserve my instructions.",
  extraFacts: "Preserve this context.",
  mood: "professional",
  responseLength: "long",
  responseTone: "formal",
  responseFormat: "markdown",
  rememberAcross: true,
  sendOnEnter: false,
  webSearch: false,
  theme: { accent: "original-palette" },
  untouchedData: { saved: true },
});

test("Reset appearance restores only its explicit five defaults and preserves responses, profile, data and palette", () => {
  const result = appearance.resetAppearance(original);
  assert.notEqual(result, original);
  for (const [key, value] of Object.entries(appearance.APPEARANCE_DEFAULTS))
    assert.equal(result[key], value);
  for (const key of Object.keys(original).filter((key) => !(key in appearance.APPEARANCE_DEFAULTS)))
    assert.equal(result[key], original[key], `${key} must remain unchanged`);
  assert.deepEqual(appearance.resetAppearance(result), result);
  assert.equal(original.mode, "light");
});

for (const width of [680, 760, 900]) {
  test(`reading width ${width} updates the single shared surface token without writing storage`, () => {
    const properties = new Map();
    const root = {
      style: { setProperty: (key, value) => properties.set(key, value) },
      dataset: {},
    };
    appearance.applyReadingPreferences(root, { ...original, readingWidth: width });
    assert.equal(properties.get("--kova-reading-width"), `${width}px`);
    assert.equal(properties.has("--chat-content-width"), false);
    assert.equal(properties.get("--kova-reading-size"), "20px");
    assert.deepEqual(root.dataset, { kovaDensity: "compact", kovaMotion: "reduced" });
  });
}

test("invalid imported appearance values fall back to bounded defaults", () => {
  assert.deepEqual(
    appearance.appearanceValues({
      mode: "other",
      readingSize: "20",
      readingWidth: -1,
      density: null,
      motion: "other",
    }),
    appearance.APPEARANCE_DEFAULTS,
  );
});

function appearanceFixture(settings = original) {
  const calls = [];
  const modes = [];
  const props = {
    settings,
    onChange: (value) => {
      calls.push(value);
      props.settings = value;
    },
  };
  const f = reactFixture(
    "src/components/AppearanceSettings.tsx",
    (exports) => () => exports.AppearanceSettings(props),
    {
      modules: {
        "@/lib/appearance-preferences.mjs": appearance,
        "@/lib/theme": { applyThemeMode: (mode) => modes.push(mode) },
        "@/styles/appearance-settings.css": {},
      },
    },
  );
  f.render();
  return { ...f, calls, modes, props };
}
const labeledSelect = (f, label) =>
  nodes(f.find("label", (node) => text(node).startsWith(label))).find(
    (node) => node.type === "select",
  );

test("live appearance preview uses selected reading size, capped width, density, button state and motion", async () => {
  const f = appearanceFixture();
  assert.match(f.text(), /Live appearance preview/);
  assert.match(f.text(), /Original palette/);
  assert.match(f.text(), /device’s reduced-motion setting always takes priority/);
  assert.equal(
    f.find("p", (n) => n.props.className === "kova-appearance-preview-prose").props.style.fontSize,
    20,
  );
  assert.equal(
    f.find("div", (n) => n.props.className === "kova-appearance-preview-reading").props.style
      .maxWidth,
    900,
  );
  assert.equal(
    f.find("div", (n) => n.props.className === "kova-appearance-preview-nav").props.style.minHeight,
    48,
  );
  for (const [label, value, key] of [
    ["Reading size", "18", "readingSize"],
    ["Reading width", "680", "readingWidth"],
    ["Density", "comfortable", "density"],
    ["Motion", "full", "motion"],
  ]) {
    labeledSelect(f, label).props.onChange({ target: { value } });
    await f.flush();
    assert.equal(
      f.props.settings[key],
      ["readingSize", "readingWidth"].includes(key) ? Number(value) : value,
    );
  }
  assert.equal(f.find("section").props["data-motion"], "full");
  assert.equal(
    f.find("div", (n) => n.props.className === "kova-appearance-preview-nav").props.style.minHeight,
    56,
  );
  await f.click("Preview button");
  assert.equal(f.find("button", (n) => text(n) === "Preview button").props["aria-pressed"], true);
  assert.match(f.text(), /Preview button selected/);
  const before = f.calls.length;
  await f.click("Preview button");
  assert.equal(f.calls.length, before, "preview interaction must never change saved preferences");
});

test("theme controls and Reset appearance invoke the real bounded callbacks", async () => {
  const f = appearanceFixture();
  f.find("input", (n) => n.props.value === "system").props.onChange();
  await f.flush();
  assert.equal(f.props.settings.mode, "system");
  assert.deepEqual(f.modes, ["system"]);
  await f.click("Reset appearance");
  assert.deepEqual(f.modes, ["system", "dark"]);
  assert.deepEqual(f.props.settings, appearance.resetAppearance(original));
  assert.match(f.text(), /Response preferences and data are unchanged/);
});

test("preferred-name validation and failed saves preserve the previous value and account", () => {
  const writes = [];
  const save = (...args) => writes.push(args);
  const base = { settings: original, ownerId: "owner-a", currentOwnerId: "owner-a", save };
  for (const value of ["x".repeat(81), "bad\u0000name"])
    assert.ok(profile.saveDevicePreferredName({ ...base, value }).error);
  for (const currentOwnerId of ["owner-b", null, undefined])
    assert.ok(
      profile.saveDevicePreferredName({ ...base, currentOwnerId, value: "New nickname" }).error,
    );
  assert.equal(writes.length, 0);
  const failed = profile.saveDevicePreferredName({
    ...base,
    value: "New nickname",
    save() {
      throw new Error("storage full");
    },
  });
  assert.match(failed.error, /previous name is unchanged/);
  assert.equal(original.displayName, "Current nickname");
  const result = profile.saveDevicePreferredName({ ...base, value: "  New nickname  " });
  assert.equal(result.settings.displayName, "New nickname");
  assert.equal(result.settings.email, original.email);
  assert.equal(writes[0][0], "owner-a");
  assert.equal(writes[0][1], result.settings);
  assert.equal(profile.saveDevicePreferredName({ ...base, value: " " }).settings.displayName, "");
});

function profileFixture(component = "ProfileSettings") {
  const writes = [],
    changes = [];
  let fail = false;
  let currentOwner = "owner-a";
  const props = {
    user: {
      id: "owner-a",
      fullName: "Verified account name",
      imageUrl: null,
      primaryEmailAddress: { emailAddress: "verified@example.test" },
    },
    principalResolved: true,
    settings: original,
    ownerId: "owner-a",
    currentOwnerId: () => currentOwner,
    onChange: (value) => {
      changes.push(value);
      props.settings = value;
    },
  };
  const f = reactFixture(
    "src/components/ProfileSettings.tsx",
    (exports) => () => exports[component](props),
    {
      sourceSuffix: "\nexport { PreferredNameForm };",
      modules: {
        "@/components/ui/avatar": {
          Avatar: "avatar",
          AvatarFallback: "avatar-fallback",
          AvatarImage: "avatar-image",
        },
        "@/lib/settings-storage": {
          saveStoredSettings: (...args) => {
            if (fail) throw new Error("storage full");
            writes.push(args);
          },
        },
        "@/lib/profile-preferences.mjs": profile,
        "@/lib/time-format": timeFormat,
      },
    },
  );
  f.render();
  return {
    ...f,
    props,
    writes,
    changes,
    fail: () => {
      fail = true;
    },
    changeOwner: () => {
      currentOwner = "owner-b";
    },
  };
}

test("Profile presents readonly identity and honest locale limits without response controls or duplicate heading", async () => {
  const f = profileFixture();
  await f.flush();
  assert.equal(
    f.find("input", (n) => n.props.value === "Verified account name").props.readOnly,
    true,
  );
  assert.equal(
    f.find("input", (n) => n.props.value === "verified@example.test").props.readOnly,
    true,
  );
  assert.equal(f.find("button", (n) => text(n) === "Change photo").props.disabled, true);
  assert.match(f.text(), /Interface language/);
  assert.match(f.text(), /Timezone detected on this device/);
  assert.match(f.text(), /Time format/);
  assert.match(f.text(), /Scheduled tasks keep their own timezone/);
  assert.match(f.text(), /daily usage resets stay at midnight UTC/);
  assert.match(f.text(), /saves automatically for this account in this browser/);
  assert.equal(f.nodes().filter((n) => /^h[1-6]$/.test(n.type) && text(n) === "Profile").length, 0);
  assert.equal(f.nodes().filter((n) => n.type === "textarea").length, 0);
});

test("preferred-name form drafts and Cancel never publish; successful Save publishes after scoped storage", async () => {
  const f = profileFixture("PreferredNameForm");
  const id = f.find("input").props.id;
  await f.input(id, "Draft only");
  assert.equal(f.changes.length, 0);
  assert.equal(f.writes.length, 0);
  await f.click("Cancel");
  assert.equal(f.find("input").props.value, original.displayName);
  await f.input(id, "Saved nickname");
  f.submit();
  await f.flush();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0][0], "owner-a");
  assert.equal(f.changes[0].displayName, "Saved nickname");
});

test("preferred-name form keeps draft and reports failure without replacing current name", async () => {
  const f = profileFixture("PreferredNameForm");
  await f.input(f.find("input").props.id, "Unsaved nickname");
  f.fail();
  f.submit();
  await f.flush();
  assert.equal(f.changes.length, 0);
  assert.equal(f.find("input").props.value, "Unsaved nickname");
  assert.equal(f.find("input").props["aria-invalid"], true);
  assert.match(text(f.find("p", (n) => n.props.role === "alert")), /previous name is unchanged/);
});

test("old preferred-name form cannot write into a switched account", async () => {
  const f = profileFixture("PreferredNameForm");
  await f.input(f.find("input").props.id, "Stale nickname");
  f.changeOwner();
  f.submit();
  await f.flush();
  assert.equal(f.writes.length, 0);
  assert.equal(f.changes.length, 0);
  assert.match(f.text(), /Your account changed/);
});

test("Responses owns custom instructions/personality, their scope and current-chat precedence", () => {
  const source = readFileSync("src/components/SettingsDialog.tsx", "utf8");
  const responses = source.slice(
    source.indexOf("{/* GENERAL */}"),
    source.indexOf("{/* PROFILE */}"),
  );
  const account = source.slice(source.indexOf("{/* PROFILE */}"), source.indexOf("{/* MEMORY */}"));
  assert.match(responses, /settings-custom-instructions/);
  assert.match(responses, /separate from project instructions/);
  assert.match(responses, /Explicit\s+instructions in your current chat take precedence/);
  assert.match(responses, /PersonalitySliders/);
  assert.doesNotMatch(account, /customInstructions|PersonalitySliders|settings\.mood/);
});

test("Settings utility and narrow headings use a page-only alignment rule; preview keeps original palette and motion override", () => {
  const route = readFileSync("src/routes/settings.$section.tsx", "utf8");
  const layout = readFileSync("src/styles/settings-page-layout.css", "utf8");
  const preview = readFileSync("src/styles/appearance-settings.css", "utf8");
  assert.match(route, /<AppShell utilitiesInHeader hideUtilities>/);
  assert.match(layout, /@container settings \(max-width: 959px\)/);
  assert.match(
    layout,
    /\.kova-settings-content-header\s*\{\s*padding-inline: 0;\s*margin-inline: 0;/,
  );
  assert.match(preview, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(preview, /width: 100%/);
  assert.doesNotMatch(preview, /#[a-f0-9]{3,8}\b|oklch\(/i);
});

test("Profile time format changes only the display preference through the existing settings callback", async () => {
  const f = profileFixture();
  await f.flush();
  let select = labeledSelect(f, "Time format");
  assert.equal(select.props.value, "system");
  assert.match(select.props.className, /min-h-11/);
  assert.equal(select.props["aria-describedby"], "profile-time-limit");
  assert.equal(select.props.disabled, false);
  assert.deepEqual(
    nodes(select)
      .filter((node) => node.type === "option")
      .map((node) => node.props.value),
    ["system", "12-hour", "24-hour"],
  );
  for (const value of ["24-hour", "12-hour", "system"]) {
    select.props.onChange({ target: { value } });
    await f.flush();
    select = labeledSelect(f, "Time format");
    assert.equal(select.props.value, value);
    assert.equal(f.props.settings.timeFormat, value);
    for (const [key, originalValue] of Object.entries(original))
      assert.equal(f.props.settings[key], originalValue, `${key} must not change`);
  }
  assert.equal(
    f.writes.length,
    0,
    "the control delegates persistence to the existing settings callback",
  );
});

test("Profile blocks stale account callbacks, unresolved auth and signed-out time-format changes", async () => {
  const f = profileFixture();
  await f.flush();
  const oldChange = labeledSelect(f, "Time format").props.onChange;
  f.props.user = { ...f.props.user, id: "owner-b" };
  await f.flush();
  oldChange({ target: { value: "24-hour" } });
  assert.equal(f.changes.length, 0);
  for (const state of ["loading", "signed-out"]) {
    f.props.principalResolved = state !== "loading";
    f.props.user = state === "signed-out" ? null : f.props.user;
    await f.flush();
    const select = labeledSelect(f, "Time format");
    assert.equal(select.props.disabled, true);
    select.props.onChange({ target: { value: "12-hour" } });
    assert.equal(f.changes.length, 0);
  }
});
