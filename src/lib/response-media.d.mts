export type MediaChapter = { seconds: number; label: string };
export function parseMediaTitle(title: unknown): {
  captions: string | null;
  chapters: MediaChapter[];
};
export function formatMediaTime(seconds: number): string;
