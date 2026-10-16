import { z } from "zod";
// The accepted core-launch contract keeps Academy paused. Enable only with a
// separately reviewed persistence + account-export + deletion-boundary release.
export const ACADEMY_ACCOUNT_PERSISTENCE_ENABLED = false;
export const AcademyBody = z
  .object({
    notes: z.string().max(20000),
    completed: z.boolean(),
    checked: z.array(z.string().max(2000)).max(100),
  })
  .strict()
  .refine(
    (v) => new TextEncoder().encode(JSON.stringify(v)).length <= 90000,
    "Notes exceed account save limit; export or shorten them.",
  );
export const AcademyTopic = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+([/-][a-z0-9]+)*$/);
export const AcademyRecord = z.object({
  owner_id: z.string().uuid(),
  topic: AcademyTopic,
  revision: z.number().int().positive(),
  body: AcademyBody,
  updated_at: z.string(),
});
