import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Page, TestInfo } from "@playwright/test";

const evidenceDirectory = process.env.KOVA_CANDIDATE_VISUAL_EVIDENCE_DIR?.trim();

const safeSegment = (value: string) => value.replaceAll(/[^a-z0-9.-]+/giu, "-");

export async function captureCandidateVisual(page: Page, testInfo: TestInfo, evidenceName: string) {
  if (!evidenceDirectory) return;

  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({
    path: join(
      evidenceDirectory,
      `${safeSegment(evidenceName)}-${safeSegment(testInfo.project.name)}.png`,
    ),
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });
}
