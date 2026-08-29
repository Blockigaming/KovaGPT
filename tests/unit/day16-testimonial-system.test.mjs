import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20260829163000_testimonial_collection_system.sql",
  "utf8",
);
const functions = fs.readFileSync("src/lib/testimonials.functions.ts", "utf8");
const admin = fs.readFileSync("src/routes/api/admin/testimonials.ts", "utf8");
const dialog = fs.readFileSync("src/components/TestimonialSubmissionDialog.tsx", "utf8");
const support = fs.readFileSync("src/routes/contact-support.tsx", "utf8");

test("testimonial submissions are explicit opt-in and pending by default", () => {
  assert.match(migration, /consent_to_publish boolean not null default false/);
  assert.match(migration, /status text not null default 'pending'/);
  assert.match(migration, /published boolean not null default false/);
  assert.match(functions, /consentToPublish: z\.literal\(true\)/);
  assert.match(functions, /status: "pending"/);
  assert.match(functions, /published: false/);
  assert.match(dialog, /I give KovaGPT permission to publish this testimonial/);
});

test("publication requires approval, consent and administrator review", () => {
  assert.match(migration, /testimonial_publish_requires_approval/);
  assert.match(migration, /status = 'approved'/);
  assert.match(migration, /consent_to_publish = true/);
  assert.match(migration, /reviewed_at is not null/);
  assert.match(migration, /reviewed_by is not null/);
  assert.match(admin, /requireAdministrator/);
  assert.match(admin, /publication_requires_approval/);
  assert.match(admin, /publication_requires_consent/);
});

test("customers cannot self-approve testimonials through RLS", () => {
  assert.match(migration, /auth\.uid\(\) = owner_id/);
  assert.match(migration, /status = 'pending'/);
  assert.match(migration, /published = false/);
  assert.doesNotMatch(migration, /for update\s+to authenticated/i);
});

test("support exposes a truthful testimonial collection surface", () => {
  assert.match(support, /Submit a testimonial for review/);
  assert.match(support, /never\s+published automatically/i);
  assert.match(dialog, /Submissions are reviewed before publication/);
});
