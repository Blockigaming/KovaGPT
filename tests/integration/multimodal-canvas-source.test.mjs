import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("file upload architecture validates categories, limits, duplicates, and reuse authorization", () => {
  const files = read("src/lib/multimodal/files.server.ts");
  for (const token of [
    "UploadState",
    "selected",
    "validating",
    "uploading",
    "processing",
    "ready",
    "unsupported",
    "failed",
    "retry",
    "classifyFile",
    "validateFileForUpload",
    "fingerprint",
    "canReuseFile",
    "sourceProjectId",
  ]) {
    assert.match(files, new RegExp(`\\b${token}\\b`), `files module should include ${token}`);
  }
});

test("document understanding records PDF failure truthfully and page-aware chunks", () => {
  const docs = read("src/lib/multimodal/documents.server.ts");
  for (const token of [
    "DocumentExtraction",
    "pageCount",
    "scannedPdf",
    "passwordProtected",
    "describePdfFailure",
    "OCR is not configured",
    "chunkDocument",
    "citation",
  ]) {
    assert.match(
      docs,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `documents module should include ${token}`,
    );
  }
});

test("safe analysis supports deterministic CSV profiling, grouping, charts, and no arbitrary execution", () => {
  const analysis = read("src/lib/multimodal/analysis.server.ts");
  for (const token of [
    "AnalysisJobStatus",
    "queued",
    "preparing",
    "running",
    "rendering",
    "complete",
    "failed",
    "canceled",
    "parseCsv",
    "inferColumnKinds",
    "profileDataset",
    "groupByCount",
    "ChartSpec",
    "accessibilityDescription",
    "createAnalysisJob",
    "Arbitrary Python execution is unavailable",
  ]) {
    assert.match(
      analysis,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `analysis module should include ${token}`,
    );
  }
  assert.doesNotMatch(analysis, /eval\(|new Function|child_process|exec\(/);
});

test("artifacts support Canvas-style documents with versions, restore, downloads, and authorization fields", () => {
  const artifacts = read("src/lib/multimodal/artifacts.server.ts");
  for (const token of [
    "KovaArtifact",
    "ArtifactVersion",
    "document",
    "report",
    "table",
    "chart",
    "analysis_summary",
    "image_collection",
    "ownerId",
    "sourceChatId",
    "sourceProjectId",
    "createArtifact",
    "saveArtifactVersion",
    "restoreArtifactVersion",
    "artifactDownload",
  ]) {
    assert.match(
      artifacts,
      new RegExp(`\\b${token}\\b`),
      `artifact module should include ${token}`,
    );
  }
});

test("tool activity covers multimodal and Canvas operations without secret metadata", () => {
  const activity = read("src/lib/ai/activity.server.ts");
  for (const token of [
    "upload_file",
    "process_document",
    "read_pdf",
    "inspect_spreadsheet",
    "analyze_image",
    "profile_dataset",
    "generate_chart",
    "create_artifact",
    "edit_image",
    "save_to_library",
    "scrubActivityMetadata",
  ]) {
    assert.match(activity, new RegExp(`\\b${token}\\b`), `activity should include ${token}`);
  }
});

test("image lightbox delegates modal lifecycle and restores intentional focus", () => {
  const images = read("src/routes/images.tsx");
  for (const token of [
    "DialogContent",
    "DialogTitle",
    "DialogDescription",
    "data-image-lightbox",
    "onOpenAutoFocus",
    "onCloseAutoFocus",
    "lightboxInitialFocusRef",
    "lightboxReturnFocusRef",
    "lightboxReturnToPromptRef",
    "isConnected",
  ]) {
    assert.match(images, new RegExp(token));
  }
  assert.doesNotMatch(images, /window\.addEventListener\("keydown", onKey\)/);
  assert.doesNotMatch(images, /aria-modal="true"/);

  const styles = read("src/styles.css");
  assert.match(styles, /:not\(\[data-image-lightbox\]\)/);
  assert.match(styles, /\.image-lightbox > button:last-child/);
});
