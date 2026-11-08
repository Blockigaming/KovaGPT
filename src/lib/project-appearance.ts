import { z } from "zod";

// Raster-only inline assets avoid public storage URLs and SVG/script payloads.
const image = z
  .string()
  .max(180_000)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
export const projectAppearanceSchema = z
  .object({
    emoji: z.string().trim().max(16).optional(),
    logo: image.optional(),
    background: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
    cover: image.optional(),
  })
  .strict();
export type ProjectAppearance = z.infer<typeof projectAppearanceSchema>;
export function projectAppearance(value: unknown): ProjectAppearance {
  const result = projectAppearanceSchema.safeParse(value);
  return result.success ? result.data : {};
}
