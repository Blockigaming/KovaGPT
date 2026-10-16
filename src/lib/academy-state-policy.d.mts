import { z } from "zod";
export const ACADEMY_ACCOUNT_PERSISTENCE_ENABLED: false;
export type AcademyBodyValue = { notes: string; completed: boolean; checked: string[] };
export type AcademyRecordValue = {
  owner_id: string;
  topic: string;
  revision: number;
  body: AcademyBodyValue;
  updated_at: string;
};
export const AcademyBody: z.ZodType<AcademyBodyValue>;
export const AcademyTopic: z.ZodType<string>;
export const AcademyRecord: z.ZodType<AcademyRecordValue>;
