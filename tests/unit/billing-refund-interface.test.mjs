import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reactFixture, text } from "../helpers/kova-react-fixture.mjs";
import { formatDisplayDateTime } from "../../src/lib/time-format.ts";

const settings = readFileSync("src/components/SettingsDialog.tsx", "utf8");
const expression = settings.match(/\{(subSummary\.cancelAtPeriodEnd[\s\S]*?)\}\n\s*<\/div>/)?.[1];
assert.ok(expression, "Billing period note is present");
const evaluatePeriodNote = new Function(
  "subSummary",
  "settings",
  "formatDisplayDateTime",
  `return (${expression});`,
);
const currentPeriodEnd = "2026-11-15T12:00:00Z";
for (const timeFormat of ["system", "12-hour", "24-hour"]) {
  const periodNote = (subSummary) =>
    evaluatePeriodNote(subSummary, { timeFormat }, formatDisplayDateTime);
  const date = new Date(currentPeriodEnd).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeFormat === "system" ? {} : { hourCycle: timeFormat === "12-hour" ? "h12" : "h23" }),
  });
  for (const trialing of [false, true]) {
    test(`scheduled cancellation is acknowledged when trialing=${trialing}, timeFormat=${timeFormat}`, () => {
      const result = periodNote({ currentPeriodEnd, trialing, cancelAtPeriodEnd: true });
      assert.equal(result, `Cancels on ${date}. You keep access until then.`);
      assert.doesNotMatch(result, /billing starts|Renews/);
    });
  }
  test(`uncanceled trial and paid renewal retain their messages with timeFormat=${timeFormat}`, () => {
    assert.equal(
      periodNote({ currentPeriodEnd, trialing: true, cancelAtPeriodEnd: false }),
      `Trial ends ${date} - billing starts then unless you cancel.`,
    );
    assert.equal(
      periodNote({ currentPeriodEnd, trialing: false, cancelAtPeriodEnd: false }),
      `Renews on ${date}.`,
    );
  });
}

test("Refund uses the explicit legal article while retaining policy text and destinations", async () => {
  const f = reactFixture("src/routes/refund.tsx", (exports) => exports.Route.component, {
    modules: {
      "@tanstack/react-router": { createFileRoute: () => (config) => config, Link: "link" },
      "@/components/public/PublicShell": { PublicShell: "shell" },
      "@/components/LegalArticle": { LegalArticle: "legal-article" },
    },
  });
  await f.flush();
  f.find("legal-article");
  const normalize = (value) => value.replace(/\s+/g, " ").trim();
  const paragraphs = f
    .nodes()
    .filter((node) => node.type === "p")
    .map((node) => normalize(text(node)));
  assert.deepEqual(paragraphs, [
    "KovaGPT subscriptions help provide access to AI tools, usage limits, image generation, file uploads, and other premium features.",
    "Subscriptions can be canceled from your account settings. Canceling a subscription stops future renewals but does not automatically refund past payments.",
    "Refunds may be reviewed on a case-by-case basis. If you believe you were charged by mistake, had a billing issue, or could not access paid features after payment, contact support@kovagpt.com with your account email and a description of the issue.",
    "KovaGPT reserves the right to deny refund requests if the paid features were used, if the request appears abusive, or if the request does not meet our refund standards.",
    "Paid subscriptions are processed through a secure payment provider. KovaGPT does not directly store your full credit card number.",
    "You can cancel your KovaGPT subscription from your account settings. Canceling stops future renewals, but your current plan may remain active until the end of the billing period. If you need help canceling, contact support@kovagpt.com.",
    "← Back to KovaGPT",
  ]);
  assert.equal(f.find("h1").props.children, "Refund Policy");
  assert.deepEqual(
    f
      .nodes()
      .filter((node) => node.type === "h2")
      .map(text),
    ["Payments", "Cancel Subscription"],
  );
  for (const anchor of f.nodes().filter((node) => node.type === "a"))
    assert.equal(anchor.props.href, "mailto:support@kovagpt.com");
  assert.equal(f.find("link").props.to, "/");
});
