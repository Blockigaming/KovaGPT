import { z } from "zod";
export type StudyCard = {
  question: string;
  choices: string[];
  answer: number;
  hint: string;
  explanation: string;
};
export type Deck = { title: string; goal: string; cards: StudyCard[] };
export type Attempt = {
  card: number;
  answer: number | null;
  recalled: boolean | null;
  hint: boolean;
};
export type PracticeState = { version: 1; deck: Deck; attempts: Attempt[] };
export const StudyDeck: z.ZodType<Deck>;
export const StudyState: z.ZodType<PracticeState>;
export function parseStudyDeck(text: string): Deck;
export function studySummary(state: PracticeState): {
  attempts: number;
  correct: number;
  practiced: number;
  confident: number;
};
export function nextStudyCard(state: PracticeState, current?: number): number;
export function recordStudyAttempt(state: PracticeState, attempt: Attempt): PracticeState;
export function studyPrompt(input: { goal: string; depth: string; source: string }): string;
