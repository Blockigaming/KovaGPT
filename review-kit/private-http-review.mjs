import {
  REVIEWED_MEMORY_CHAT_ID,
  REVIEWED_MEMORY_SCENARIOS,
  REVIEWED_MEMORY_DISCLOSURE,
  reviewedMemoryConversation,
  createReviewedMemoryReviewFixture,
} from "./reviewed-memory-review-fixture.mjs";
import {
  GENERATIVE_UI_REVIEW_CHAT_ID,
  GENERATIVE_UI_REVIEW_SCENARIO,
  GENERATIVE_UI_REVIEW_DISCLOSURE,
  generativeUiReviewConversation,
} from "./generative-ui-review-fixture.mjs";
import {
  createProjectArchiveReviewHandler,
  PROJECT_ARCHIVE_REVIEW_DISCLOSURE,
} from "./project-archive-review-fixture.mjs";
import {
  createProjectPopulatedArchiveReviewHandler,
  PROJECT_POPULATED_ARCHIVE_REVIEW_DISCLOSURE,
} from "./project-populated-archive-review-fixture.mjs";
import {
  createProjectMemberReviewHandler,
  PROJECT_MEMBER_REVIEW_DISCLOSURE,
} from "./project-member-review-fixture.mjs";
import { downloadDiagnosticPaths, downloadDiagnosticResponse } from "./download-diagnostic.mjs";
import {
  DOCUMENT_EXPORT_PATH,
  DOCUMENT_EXPORT_REVIEW_DISCLOSURE,
  createReviewDocumentExport,
  nativeDocumentExportRequest,
} from "./document-export-review-transport.mjs";
import {
  VERSION_CONFLICT_REVIEW_SCENARIOS,
  VERSION_CONFLICT_REVIEW_DISCLOSURE,
  VERSION_CONFLICT_CHAT_ID,
  versionConflictConversation,
  installLibraryVersionConflictSample,
  createVersionConflictReviewFixture,
} from "./version-conflict-review-fixture.mjs";
import {
  LIBRARY_PDF_RESOURCE_REVIEW_DISCLOSURE,
  installLibraryPdfResourceSamples,
  createLibraryPdfResourceReviewHandler,
} from "./library-pdf-resource-review-fixture.mjs";
/**
 * PRIVATE LOCAL REVIEW ONLY. Never imported by production or deployed.
 * Ordinary HTTP adapter for the existing packaged fixtures. No browser driver,
 * interception, browser prototype overrides, real credentials, or live writes.
 */
import {
  CONDITIONAL_REVIEW_SCENARIOS,
  CONDITIONAL_REVIEW_DISCLOSURE,
  createDeveloperConsoleReviewHandler,
  createChatHistoryRecovery,
} from "./conditional-review-fixture.mjs";
import { createServer, request as httpRequest } from "node:http";
import { readFileSync, existsSync, realpathSync, statSync, readdirSync } from "node:fs";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { IMAGE_REVIEW_DATA_URL } from "./image-review-fixture.mjs";
import {
  HISTORICAL_MISSING_REVIEW_ID,
  createHistoricalLibraryReviewHandler,
  installLibraryDocumentSamples,
  createLibraryDocumentReviewHandler,
  LIBRARY_DOCUMENT_REVIEW_DISCLOSURE,
} from "./library-document-review-fixture.mjs";
import {
  ASYNC_READ_REVIEW_SCENARIOS,
  ASYNC_READ_REVIEW_DISCLOSURE,
  USAGE_LARGE_COUNTS_REVIEW_DISCLOSURE,
  createAsyncReadReviewHandler,
} from "./async-read-review-fixture.mjs";
import {
  WORK_HISTORY_REVIEW_SCENARIOS,
  WORK_HISTORY_REVIEW_DISCLOSURE,
  createWorkHistoryReviewHandler,
} from "./work-history-review-fixture.mjs";
import {
  SUPPORT_REVIEW_SCENARIOS,
  SUPPORT_REVIEW_DISCLOSURE,
  createSupportReviewHandler,
} from "./support-review-fixture.mjs";
import {
  DIRECTORY_PLUGIN_REVIEW_SCENARIOS,
  DIRECTORY_PLUGIN_REVIEW_DISCLOSURE,
  createDirectoryPluginReviewHandler,
} from "./directory-plugin-review-fixture.mjs";
import {
  createReviewChatStream,
  createReviewChatResponse,
  createReviewChatAction,
  reviewChatActionConfirmations,
  REVIEW_CHAT_IMAGE_SAMPLES,
  REVIEW_CHAT_IMAGE_DISCLOSURE,
  REVIEW_CHAT_ACTION_DISCLOSURE,
  REVIEW_CHAT_WRITING_DISCLOSURE,
  REVIEW_CHAT_RESPONSE_SCENARIOS,
  REVIEW_CHAT_RESPONSE_DISCLOSURE,
  validReviewChatBody,
  reviewChatOpeningEvent,
  reviewChatCompletionEvent,
  REVIEW_CHAT_STREAM_MAX_BYTES,
} from "./chat-stream-review-fixture.mjs";
import {
  createProjectMoveReviewHandler,
  PROJECT_MOVE_REVIEW_DISCLOSURE,
} from "./project-move-review-fixture.mjs";
import {
  MANAGEMENT_REVIEW_SCENARIOS,
  MANAGEMENT_REVIEW_DISCLOSURE,
  WRITING_REVIEW_DIFF_DISCLOSURE,
  createManagementReviewHandler,
  createWritingDiffReviewHandler,
} from "./management-review-fixture.mjs";
import {
  createPinnedContextReviewHandler,
  PINNED_CONTEXT_REVIEW_DISCLOSURE,
} from "./pinned-context-review-fixture.mjs";

// Explicit synthetic proposal only; no provider IDs or billable operations.
export function reviewVoiceCapabilities(account, scenario) {
  const voices =
    scenario === "voice-catalog" && account !== "guest"
      ? [
          { id: "sample-clear", label: "Sample · Clear", available: true },
          {
            id: "sample-warm",
            label: "Sample · Warm",
            available: account === "plus" || account === "pro",
          },
          { id: "sample-calm", label: "Sample · Calm", available: account === "pro" },
        ]
      : [];
  return {
    configured: false,
    stt: false,
    tts: false,
    sts: false,
    voices,
    defaultVoiceId: voices[0]?.id ?? null,
  };
}

export const FIXTURE_ORIGIN = "http://127.0.0.1:4189";
export const BACKEND_ORIGIN = "https://mfbycmbjygcfkrsuepxf.supabase.co";
const BACKEND_PUBLIC_KEY = "sb_publishable_3_JjqZc2hdxn2Q0xAWwMOw_EaZsryWw";
export const BACKEND_PREFIX = "/__private-review/backend";
export const REVIEW_OWNER = "22222222-2222-4222-8222-222222222222";
export const REVIEW_OUTPUT_CHAT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const REVIEW_LONG_CHAT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const REVIEW_LONG_PROMPT_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddde";
export const REVIEW_PROSE_NUMBERING_CHAT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11";
export const REVIEW_PROSE_NUMBERING_PARAGRAPH = [
  "This fictional reading room exists only as a static interface sample, with no real visitors, bookings, accounts or recorded events.",
  "Imagine a quiet table holding three paper cards: one describes a small question, another lists assumptions, and the last leaves space for a brief observation.",
  "The reader can compare these invented cards without making a decision for anyone or treating the exercise as evidence that work has been completed.",
  "A clear heading marks the start of this single paragraph, and the following heading marks its end, so the ordinary text-copy control has one exact source section to select.",
  "The wording deliberately stays together rather than splitting into several shorter paragraphs, allowing narrow and wide layouts to show wrapping, reading rhythm and the location of the copy action.",
  "Every sentence belongs to the same synthetic passage; no hidden answer, external citation, tool result or provider response is implied by the amount of text shown here.",
  "During the review, a person may copy the passage locally and compare its punctuation, spaces and line breaks with the known fixture payload, while the original sample remains unchanged.",
  "The numbered outline below is a separate visual example that demonstrates parent steps and nested ordered children without scheduling, sending, saving or executing any of those fictional steps.",
].join(" ");
// The production section copier includes its heading and the one paragraph,
// stopping before the next heading. This exact string is the expected payload.
export const REVIEW_PROSE_NUMBERING_COPY =
  "## One continuous sample passage\n\n" + REVIEW_PROSE_NUMBERING_PARAGRAPH;
export const REVIEW_PROSE_NUMBERING_FILENAME = "synthetic-review-notes.txt";
export const REVIEW_PROSE_NUMBERING_FILE_TEXT =
  "Fictional reading-room notes\nThis is inert local sample text. No instructions are executed.";
export const REVIEW_PROSE_NUMBERING_MARKDOWN = `# Synthetic prose and numbering review

${REVIEW_PROSE_NUMBERING_COPY}

## Nested ordered outline

1. Inspect the fictional paper cards.
   1. Read the sample question.
   2. Compare its stated assumptions.
      1. Keep the original wording visible.
      2. Note one invented alternative.
2. Review the nested numbering.
   1. Confirm each child belongs to its parent.
   2. Return to the next outer step.
3. Finish the local reading exercise.

## Inert named text file

\`\`\`text filename=${REVIEW_PROSE_NUMBERING_FILENAME}
${REVIEW_PROSE_NUMBERING_FILE_TEXT}
\`\`\`

### Sample boundary

This is fixed, fictional display text. No provider was contacted and no account record was created or changed.`;
export const REVIEW_PROSE_NUMBERING_DISCLOSURE =
  "chat-prose-numbering-review opens a separate read-only synthetic response with one paragraph over 800 characters, headings and three-level ordered numbering. Copy text includes the section heading and exact paragraph; the following outline is separate. A separate inert text fence uses the supported filename metadata synthetic-review-notes.txt; nothing executes or downloads automatically. Application API and server-function non-GET requests are blocked in this scenario, including chat/history writes, generation and saves. Existing synthetic sign-in/refresh/sign-out controls are unchanged. No provider or real account data is connected.";
export const REVIEW_LOADING_HOLD_MS = 20_000;
export const REVIEW_PROVIDER_RETURN_HOLD_MS = 5_000;
export const REVIEW_LOADING_MAX_PENDING = 64;

/** Bounded, explicitly synthetic loading inspection; never resumes a backend read.
 * A reset, sign-out, request abort, or adapter shutdown cancels every owned timer.
 * Clock injection is for deterministic in-process tests, not a controller option.
 */
export function createReviewReadHold(clock = { setTimeout, clearTimeout }) {
  return createTimedReviewReadHold(clock, REVIEW_LOADING_HOLD_MS);
}
export function createProviderReturnReadHold(clock = { setTimeout, clearTimeout }) {
  return createTimedReviewReadHold(clock, REVIEW_PROVIDER_RETURN_HOLD_MS);
}
function createTimedReviewReadHold(clock, holdMs) {
  const pending = new Set();
  let disposed = false;
  return {
    get pendingCount() {
      return pending.size;
    },
    wait(signal) {
      if (disposed) return Promise.resolve("reset");
      if (signal?.aborted) return Promise.resolve("aborted");
      if (pending.size >= REVIEW_LOADING_MAX_PENDING) return Promise.resolve("capacity");
      return new Promise((resolveWait) => {
        let timer;
        const finish = (reason) => {
          if (!pending.delete(finish)) return;
          clock.clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          resolveWait(reason);
        };
        const abort = () => finish("aborted");
        pending.add(finish);
        signal?.addEventListener("abort", abort, { once: true });
        timer = clock.setTimeout(() => finish("expired"), holdMs);
        timer?.unref?.();
      });
    },
    dispose() {
      disposed = true;
      for (const finish of [...pending]) finish("reset");
    },
  };
}

export const REVIEW_ACCOUNT_HOLD_MS = 120_000;
export const REVIEW_ACCOUNT_SCENARIOS = Object.freeze(["account-loading", "account-plan-loading"]);
export const REVIEW_SPACING_PATH = "/__private-review/accessibility-text-spacing.css";
export const REVIEW_SPACING_CSS =
  "/* Explicit private accessibility inspection only. */\n* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }\np { margin-bottom: 2em !important; }\n";
export const REVIEW_FONT_PATHS = Object.freeze([
  "/fonts/IBMPlexSans-Regular.woff2",
  "/fonts/IBMPlexSans-Medium.woff2",
  "/fonts/IBMPlexSans-SemiBold.woff2",
  "/fonts/IBMPlexMono-Regular.woff2",
  "/fonts/IBMPlexMono-Medium.woff2",
  "/fonts/IBMPlexMono-SemiBold.woff2",
  "/fonts/dm-sans-variable.woff2",
]);
export const REVIEW_FONT_FAILURE_PREFIX = "/__private-review/font-load-failure";
export const REVIEW_FONT_FAILURE_DISCLOSURE =
  "font-load-failure uses seven session-unique local font URLs and three private font-family aliases, so previously cached product fonts cannot satisfy these font loads. Only the chosen typography requests return synthetic HTTP 503; the product's fallback stacks, weights and styles are preserved. No browser cache, operating-system font, production file or external service is changed. Reset to default removes the private stylesheet and invalidates its URLs. Readable text alone is not evidence of a failed request or of every rendered surface.";

// Copy only the product's named-font declarations, retaining selector specificity,
// fallback order and importance. Contract tests compare these with their sources.
// The utility layer keeps its original priority below unlayered product rules.
export const REVIEW_FONT_FALLBACK_RULES = Object.freeze([
  {
    source: "src/styles/spec400-system.css",
    selector: ":root:root",
    declarations: {
      "--font-sans": '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
      "--font-mono": '"IBM Plex Mono", ui-monospace, monospace',
    },
  },
  {
    source: "src/styles/assistant.css",
    selector: ".kova-assistant, .kova-auth-page, .kova-auth-surface",
    declarations: {
      "--font-sans": 'var(--chat-body-font, "IBM Plex Sans", Arial, sans-serif)',
      "--font-display": '"Kova DM Sans", Arial, sans-serif',
    },
  },
  {
    source: "src/styles/core-system.css",
    selector: ".kova-app-shell",
    declarations: {
      "font-family": '"Kova DM Sans", ui-sans-serif, system-ui, -apple-system, sans-serif',
    },
  },
  {
    source: "src/styles/spec400-system.css",
    selector:
      "body :is(.kova-assistant, .kova-app-shell, .kova-sidebar, .kova-sidebar-rail, .kova-composer)",
    declarations: {
      "--font-sans": '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
      "--chat-body-font": '"IBM Plex Sans"',
    },
  },
  {
    source: "src/styles/spec400-system.css",
    selector: "body .kova-page, body .kova-page :is(button, input, select, textarea)",
    declarations: {
      "--font-sans": '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    },
  },
  {
    source: "src/styles/spec400-system.css",
    selector: "body .kova-page textarea.font-mono, body .kova-assistant textarea.font-mono",
    declarations: { "font-family": '"IBM Plex Mono", ui-monospace, monospace !important' },
  },
  {
    source: "src/components/public/spec400-public.css",
    selector: "[data-public-shell]",
    declarations: { "font-family": '"IBM Plex Sans", var(--font-sans), sans-serif' },
  },
  ...["sans", "display"].map((kind) => ({
    source: "src/styles.css",
    selector: `.font-${kind}`,
    themeProperty: `--font-${kind}`,
    layer: "utilities",
    declarations: {
      "font-family":
        '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    },
  })),
]);

/** No local() source or cached product family can satisfy these private faces.
 * A fresh disposable session creates a new bounded set of seven URLs. */
export function createReviewFontFailure(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid private font review session.");
  const prefix = `${REVIEW_FONT_FAILURE_PREFIX}/${id}`;
  const families = Object.fromEntries(
    ["IBM Plex Sans", "IBM Plex Mono", "Kova DM Sans"].map((name) => [
      name,
      `Private missing ${name} ${id}`,
    ]),
  );
  const fontPaths = REVIEW_FONT_PATHS.map((path) => `${prefix}/${path.split("/").at(-1)}`);
  const faces = REVIEW_FONT_PATHS.map((path, index) => {
    const family = path.includes("IBMPlexSans")
      ? "IBM Plex Sans"
      : path.includes("IBMPlexMono")
        ? "IBM Plex Mono"
        : "Kova DM Sans";
    const weight = path.includes("-variable")
      ? "100 1000"
      : path.includes("-SemiBold")
        ? "600"
        : path.includes("-Medium")
          ? "500"
          : "400";
    return `@font-face { font-family: "${families[family]}"; src: url("${fontPaths[index]}") format("woff2"); font-weight: ${weight}; font-style: normal; font-display: swap; }`;
  });
  const rules = REVIEW_FONT_FALLBACK_RULES.map(({ selector, declarations, layer }) => {
    const body = Object.entries(declarations)
      .map(([property, value]) => {
        for (const [family, alias] of Object.entries(families))
          value = value.replaceAll(`"${family}"`, `"${alias}"`);
        return `${property}: ${value};`;
      })
      .join(" ");
    const rule = `${selector} { ${body} }`;
    return layer ? `@layer ${layer} { ${rule} }` : rule;
  });
  return {
    stylesheetPath: `${prefix}/fonts.css`,
    fontPaths,
    families,
    requested: new Set(),
    css: "/* Explicit private failed-font inspection only. */\n" + [...faces, ...rules].join("\n"),
  };
}

/** One manually released, bounded gate per disposable account scenario.
 * It resolves only local fixture responses, never a queued real operation.
 */
export function createReviewCompletionHold(clock = { setTimeout, clearTimeout }) {
  const pending = new Set();
  let state = "holding",
    timer;
  const clearTimer = () => {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  };
  const settle = (next) => {
    state = next;
    clearTimer();
    for (const finish of [...pending]) finish(next);
  };
  return {
    get state() {
      return state;
    },
    get pendingCount() {
      return pending.size;
    },
    wait(signal) {
      if (signal?.aborted) return Promise.resolve("aborted");
      if (state !== "holding") return Promise.resolve(state);
      if (pending.size >= REVIEW_LOADING_MAX_PENDING) return Promise.resolve("capacity");
      return new Promise((resolveWait) => {
        const finish = (reason) => {
          if (!pending.delete(finish)) return;
          signal?.removeEventListener("abort", abort);
          if (!pending.size) clearTimer();
          resolveWait(reason);
        };
        const abort = () => finish("aborted");
        pending.add(finish);
        signal?.addEventListener("abort", abort, { once: true });
        if (timer === undefined) {
          timer = clock.setTimeout(() => settle("expired"), REVIEW_ACCOUNT_HOLD_MS);
          timer?.unref?.();
        }
      });
    },
    release() {
      if (state === "holding") settle("released");
      return state === "released";
    },
    dispose() {
      settle("disposed");
    },
  };
}

/** Own only request-lifetime listeners; ordinary navigation/abort cancels a hold. */
export async function withReviewRequestSignal(request, response, run) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once("aborted", abort);
  response.once("close", abort);
  response.once("error", abort);
  if (request.aborted || response.destroyed) abort();
  try {
    return await run(controller.signal);
  } finally {
    request.removeListener("aborted", abort);
    response.removeListener("close", abort);
    response.removeListener("error", abort);
  }
}

export const REVIEW_LONG_CODE = [
  "// Synthetic display sample only. This code has not been executed.",
  "const sections = [",
  '  { name: "Arrival", checkpoint: "Sample checkpoint A", durationMinutes: 15 },',
  '  { name: "Workshop", checkpoint: "Sample checkpoint B", durationMinutes: 45 },',
  '  { name: "Wrap-up", checkpoint: "Sample checkpoint C", durationMinutes: 10 },',
  "];",
  "",
  "function describeSection(section, index) {",
  "  return {",
  "    sequence: index + 1,",
  "    title: section.name,",
  "    note: `${section.checkpoint}: allow ${section.durationMinutes} minutes.`,",
  "    sampleOnly: true,",
  "  };",
  "}",
  "",
  "const outline = sections.map(describeSection);",
  "const totalMinutes = sections.reduce(",
  "  (total, section) => total + section.durationMinutes,",
  "  0,",
  ");",
  "// Review the outline locally before adapting it to another fictional example.",
].join("\n");
export const REVIEW_WIDE_TABLE_HEADERS = Object.freeze([
  "WorkshopSection",
  "PreparationCheckpoint",
  "ArrivalInstructions",
  "MaterialsInventory",
  "FacilitatorResponsibility",
  "ParticipantActivity",
  "AccessibilityConsideration",
  "ReviewEvidence",
  "FallbackArrangement",
  "EstimatedDuration",
  "CompletionCheckpoint",
  "FollowUpInstructions",
]);
export const REVIEW_WIDE_TABLE = [
  `| ${REVIEW_WIDE_TABLE_HEADERS.join(" | ")} |`,
  `| ${REVIEW_WIDE_TABLE_HEADERS.map(() => "---").join(" | ")} |`,
  ...["Arrival", "Workshop", "Wrap-up"].map(
    (section, index) =>
      `| ${[
        section,
        `Sample preparation ${index + 1}`,
        "Use the fictional north entrance",
        "Paper, pencils, reusable cards",
        "Sample facilitator",
        "Compare two sample ideas",
        "Offer a quiet seat and a written outline",
        "Synthetic checklist only",
        "Use a paper outline",
        `${15 + index * 10} minutes`,
        "Review the example together",
        "Keep this fictional plan available for the next review",
      ].join(" | ")} |`,
  ),
].join("\n");
export function reviewLongPrompt() {
  return {
    id: REVIEW_LONG_PROMPT_ID,
    name: "Sample · Long reusable workshop prompt",
    category: "Synthetic review",
    folder: "Sample prompts",
    body: [
      "SYNTHETIC INTERFACE SAMPLE. This reusable prompt contains fictional material only. No provider has run it and no event has been arranged.",
      "Prepare a workshop outline for {{audience}} about {{topic}}. Treat every detail below as a fictional planning exercise. Keep the output easy to scan and state what still needs a human decision.",
      ...Array.from(
        { length: 15 },
        (_, index) =>
          `Section ${index + 1}: Describe one small, concrete activity and explain its purpose in everyday language. Include preparation, a short example, an accessible alternative, materials, a reasonable stopping point, and a review question. Use invented labels instead of personal information. Keep assumptions visible, avoid invented research or claims of completed work, and leave room for the reader to adapt the plan. Compare a simple option with a more detailed option without choosing on anyone's behalf.`,
      ),
      "Finish with a clearly labeled sample checklist. Include a multiline code example as display text and a wide comparison table with twelve meaningful columns. Do not claim that any code was run, file was uploaded, task was scheduled, person was contacted, or external source was consulted.",
    ].join("\n\n"),
    variables: ["audience", "topic"],
    project_id: null,
    context_pack_id: null,
    favorite: false,
    use_count: 0,
    last_used_at: null,
    created_at: "2026-10-17T12:00:00Z",
    updated_at: "2026-10-17T12:00:00Z",
  };
}
// Existing Release notes item from core-app-fixture.ts, not a fabricated upload.
export const REVIEW_OUTPUT_LIBRARY_ID = "44444444-4444-4444-8444-444444444444";
export const PATHS = Object.freeze([
  "/assistants",
  "/__private-review/core-preview",
  "/",
  "/overview",
  "/solutions/industries/government",
  "/build",
  "/news",
  "/product-updates",
  "/academy",
  "/bot",
  "/legal",
  "/ai-writer",
  "/ar/home",
  "/review",
  "/review/legal-baa",
  "/review/team-retention",
  "/review/team-invitations",
  "/review/media-photo-edit",
  "/review/voice",
  "/review/assistant-teach",
  "/review/assistant-notifications",
  "/review/api-imagine",
  "/review/privacy-request",
  "/__private-review/voice-preview",
  "/__private-review/account-deletion-preview",
  "/__private-review/sources-preview",
  "/library",
  "/images",
  "/projects",
  "/projects/33333333-3333-4333-8333-333333333333",
  "/scheduled-tasks",
  "/apps",
  "/apps?google_connected=1",
  "/work",
  "/discovery",
  "/translation",
  "/translate",
  "/translate/english-to-french",
  "/help",
  "/pricing",
  "/auth",
  "/reset-password",
  "/checkout/return",
  "/terms",
  "/privacy",
  "/refund",
  "/memory",
  "/notifications",
  "/trusted-contacts",
  "/files",
  "/write",
  "/share-inbox",
  "/kovas",
  "/admin/kovas",
  "/developers/connections",
  "/developers/console",
  "/developers/authorize",
  "/prompt-studio",
  "/context-packs",
  "/knowledge-graph",
  "/contact-support",
  "/getting-started",
  "/status",
  "/settings/profile",
  "/settings/appearance",
  "/settings/responses",
  "/settings/notifications",
  "/settings/connections",
  "/settings/privacy",
  "/audit-log",
  "/synthetic-missing-review-page",
  "/settings/usage",
  "/settings/billing",
]);
export const SIZES = Object.freeze({
  desktop: { width: 1440, height: 900 },
  nativeDesktop: { width: 1180, height: 768 },
  tablet: { width: 820, height: 1180 },
  phone: { width: 390, height: 844 },
  small: { width: 320, height: 700 },
  compact: { width: 375, height: 700 },
  largephone: { width: 430, height: 800 },
  belowTablet: { width: 767, height: 768 },
  tabletBoundary: { width: 768, height: 768 },
  narrowtablet: { width: 768, height: 1024 },
  aboveTablet: { width: 769, height: 768 },
  belowDesktop: { width: 1023, height: 768 },
  laptop: { width: 1024, height: 768 },
  aboveDesktop: { width: 1025, height: 768 },
  mediumDesktop: { width: 1280, height: 768 },
  wide: { width: 1920, height: 1080 },
  landscape: { width: 844, height: 390 },
});
const cookieName = "kova-private-review";
const csrfCookieName = "kova-private-review-form";
const maxBodyBytes = 11 * 1024 * 1024;
const htmlEscape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const scriptJSON = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const json = (value, status = 200) => ({ status, json: value });
const unavailable = () => json({ error: "Private review: this service is disconnected." }, 503);

export function rewriteReviewText(text, origin) {
  // Exact known build constants only. No generalized URL proxy or URL parameter.
  return text
    .replaceAll(BACKEND_ORIGIN, origin + BACKEND_PREFIX)
    .replaceAll(BACKEND_PUBLIC_KEY, "private-review-public-placeholder")
    .replaceAll(FIXTURE_ORIGIN, origin);
}

export function globMatches(pattern, url) {
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(url);
  }
  const source = String(pattern)
    .split(/(\*\*|\*)/)
    .map((part) =>
      part === "**" ? ".*" : part === "*" ? "[^/]*" : part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${source}$`).test(url);
}

/** Register handlers through the fixture's narrow interface, without a browser.
 * Browser-only initialization and locator callbacks are deliberately not run.
 * The visible review form initializes ordinary localStorage once on reset.
 */
export class FixtureRegistry {
  pageRoutes = [];
  contextRoutes = [];
  unsupportedPaths = new Set();
  diagnostic = null;
  context() {
    return {
      route: async (pattern, handler) => {
        this.contextRoutes.push({ pattern, handler });
      },
      routeWebSocket: async () => {}, // The HTTP server rejects every Upgrade.
    };
  }
  async route(pattern, handler) {
    this.pageRoutes.push({ pattern, handler });
  }
  async addInitScript() {}
  locator() {
    return { filter: () => ({}) };
  }
  async addLocatorHandler() {}
  async removeLocatorHandler() {}
  async dispatch({ url, method = "GET", headers = {}, body = Buffer.alloc(0), signal }) {
    const request = {
      url: () => url,
      signal: () => signal,
      method: () => method,
      headers: () => headers,
      postData: () => (body.length ? body.toString("utf8") : null),
      postDataBuffer: () => (body.length ? body : null),
      postDataJSON: () => (body.length ? JSON.parse(body.toString("utf8")) : null),
    };
    const handlers = [...this.pageRoutes]
      .reverse()
      .concat([...this.contextRoutes].reverse())
      .filter(({ pattern }) => globMatches(pattern, url));
    const run = async (index) => {
      if (index >= handlers.length) return unavailable();
      let result;
      await handlers[index].handler({
        request: () => request,
        fulfill: async (response) => {
          result = response;
        },
        fallback: async () => {
          result = await run(index + 1);
        },
        continue: async () => {
          result = unavailable();
        }, // Never forward fixture misses.
        abort: async () => {
          result = unavailable();
        },
      });
      return result ?? unavailable();
    };
    const output = await run(0);
    if (output.status === 503 && /not connected|disconnected/.test(output.json?.error ?? "")) {
      const path = new URL(url).pathname,
        key = `${method} ${path}`;
      if (this.unsupportedPaths.size < 50 && !this.unsupportedPaths.has(key)) {
        this.unsupportedPaths.add(key);
        this.diagnostic?.({ method, path });
      }
    }
    return output;
  }
}

export async function loadReviewPackage(packageRoot) {
  const root = realpathSync(packageRoot);
  const source = JSON.parse(readFileSync(resolve(root, "SOURCE.json"), "utf8"));
  if (!/^[a-f0-9]{40}$/.test(source.commit) || !/^[a-f0-9]{40}$/.test(source.buildCommit))
    throw new Error(
      "The private adapter requires a review package with full source/build identities.",
    );
  // Existing bundled fixtures read their function manifest relative to cwd.
  process.chdir(root);
  const load = (path) => import(pathToFileURL(resolve(root, path)).href);
  const [base, crud, state, image] = await Promise.all([
    load("review/base-fixture.mjs"),
    load("review/crud-fixture.mjs"),
    load("review-state-fixtures.mjs"),
    load("image-review-fixture.mjs"),
  ]);
  return { root, source, base, crud, state, image };
}

/** Disposable account-export progression. Every export request stays local. */
export function createAccountExportFixture(scenario, isActive, now = () => Date.now()) {
  const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const version = "a".repeat(64);
  const base = (status, requestedAt = new Date(now()).toISOString()) => ({
    id,
    status,
    requestedAt,
    completedAt: null,
    expiresAt: null,
    sizeBytes: null,
    failureCode: null,
    downloadable: false,
    cleanupPending: false,
  });
  let job =
    scenario === "account-export-failed"
      ? {
          ...base("failed", new Date(now() - 13 * 60 * 60 * 1000).toISOString()),
          failureCode: "export_failed",
        }
      : null;
  let polls = 0;
  return async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/private-files" && url.searchParams.get("kind") !== "export")
      return route.fallback();
    if (!isActive()) return route.fulfill(json({ error: "unauthorized" }, 401));
    const enabled = scenario.startsWith("account-export-");
    if (url.pathname === "/api/private-files") {
      if (
        !enabled ||
        request.method() !== "GET" ||
        !job?.downloadable ||
        url.searchParams.get("id") !== id ||
        url.searchParams.get("owner") !== REVIEW_OWNER ||
        url.searchParams.get("version") !== version
      )
        return route.fulfill(json({ error: "export_unavailable" }, 404));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "Content-Disposition": 'attachment; filename="kova-synthetic-export.json"',
        },
        body: JSON.stringify({ sampleOnly: true, liveAccountData: false, conversations: [] }),
      });
    }
    if (request.method() === "POST") {
      if (!enabled)
        return route.fulfill(json({ error: "Select an account-export review scenario." }, 503));
      if (scenario === "account-export-uncertain")
        return route.fulfill(json({ error: "account_export_request_failed" }, 503));
      if (!job || !["queued", "processing"].includes(job.status)) {
        job = base("queued");
        polls = 0;
      }
      return route.fulfill({ ...json({ job }, 202), headers: { "Retry-After": "5" } });
    }
    if (request.method() === "DELETE") {
      if (!enabled || !job || request.postDataJSON()?.id !== id)
        return route.fulfill(json({ error: "not_found" }, 404));
      if (job.status === "processing")
        return route.fulfill(
          json({ error: "account_export_processing", job, retryRequired: true }, 409),
        );
      job = { ...job, status: "canceled", downloadable: false };
      return route.fulfill(json({ job }));
    }
    if (request.method() !== "GET")
      return route.fulfill(json({ error: "method_not_allowed" }, 405));
    if (url.searchParams.get("download") === "1") {
      if (!job?.downloadable)
        return route.fulfill(json({ error: "download_unavailable", job }, 409));
      return route.fulfill(
        json({
          job,
          downloadUrl: `/api/private-files?kind=export&id=${id}&owner=${REVIEW_OWNER}&version=${version}`,
          downloadExpiresInSeconds: 0,
          requiresSession: true,
        }),
      );
    }
    if (job && ["queued", "processing"].includes(job.status)) {
      polls += 1;
      job =
        polls < 2
          ? { ...job, status: "processing" }
          : {
              ...job,
              status: "complete",
              completedAt: new Date(now()).toISOString(),
              expiresAt: new Date(now() + 86400000).toISOString(),
              sizeBytes: 4096,
              downloadable: true,
            };
    }
    return route.fulfill(json({ job }));
  };
}

export function syntheticSession(account, now = Date.now()) {
  if (account === "guest") return null;
  const issued = Math.floor(now / 1000),
    expires = issued + 24 * 60 * 60;
  const user = {
    id: REVIEW_OWNER,
    aud: "authenticated",
    role: "authenticated",
    email: "private-review@example.invalid",
    email_confirmed_at: "2026-01-01T00:00:00Z",
    confirmed_at: "2026-01-01T00:00:00Z",
    last_sign_in_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: "Private Review" },
    identities: [],
    factors: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    is_anonymous: false,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    access_token: `${encode({ alg: "none", typ: "JWT" })}.${encode({
      iss: "private-local-review",
      aud: "authenticated",
      role: "authenticated",
      sub: REVIEW_OWNER,
      email: user.email,
      aal: "aal1",
      amr: [{ method: "password", timestamp: issued }],
      iat: issued,
      exp: expires,
    })}.cHJpdmF0ZS1yZXZpZXctb25seQ`,
    refresh_token: "private-local-review-not-a-real-credential",
    expires_in: expires - issued,
    expires_at: expires,
    token_type: "bearer",
    user,
  };
}

// Self-contained because this file is copied directly into the private review package.
// Matches product Trash fixture semantics without importing any application module.
export function reviewTrashFixtures(now = Date.now()) {
  const day = 86_400_000;
  const retentionMs = 30 * day;
  const chat = (id, title) => ({
    id,
    title,
    mode: "instant",
    createdAt: 1792238400000,
    updatedAt: 1792238400000,
    messages: [
      {
        id: `${id}-message`,
        role: "user",
        content: "Synthetic local Trash review only. No provider request or real conversation.",
      },
    ],
  });
  const entry = (id, title, deletedAt) => ({
    conversation: chat(id, title),
    deletedAt,
    expiresAt: deletedAt + retentionMs,
  });
  return {
    retentionMs,
    deleted: entry("review-trash-recent", "Sample · Weekend project ideas", now - day),
    expiringSoon: entry(
      "review-trash-soon",
      "Sample · Trip packing checklist",
      now - retentionMs + 3_600_000,
    ),
    expired: entry("review-trash-expired", "Sample · Expired local chat", now - 31 * day),
    restored: {
      ...entry("review-trash-restored", "Sample · Restored research notes", now - 2 * day),
      restoredAt: now - day,
    },
  };
}
export const TRASH_REVIEW_DISCLOSURE =
  "The chat-trash scenario uses synthetic browser-local Trash records and a disposable in-memory restore adapter. The expired sample is swept on opening Trash; the restored sample is already in History. Restore accepts only the two known unexpired sample IDs with their exact original content. No real chat, provider, server retention scheduler, cloud purge or cross-device synchronization is connected.";

// The existing review conversation payload, with deterministic sample timestamps
// so local legacy seeds and the local history read model agree byte-for-byte.
export function reviewConversations(scenario = "default", state = "populated") {
  // Explicit chat scenarios retain their own content. Empty directory review
  // removes both the browser seed and the matching HTTP history read model.
  if (state === "empty" && !scenario.startsWith("chat-") && scenario !== "result-version-conflict")
    return [];
  const conversations = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ].map((id, index) => ({
    id,
    title: index ? "Second review chat" : "Composer review chat",
    mode: "instant",
    createdAt: 1792238400000,
    updatedAt: 1792238400000,
    messages: index
      ? []
      : [
          { id: "prompt-a", role: "user", content: "Draft a release checklist." },
          {
            id: "answer-a",
            role: "assistant",
            content:
              "A practical release checklist:\n\n1. Review the draft.\n2. Verify the interaction.\n3. Record the result.",
          },
        ],
  }));
  if (REVIEWED_MEMORY_SCENARIOS.includes(scenario))
    conversations.push(reviewedMemoryConversation());
  if (scenario === GENERATIVE_UI_REVIEW_SCENARIO)
    conversations.push(generativeUiReviewConversation());
  if (scenario === "result-version-conflict") conversations.push(versionConflictConversation());
  if (scenario === "chat-prose-numbering-review")
    conversations.push({
      id: REVIEW_PROSE_NUMBERING_CHAT_ID,
      title: "Sample · Read-only prose and nested numbering",
      mode: "instant",
      createdAt: 1792238400000,
      updatedAt: 1792238400000,
      messages: [
        {
          id: "prose-numbering-prompt",
          role: "user",
          content:
            "Inspect one fictional long prose section and a nested ordered outline. This is a read-only local sample, not a provider request.",
        },
        {
          id: "prose-numbering-answer",
          role: "assistant",
          content: REVIEW_PROSE_NUMBERING_MARKDOWN,
        },
      ],
    });
  if (scenario === "chat-response-image-review") {
    conversations[0].title = "Synthetic response image review";
    conversations[0].messages = [
      {
        id: "image-review-prompt",
        role: "user",
        content:
          "Inspect a fictional local portrait sample, then send a plain-text message to inspect the pending image response. No image provider is connected.",
      },
      {
        id: "image-review-portrait",
        role: "assistant",
        content: `Synthetic local portrait sample, 360 × 640. No image provider was contacted.\n\n![Synthetic local portrait sample](${REVIEW_CHAT_IMAGE_SAMPLES.portrait.dataUrl})`,
      },
    ];
  }
  if (scenario === "chat-action-partial-review") {
    conversations[0].title = "Synthetic partial action review";
    conversations[0].messages = [
      {
        id: "action-review-prompt",
        role: "user",
        content:
          "Inspect two fictional local draft proposals. No Gmail account is connected and no email or draft is created.",
      },
      {
        id: "action-review-answer",
        role: "assistant",
        content:
          "Fictional local review only. A is a seeded completed presentation. B remains pending; its first Confirm fails with a synthetic reconnect message, then explicit Retry completes B locally. A remains unchanged. No Google account is contacted.",
        pendingConfirms: reviewChatActionConfirmations(),
      },
    ];
  }
  if (scenario === "chat-writing-result-review") {
    conversations[0].title = "Fictional writing and HTML results";
    conversations[0].messages = [
      {
        id: "writing-review-prompt",
        role: "user",
        content:
          "Inspect a fictional local writing result and a separate harmless HTML sample. No account content or publishing is involved.",
      },
      {
        id: "writing-review-answer",
        role: "assistant",
        content: `# Fictional local studio guide

This is a synthetic writing sample for local interface review. Every person, decision and activity below is fictional. Nothing here is a commitment, a real account record or a request to contact anyone. The sample is long enough to inspect the writing Result, its outline, reading size and reversible editing controls.

## Prepare a calm workspace

1. Choose one small, fictional task for the sample session.
   - Place the reference note beside the working draft.
   - Leave a little empty space so the next step is easy to find.
2. Read the sample once before making a local edit.
3. End with a short review of what changed.

Use the inline label \`sample-only\` for any temporary notes. A source marker demonstrates claim-local inspection: this entire guide is a fictional local sample. [1](#writing-sample-source)

## Compare two sample routines

| Routine | First step | Closing step |
| --- | --- | --- |
| Quiet morning | Open a fictional note | Save a local observation |
| Short afternoon | Review the sample outline | Clear the temporary list |

### Keep the review bounded

The table contains invented routines rather than measured results. Try a small wording change, inspect the outline and use Undo to return to the previous text. Any export is an explicit local action; this sample does not automatically download, upload, share or publish a document.

## Finish the sample

A useful closing note describes one visible change and one question left open. Keep both brief. The purpose is to inspect headings, lists, a table, a citation and inline code in an ordinary writing result, without involving a real project or external service.`,
        sources: [
          {
            id: "writing-sample-source",
            title: "Fictional local review reference",
            url: "https://example.invalid/local-review",
            domain: "example.invalid",
            snippet: "This entire guide is a fictional local sample.",
          },
        ],
      },
      {
        id: "html-review-prompt",
        role: "user",
        content:
          "Show a separate static HTML sample for an explicitly chosen sandbox preview. Do not run or download it automatically.",
      },
      {
        id: "html-review-answer",
        role: "assistant",
        content:
          'Fictional local HTML sample only. Choose Run explicitly to inspect the sandbox preview. It has no scripts, forms, external URLs or network resources.\n\n```html\n<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Fictional local review</title><style>body{font-family:system-ui;padding:2rem;background:#f4f1e8;color:#243d35}main{max-width:38rem;margin:auto}h1{font-size:2rem}.note{padding:1rem;border:1px solid #93a79c;border-radius:12px}</style></head>\n<body><main><h1>Fictional local studio</h1><p class="note">Synthetic interface review only. No scripts, network resources or account content.</p><ol><li>Read this sample.</li><li>Inspect the layout.</li><li>Close the preview.</li></ol></main></body>\n</html>\n```',
      },
    ];
  }
  if (scenario === "chat-outputs" || scenario.startsWith("chat-sources-"))
    conversations.push({
      id: REVIEW_OUTPUT_CHAT_ID,
      title: scenario.startsWith("chat-sources-") ? "A calmer workspace" : "Outputs review chat",
      mode: "instant",
      createdAt: 1792238400000,
      updatedAt: 1792238400000,
      messages: [
        {
          id: "outputs-prompt",
          role: "user",
          content: scenario.startsWith("chat-sources-")
            ? "Use these notes to outline a calmer workspace. Keep it practical and easy to follow."
            : "Synthetic Outputs review only: a text attachment, the bundled origami image, and Notes.txt from the sample Library. No account files were uploaded.",
          attachments: [
            {
              kind: "text_file",
              name: "review-checklist.txt",
              content:
                "Synthetic review checklist.\n1. Preview the attachment.\n2. Inspect its details.\n3. Return to this conversation.\n",
              fileType: "text/plain",
            },
            { kind: "image", dataUrl: IMAGE_REVIEW_DATA_URL },
            {
              kind: "library_file",
              libraryItemId: REVIEW_OUTPUT_LIBRARY_ID,
              name: "Notes.txt",
              fileType: "text/plain",
            },
            ...(scenario === "chat-outputs"
              ? [
                  {
                    kind: "library_file",
                    libraryItemId: HISTORICAL_MISSING_REVIEW_ID,
                    name: "Synthetic unavailable historical file.txt",
                    fileType: "text/plain",
                  },
                ]
              : []),
          ],
        },
        {
          id: "outputs-answer",
          role: "assistant",
          ...(scenario.startsWith("chat-sources-")
            ? {
                sources: [
                  {
                    id: "sample-source",
                    title: "Sample citation · Example Domain",
                    url: "https://example.com/",
                    domain: "example.com",
                    snippet: "Synthetic source fixture. No web research was performed.",
                    publishedAt: "2020-01-01",
                    retrievedAt: "2026-10-17T19:05:00.000Z",
                  },
                  {
                    id: "sample-source-undated",
                    title: "Synthetic historical source · dates and excerpt unavailable",
                    url: "https://example.invalid/historical-review",
                    domain: "example.invalid",
                  },
                ],
                memorySources: {
                  ownerId: REVIEW_OWNER,
                  sources: [{ kind: "chat_memory", id: "66666666-6666-4666-8666-666666666666" }],
                },
                activities: [
                  {
                    tool: "browser_interact",
                    label: "Sample browser event · no live session",
                    status: "done",
                  },
                ],
              }
            : {}),
          content: scenario.startsWith("chat-sources-")
            ? "Start with a little more breathing room.\n\n### Make space for one thing\nKeep the tools for your current task close, and put everything else out of sight. A clear surface makes the next step easier to see. [1](#sample-source)\n\n### Give the day a rhythm\nChoose one focused block, one short break, and a small stopping point. You can adjust the plan as you go.\n\n```text\nWorkspace notes\n• Clear the desk\n• Choose one priority\n• Leave room to pause\n```\n\n_Sample conversation for interface review. No research or browser session was performed._"
            : 'This static sample lets you inspect the Outputs menu. No code was executed and no AI provider was called.\n\n```js\n// Synthetic review artifact.\nconst checklist = [\n  "Preview the attachment",\n  "Inspect its details",\n  "Return to this conversation",\n];\n```',
        },
      ],
    });
  if (scenario === "chat-copy-task" || scenario === "chat-task-unconfirmed") {
    conversations[0].title = "Copy blocks and task receipt";
    conversations[0].messages = [
      {
        id: "sample-question",
        role: "user",
        content: "Draft a team update and a small code example.",
      },
      {
        id: "sample-answer",
        role: "assistant",
        activities: [
          {
            tool: "scheduled_task",
            label: "Task result",
            status: "done",
            ...(scenario === "chat-copy-task"
              ? {
                  taskReceipt: {
                    operation: "created",
                    source: "persisted-result",
                    taskId: "88888888-8888-4888-8888-888888888888",
                  },
                }
              : {}),
          },
        ],
        content:
          'Here is a draft you can use.\n\n> Hi team,\n>\n> We have finished the first review. Please check the remaining details before Friday so we can keep the next step clear and organized.\n>\n> Thanks for your help.\n\nThe example below prints a short confirmation.\n\n```\nconsole.log("Ready for review");\n```\n\nUse `console.log` for a simple local message.',
      },
    ];
  }
  if (scenario === "chat-copy-task") {
    conversations[0].messages[1].followups = [
      "Make the update shorter",
      "Turn the checklist into a table",
      "Explain the code example",
    ];
    conversations[0].messages[1].content +=
      "\n\n" +
      "This local sample paragraph demonstrates a long, copyable prose section. It describes a fictional release review: check the layout at narrow and wide sizes, keep the original draft intact, verify the names and dates, and use the recorded results to decide the next step. ".repeat(
        4,
      );
  }
  if (scenario === "chat-copy-task") {
    conversations[0].messages[1].content +=
      "\n\n### Review checklist\n\n| Item | Status |\n| --- | --- |\n| Keep the `draft` text | Ready to review |\n| **Check the layout** at both sizes | Sample only |\n| Confirm the `notes.txt` filename | No file was uploaded |";
  }
  if (scenario === "chat-long-content") {
    conversations.push({
      id: REVIEW_LONG_CHAT_ID,
      title: "Sample · 30-message workshop conversation",
      mode: "instant",
      createdAt: 1792238400000,
      updatedAt: 1792238400000,
      messages: Array.from({ length: 30 }, (_, index) => ({
        id: `long-sample-${String(index + 1).padStart(2, "0")}`,
        role: index % 2 ? "assistant" : "user",
        content:
          index === 0
            ? reviewLongPrompt().body
            : index === 29
              ? `Synthetic final response, message 30 of 30. No code was executed and no provider was called.\n\n### Multiline code sample\n\n\`\`\`js filename=synthetic-workshop-comparison-and-reusable-review-notes-with-a-deliberately-long-filename-for-phone-review.js\n${REVIEW_LONG_CODE}\n\`\`\`\n\n### Wide workshop comparison\n\n${REVIEW_WIDE_TABLE}\n\nEnd of the synthetic 30-message conversation.`
              : index % 2
                ? `Synthetic response ${Math.ceil((index + 1) / 2)}. This fictional workshop section pairs a short demonstration with a quiet review period. Prepare paper and reusable cards, introduce one example, and ask participants to compare two possible approaches. A written outline provides an alternative to speaking aloud.\n\nKeep the preparation notes, activity instructions, and stopping point separate so the reader can revisit them. This paragraph is static interface-review text; no event was arranged, task completed, or research performed.`
                : `Synthetic request ${index / 2 + 1}: expand section ${index / 2 + 1} of the fictional workshop outline, keeping assumptions and the review question visible.`,
      })),
    });
  }
  if (scenario === "chat-many-history") {
    const base = 1792238400000;
    conversations.forEach((chat, index) => {
      chat.updatedAt = base - index * 60_000;
    });
    for (let index = 2; index < 11; index++) {
      const pinned = index >= 9;
      conversations.push({
        id: `review-many-history-${String(index + 1).padStart(2, "0")}`,
        title: pinned
          ? `Sample · Pinned reference ${index - 8}`
          : index === 8
            ? "Sample · Recent chat 09 · A deliberately long planning title for checking truncation, accessible naming and the full searchable history beyond eight recent conversations"
            : `Sample · Recent chat ${String(index + 1).padStart(2, "0")}`,
        mode: "instant",
        createdAt: base - index * 60_000,
        updatedAt: base - index * 60_000,
        ...(pinned ? { pinned: true, pinnedAt: base - (index - 9) * 60_000 } : {}),
        messages: [
          {
            id: `many-history-message-${index + 1}`,
            role: "user",
            content: `Synthetic history sample ${index + 1}. No provider request, upload or task execution occurred.`,
          },
        ],
      });
    }
  }
  if (scenario === "chat-trash") conversations.push(reviewTrashFixtures().restored.conversation);
  return conversations;
}

/** Disposable sample contract from api/chat/history.ts, chat-history-state.mjs
 * and 20260905023609_chat_history_sync.sql. Only title/timestamp, pin and archive
 * changes on existing samples are supported; no live synchronization occurs.
 */
export function createConversationFixture(
  isActive = () => true,
  scenario = "default",
  state = "populated",
) {
  const trash = scenario === "chat-trash" ? reviewTrashFixtures() : null;
  const restorable = new Map(
    trash ? [trash.deleted, trash.expiringSoon].map((entry) => [entry.conversation.id, entry]) : [],
  );
  const epoch = randomUUID();
  const records = reviewConversations(scenario, state).map((payload, index) => ({
    id: payload.id,
    payload,
    archived: false,
    revision: 1,
    sync_version: index + 1,
    mutation_id: randomUUID(),
    deleted_at: null,
  }));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const receipts = new Map();
  let currentVersion = records.length;
  const unsupportedWrite = () =>
    json(
      {
        error: `Private review: only rename/pin/unpin/archive/restore of the ${records.length === 2 ? "two " : ""}sample chats is available. Other account chat writes are not connected; device changes remain local.`,
      },
      503,
    );
  const handler = (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname !== "/api/chat/history") return route.fallback();
    if (!isActive() || request.headers()["x-kova-owner"] !== REVIEW_OWNER)
      return route.fulfill(json({ error: "Synthetic chat account does not match." }, 401));
    if (scenario === "chat-prose-numbering-review" && request.method() !== "GET")
      return route.fulfill(json({ error: "Synthetic prose/numbering history is read-only." }, 503));
    if (request.method() === "POST") {
      const raw = request.postData() ?? "";
      if (Buffer.byteLength(raw) > 4 * 1024 * 1024 + 65536)
        return route.fulfill(json({ error: "chat_history_too_large" }, 413));
      let input;
      try {
        input = JSON.parse(raw);
      } catch {
        return route.fulfill(json({ error: "chat_history_invalid" }, 400));
      }
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).some(
          (key) =>
            !["id", "mutationId", "epoch", "expectedRevision", "payload", "archived"].includes(key),
        ) ||
        typeof input.id !== "string" ||
        input.id.length > 200 ||
        !/^[A-Za-z0-9._:-]+$/.test(input.id) ||
        ["__proto__", "prototype", "constructor"].includes(input.id) ||
        typeof input.epoch !== "string" ||
        !uuid.test(input.epoch) ||
        typeof input.mutationId !== "string" ||
        !uuid.test(input.mutationId) ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 0 ||
        typeof input.archived !== "boolean" ||
        (input.payload !== null &&
          (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)))
      )
        return route.fulfill(json({ error: "chat_history_invalid" }, 400));
      input.epoch = input.epoch.toLowerCase();
      input.mutationId = input.mutationId.toLowerCase();
      if (input.epoch !== epoch)
        return route.fulfill(json({ error: "chat_history_conflict" }, 409));
      // As in the source RPC, replay an exact receipt before checking the now-
      // advanced revision; reuse of a mutation identity with other data conflicts.
      const receipt = receipts.get(input.mutationId);
      if (receipt)
        return route.fulfill(
          isDeepStrictEqual(input, receipt.input)
            ? json(structuredClone(receipt.result))
            : json({ error: "chat_history_conflict" }, 409),
        );
      const record = records.find(({ id }) => id === input.id);
      if (!record && restorable.has(input.id)) {
        const entry = restorable.get(input.id);
        if (input.expectedRevision !== 0)
          return route.fulfill(json({ error: "chat_history_conflict" }, 409));
        if (
          input.archived ||
          entry.expiresAt <= Date.now() ||
          !isDeepStrictEqual(input.payload, entry.conversation)
        )
          return route.fulfill(unsupportedWrite());
        if (receipts.size >= 256)
          return route.fulfill(
            json({ error: "Private review mutation limit reached. Reset to continue." }, 413),
          );
        const restored = {
          id: input.id,
          payload: structuredClone(entry.conversation),
          archived: false,
          revision: 1,
          sync_version: ++currentVersion,
          mutation_id: input.mutationId,
          deleted_at: null,
        };
        records.push(restored);
        const result = {
          id: restored.id,
          revision: 1,
          syncVersion: restored.sync_version,
          mutationId: input.mutationId,
        };
        receipts.set(input.mutationId, { input: structuredClone(input), result });
        return route.fulfill(json(structuredClone(result)));
      }
      if (!record || input.payload === null) return route.fulfill(unsupportedWrite());
      if (input.expectedRevision !== record.revision)
        return route.fulfill(json({ error: "chat_history_conflict" }, 409));
      const { payload } = input;
      if (
        payload.id !== input.id ||
        typeof payload.title !== "string" ||
        payload.title.length > 500 ||
        !Number.isSafeInteger(payload.updatedAt) ||
        payload.updatedAt < 0 ||
        payload.updatedAt > 8_640_000_000_000_000 ||
        (Object.hasOwn(payload, "pinned") && typeof payload.pinned !== "boolean") ||
        (Object.hasOwn(payload, "pinnedAt") &&
          (!Number.isSafeInteger(payload.pinnedAt) ||
            payload.pinnedAt < 0 ||
            payload.pinnedAt > 8_640_000_000_000_000))
      )
        return route.fulfill(json({ error: "chat_history_invalid" }, 400));
      // Exact shape/content comparison is deliberately narrower than production
      // normalization: messages, attachments, mode, new fields and IDs
      // cannot become successful writes through this review-only adapter.
      const supportedPayload = {
        ...record.payload,
        title: payload.title,
        updatedAt: payload.updatedAt,
      };
      // Unpin uses the actual controller's normalized omission of both fields.
      // Preserve exact presence for accepted requests; do not retain a stale pin.
      for (const key of ["pinned", "pinnedAt"]) {
        delete supportedPayload[key];
        if (Object.hasOwn(payload, key)) supportedPayload[key] = payload[key];
      }
      if (!isDeepStrictEqual(payload, supportedPayload)) return route.fulfill(unsupportedWrite());
      if (receipts.size >= 256)
        return route.fulfill(
          json({ error: "Private review mutation limit reached. Reset to continue." }, 413),
        );
      record.payload = structuredClone(supportedPayload);
      record.archived = input.archived;
      record.revision++;
      record.sync_version = ++currentVersion;
      record.mutation_id = input.mutationId;
      const result = {
        id: record.id,
        revision: record.revision,
        syncVersion: record.sync_version,
        mutationId: input.mutationId,
      };
      receipts.set(input.mutationId, { input: structuredClone(input), result });
      return route.fulfill(json(structuredClone(result)));
    }
    if (request.method() !== "GET") return route.fulfill(unsupportedWrite());
    const cursor = Number(url.searchParams.get("cursor") ?? "0");
    const requestedEpoch = url.searchParams.get("epoch")?.toLowerCase();
    if (
      [...url.searchParams.keys()].some((key) => !["epoch", "cursor"].includes(key)) ||
      url.searchParams.getAll("epoch").length > 1 ||
      url.searchParams.getAll("cursor").length > 1 ||
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      (requestedEpoch && !uuid.test(requestedEpoch))
    )
      return route.fulfill(json({ error: "chat_history_invalid" }, 400));
    const after = requestedEpoch === epoch ? cursor : 0;
    if (after > currentVersion) return route.fulfill(json({ error: "chat_history_invalid" }, 400));
    const page = records
      .filter((record) => record.sync_version > after)
      .sort((a, b) => a.sync_version - b.sync_version)
      .slice(0, 1);
    const nextCursor = page.at(-1)?.sync_version ?? after;
    return route.fulfill(
      json({
        ownerId: REVIEW_OWNER,
        epoch,
        reset: requestedEpoch !== epoch,
        records: structuredClone(page),
        nextCursor,
        currentVersion,
        hasMore: records.some((record) => record.sync_version > nextCursor),
      }),
    );
  };
  // Private read-only seam: use the same revision/payload as ordinary history GETs.
  handler.readRecord = (id) => {
    const record = isActive() ? records.find((value) => value.id === id) : null;
    return record ? structuredClone({ ownerId: REVIEW_OWNER, ...record }) : null;
  };
  return handler;
}

export function initialStorage(selection, now = Date.now()) {
  const values = {
    "kova-theme-mode": selection.theme,
    "kova-sidebar-open":
      REVIEW_ACCOUNT_SCENARIOS.includes(selection.scenario) ||
      selection.scenario === "chat-many-history"
        ? "1"
        : "0",
  };
  const session = syntheticSession(selection.account, now);
  if (!session) return values;
  // The visible theme selector initializes both the pre-paint hint and the
  // synthetic principal's actual device preference. It never changes a real
  // account, and is applied only by the explicit disposable review reset.
  values[`nova-gpt-settings-v1:${REVIEW_OWNER}`] = JSON.stringify({ mode: selection.theme });
  // Supabase derives its storage key from the rewritten loopback hostname.
  values["sb-127-auth-token"] = JSON.stringify(session);
  const conversations = reviewConversations(selection.scenario, selection.state);
  if (selection.scenario === "chat-trash") {
    const trash = reviewTrashFixtures(now);
    values[`kova-chat-trash-v1:user:${REVIEW_OWNER}`] = JSON.stringify({
      retentionMs: trash.retentionMs,
      entries: [trash.deleted, trash.expiringSoon, trash.expired],
    });
    values[`kova-draft-v2:user:${REVIEW_OWNER}:${trash.deleted.conversation.id}`] =
      "Synthetic deleted chat draft: restore must preserve this text.";
  }
  values[`nova-gpt-conversations-v3:user:${REVIEW_OWNER}`] = JSON.stringify(conversations);
  if (conversations.length) {
    values[`nova-gpt-pending-active:v2:user:${REVIEW_OWNER}`] = REVIEWED_MEMORY_SCENARIOS.includes(
      selection.scenario,
    )
      ? REVIEWED_MEMORY_CHAT_ID
      : selection.scenario === "result-version-conflict"
        ? VERSION_CONFLICT_CHAT_ID
        : selection.scenario === GENERATIVE_UI_REVIEW_SCENARIO
          ? GENERATIVE_UI_REVIEW_CHAT_ID
          : selection.scenario === "chat-prose-numbering-review"
            ? REVIEW_PROSE_NUMBERING_CHAT_ID
            : selection.scenario === "chat-long-content"
              ? REVIEW_LONG_CHAT_ID
              : selection.scenario === "chat-outputs" ||
                  selection.scenario.startsWith("chat-sources-")
                ? REVIEW_OUTPUT_CHAT_ID
                : conversations[0].id;
    if (conversations[1])
      values[`kova-draft-v2:user:${REVIEW_OWNER}:${conversations[1].id}`] = "Second chat draft";
  }
  return values;
}

export function reviewDailyUsage(now = Date.now()) {
  const date = new Date(now);
  return {
    date: date.toISOString().slice(0, 10),
    chats: 3,
    images: 0,
    uploads: 0,
    resetsAt: new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
    ).toISOString(),
  };
}

export async function createFixtureSession(pkg, selection, { loadingClock } = {}) {
  const { account, theme, state, scenario } = selection;
  if (
    !PATHS.includes(selection.path) ||
    !["guest", "free", "plus", "pro"].includes(account) ||
    !["light", "dark", "system"].includes(theme) ||
    !Object.hasOwn(SIZES, selection.size) ||
    !["populated", "empty", "error", "loading"].includes(state)
  )
    throw new Error("Invalid review option.");
  const registry = new FixtureRegistry();
  const loading = createReviewReadHold(loadingClock);
  const providerReturn = [
    "plugin-health-return-unverified",
    "plugin-health-return-verified",
  ].includes(scenario)
    ? createProviderReturnReadHold(loadingClock)
    : null;
  const accountCompletion = REVIEW_ACCOUNT_SCENARIOS.includes(scenario)
    ? createReviewCompletionHold(loadingClock)
    : null;
  const id = randomUUID();
  const session = {
    id,
    registry,
    selection: { ...selection },
    authActive: account !== "guest",
    // These RPC fixtures pin the synthetic token across bootstrap and refresh.
    // Other scenarios retain their existing current-time tokens.
    authIssuedAt:
      VERSION_CONFLICT_REVIEW_SCENARIOS.includes(scenario) ||
      scenario === "project-populated-archive-review"
        ? Date.now()
        : undefined,
    disposed: false,
    loading,
    providerReturn,
    accountCompletion,
    fontFailure: scenario === "font-load-failure" ? createReviewFontFailure(id) : null,
    chatStream: null,
    chatResponse: null,
    historyRecovery: null,
    reviewedMemory: null,
    versionConflict: null,
    documentExport: null,
    chatAction: null,
    dispose() {
      session.disposed = true;
      session.authActive = false;
      loading.dispose();
      providerReturn?.dispose();
      accountCompletion?.dispose();
      session.chatStream?.dispose();
      session.chatResponse?.dispose();
      session.historyRecovery?.dispose();
      session.reviewedMemory?.dispose();
      session.versionConflict?.dispose();
      session.documentExport?.dispose();
      session.chatAction?.dispose();
      session.fontFailure?.requested.clear();
    },
  };
  session.documentExport = createReviewDocumentExport({
    isActive: () => !session.disposed && (account === "guest" || session.authActive),
  });
  registry.diagnostic = ({ method, path }) =>
    console.warn(
      "PRIVATE_REVIEW_UNSUPPORTED",
      JSON.stringify({
        method,
        path,
        ...(path.startsWith("/_serverFn/")
          ? {
              functionName: (pkg.base.functionNames.get(path.split("/").at(-1)) ?? "unknown").split(
                "_",
              )[0],
            }
          : {}),
      }),
    );
  if (account === "guest")
    await pkg.base.fixture(registry, theme === "system" ? "dark" : theme, false);
  let crudState;
  if (account !== "guest")
    crudState = await pkg.crud.recoveryCrudFixture(
      registry,
      theme === "system" ? "dark" : theme,
      account,
    );
  if (scenario === "library-document-review") {
    const originals = installLibraryDocumentSamples(crudState.items);
    await registry.route(
      "**/api/library/files**",
      createLibraryDocumentReviewHandler(originals, { isActive: () => session.authActive }),
    );
  }
  if (["chat-stream-review", "chat-response-image-review"].includes(scenario))
    session.chatStream = createReviewChatStream({
      isActive: () => session.authActive,
      clock: loadingClock,
    });
  if (REVIEW_CHAT_RESPONSE_SCENARIOS.includes(scenario))
    session.chatResponse = createReviewChatResponse({
      scenario,
      isActive: () => session.authActive,
      clock: loadingClock,
    });
  if (scenario === "chat-action-partial-review") {
    session.chatAction = createReviewChatAction({ isActive: () => session.authActive });
    await registry.route("**/api/chat/confirm**", session.chatAction.handler);
  }
  if (scenario === "chat-response-image-review")
    await registry.route(FIXTURE_ORIGIN + "/_serverFn/*", (route) => {
      const name = (
        pkg.base.functionNames.get(new URL(route.request().url()).pathname.split("/").at(-1)) ?? ""
      ).split("_")[0];
      return name === "saveImageToLibrary"
        ? route.fulfill(
            json(
              {
                error:
                  "Synthetic response-image saves are disconnected. No Library item was created.",
              },
              session.authActive ? 503 : 401,
            ),
          )
        : route.fallback();
    });
  // Same authenticated GET contract as production, with fresh synthetic dates.
  await registry.route(FIXTURE_ORIGIN + "/_serverFn/*", (route) => {
    const request = route.request();
    const name = (
      pkg.base.functionNames.get(new URL(request.url()).pathname.split("/").at(-1)) ?? ""
    ).split("_")[0];
    if (name !== "getMyDailyUsage") return route.fallback();
    if (
      !session.authActive ||
      (request.headers()["x-kova-owner"] && request.headers()["x-kova-owner"] !== REVIEW_OWNER)
    )
      return route.fulfill(json({ error: "Synthetic usage account does not match." }, 401));
    if (request.method() !== "GET")
      return route.fulfill(json({ error: "Synthetic usage is read-only." }, 405));
    return route.fulfill(json({ result: reviewDailyUsage(), context: {} }));
  });
  // Voice stays genuinely disconnected in this isolated review: never capture or
  // transmit audio to a provider merely to demonstrate the interface.
  await registry.route("**/api/voice", (route) => {
    if (account === "guest") return route.fulfill(json({ error: "unauthorized" }, 401));
    return route.request().method() === "GET"
      ? route.fulfill(json(reviewVoiceCapabilities(account, selection.scenario)))
      : route.fulfill(json({ error: "voice_not_configured" }, 503));
  });
  // Existing browser fixtures auto-close this returning-user dialog. Here the
  // ordinary fixture response records the same completed state, with no clicks.
  await registry.route("**/_serverFn/**", (route) => {
    const name = (
      pkg.base.functionNames.get(new URL(route.request().url()).pathname.split("/").at(-1)) ?? ""
    ).split("_")[0];
    return name === "getOnboarding"
      ? route.fulfill(
          json({
            result: {
              completed: true,
              completed_at: "2026-01-01T00:00:00Z",
              primary_use: "work",
              response_style: "balanced",
            },
            context: {},
          }),
        )
      : route.fallback();
  });
  const loadingResponse = async (route, label, library = false) => {
    const reason = await loading.wait(route.request().signal());
    const status = reason === "aborted" || reason === "reset" ? 499 : 503;
    const message =
      reason === "expired"
        ? `Synthetic ${label} loading hold ended after 20 seconds. Reset to inspect again.`
        : reason === "capacity"
          ? "Synthetic loading request limit reached. Reset to continue."
          : "Synthetic loading inspection canceled.";
    return route.fulfill(
      library
        ? json({ error: message }, status)
        : { status, contentType: "text/plain", body: message },
    );
  };
  if (state !== "populated") {
    await registry.route("**/api/library/**", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== FIXTURE_ORIGIN || url.pathname !== "/api/library/items")
        return route.fallback();
      // List reads use POST. Retain the legacy list-shaped GET probe, but do
      // not replace detail/history reads or normal Library mutation contracts.
      const listRead =
        request.method() === "GET"
          ? !url.searchParams.has("id")
          : request.method() === "POST" && request.postDataJSON()?.operation === "list";
      if (!listRead) return route.fallback();
      if (!session.authActive || request.headers()["x-kova-owner"] !== REVIEW_OWNER)
        return route.fulfill(json({ error: "Synthetic Library account does not match." }, 401));
      if (state === "loading") return loadingResponse(route, "Library", true);
      return route.fulfill(
        state === "empty"
          ? json({ items: [], cursor: null, hasMore: false })
          : json({ error: "Simulated read failure. Reset to retry." }, 503),
      );
    });
    // Directory reads only; explicit scenario handlers install later and win.
    await registry.route(FIXTURE_ORIGIN + "/_serverFn/*", (route) => {
      const name = (
        pkg.base.functionNames.get(new URL(route.request().url()).pathname.split("/").at(-1)) ?? ""
      ).split("_")[0];
      const list = name === "listProjects" || name === "listScheduledTasks";
      // Workspace recents can also contribute Library rows. Empty removes
      // that source, but never changes project detail or unrelated directories.
      if (!list && !(state === "empty" && name === "listWorkspaceRecents")) return route.fallback();
      if (!session.authActive)
        return route.fulfill({
          status: 401,
          contentType: "text/plain",
          body: "Synthetic account required.",
        });
      if (state === "loading")
        return loadingResponse(route, name === "listProjects" ? "Projects" : "Scheduled tasks");
      return route.fulfill(
        state === "empty"
          ? json({ result: [], context: {} })
          : {
              status: 503,
              contentType: "text/plain",
              body: `Simulated ${name === "listProjects" ? "project" : "scheduled task"} list failure. Reset to retry.`,
            },
      );
    });
  }
  let path = selection.path;
  if (pkg.image.IMAGE_REVIEW_SCENARIOS.includes(scenario)) {
    if (account === "guest")
      throw new Error("Image sample review needs a synthetic signed-in account.");
    await pkg.image.installImageReview(registry, scenario);
    path = "/images";
  } else {
    const option = await pkg.state.installReviewState(registry, scenario, account, {
      adapter: "http",
      isActive: () => session.authActive,
    });
    path =
      scenario === "chat-long-content" && selection.path === "/prompt-studio"
        ? selection.path
        : (option.path ?? path);
  }
  session.selection.path = path;
  if (VERSION_CONFLICT_REVIEW_SCENARIOS.includes(scenario)) {
    const installedLibraryItem =
      scenario === "library-version-conflict"
        ? installLibraryVersionConflictSample(crudState.items)
        : undefined;
    session.versionConflict = createVersionConflictReviewFixture(scenario, {
      installedLibraryItem,
      isActive: () => session.authActive && !session.disposed,
      expectedAccessToken: syntheticSession(account, session.authIssuedAt).access_token,
    });
    await registry.route("**/*", session.versionConflict.handler);
  }
  if (scenario === "chat-copy-task")
    await registry.route(
      FIXTURE_ORIGIN + "/_serverFn/*",
      pkg.state.createChatReceiptTaskReadHandler(scenario, account, pkg.base.functionNames, {
        isActive: () => session.authActive && !session.disposed,
      }),
    );
  if (scenario === "chat-long-content") {
    await registry.route(FIXTURE_ORIGIN + "/_serverFn/*", (route) => {
      const request = route.request();
      const name = (
        pkg.base.functionNames.get(new URL(request.url()).pathname.split("/").at(-1)) ?? ""
      ).split("_")[0];
      if (
        ![
          "listPromptTemplates",
          "listPromptHistory",
          "savePromptTemplate",
          "updatePromptTemplate",
          "deletePromptTemplate",
          "evaluatePrompt",
        ].includes(name)
      )
        return route.fallback();
      if (!session.authActive)
        return route.fulfill({
          status: 401,
          contentType: "text/plain",
          body: "Synthetic account required.",
        });
      if (name === "listPromptTemplates" && request.method() === "GET")
        return route.fulfill(json({ result: [reviewLongPrompt()], context: {} }));
      // The prompt can be inspected and handed to the composer. Editing,
      // history, evaluation and usage analytics are intentionally disconnected.
      return route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Synthetic long prompt is read-only. History, evaluation and usage analytics are disconnected.",
      });
    });
  }
  if (scenario === "project-create-uncertain")
    await registry.route(
      FIXTURE_ORIGIN + "/_serverFn/*",
      pkg.state.createProjectCreateUncertainReviewHandler(account, pkg.base.functionNames, {
        isActive: () => session.authActive,
      }),
    );
  if (scenario === "project-list-recovery" || scenario === "project-mutation-recovery") {
    await registry.route(
      FIXTURE_ORIGIN + "/_serverFn/*",
      pkg.state.createProjectRecoveryReviewHandler(scenario, account, pkg.base.functionNames, {
        isActive: () => session.authActive,
        dispatch: (request) => registry.dispatch(request),
      }),
    );
  }
  if (scenario === "project-archive-review")
    await registry.route(
      "**/*",
      createProjectArchiveReviewHandler(pkg.base.functionNames, {
        isActive: () => session.authActive,
        getProjects: () => crudState.projects,
      }),
    );
  if (scenario === "project-populated-archive-review")
    await registry.route(
      "**/*",
      createProjectPopulatedArchiveReviewHandler(pkg.base.functionNames, {
        isActive: () => session.authActive && !session.disposed,
        getProjects: () => crudState.projects,
        expectedAccessToken: syntheticSession(account, session.authIssuedAt).access_token,
      }),
    );
  if (scenario === "project-move-review") {
    await registry.route(
      FIXTURE_ORIGIN + "/_serverFn/*",
      createProjectMoveReviewHandler(pkg.base.functionNames, {
        isActive: () => session.authActive,
        getProjects: () => crudState.projects,
      }),
    );
  }
  const wait = (signal) => loading.wait(signal);
  if (MANAGEMENT_REVIEW_SCENARIOS.includes(scenario))
    await registry.route(
      FIXTURE_ORIGIN + "/_serverFn/*",
      createManagementReviewHandler(scenario, pkg.base.functionNames, {
        isActive: () => session.authActive && !session.disposed,
        wait,
        taskState:
          scenario === "tasks-management-recovery"
            ? pkg.state.createReviewTaskScenario(Date.now())
            : undefined,
        getProjects: () => crudState.projects,
      }),
    );
  if (scenario === "chat-writing-result-review")
    await registry.route(
      "**/api/**",
      createWritingDiffReviewHandler({
        isActive: () => session.authActive && !session.disposed,
        writingSample: reviewConversations("chat-writing-result-review")[0].messages[1].content,
      }),
    );
  if (scenario === "chat-outputs")
    await registry.route(
      BACKEND_ORIGIN + "/rest/v1/user_library_items**",
      createHistoricalLibraryReviewHandler({
        isActive: () => session.authActive,
        getItems: () => crudState.items,
      }),
    );
  if (scenario === "chat-outputs" && state === "populated")
    await registry.route(
      FIXTURE_ORIGIN + "/_serverFn/*",
      createPinnedContextReviewHandler(pkg.base.functionNames, {
        isActive: () => session.authActive,
        getItems: () => crudState.items,
      }),
    );
  if (ASYNC_READ_REVIEW_SCENARIOS.includes(scenario))
    await registry.route(
      "**/*",
      createAsyncReadReviewHandler(scenario, pkg.base.functionNames, {
        isActive: () => session.authActive,
        wait,
        dailyUsage: reviewDailyUsage,
        ...(scenario === "image-generation-pending"
          ? {
              imageReview: pkg.image.createImageReviewHandler(
                "image-sample-failure",
                pkg.base.functionNames,
              ),
            }
          : {}),
      }),
    );
  if (WORK_HISTORY_REVIEW_SCENARIOS.includes(scenario))
    await registry.route(
      "**/*",
      createWorkHistoryReviewHandler(scenario, pkg.base.functionNames, {
        isActive: () => session.authActive,
        wait,
      }),
    );
  if (SUPPORT_REVIEW_SCENARIOS.includes(scenario))
    await registry.route(
      "**/*",
      createSupportReviewHandler(scenario, { isActive: () => !session.disposed, wait }),
    );
  if (DIRECTORY_PLUGIN_REVIEW_SCENARIOS.includes(scenario))
    await registry.route(
      "**/*",
      createDirectoryPluginReviewHandler(scenario, account, pkg.base.functionNames, {
        isActive: () =>
          scenario === "assistant-directory-detail"
            ? !session.disposed && (account === "guest" || session.authActive)
            : scenario.startsWith("assistant-directory-")
              ? !session.disposed
              : session.authActive,
        wait: providerReturn ? (signal) => providerReturn.wait(signal) : wait,
      }),
    );
  const exportFixture = createAccountExportFixture(scenario, () => session.authActive);
  await registry.route("**/api/account/export**", exportFixture);
  await registry.route("**/api/private-files**", exportFixture);
  const historyHandler = createConversationFixture(() => session.authActive, scenario, state);
  if (scenario === "chat-history-recovery")
    session.historyRecovery = createChatHistoryRecovery({
      handler: historyHandler,
      isActive: () => session.authActive,
      clock: loadingClock,
    });
  await registry.route("**/api/chat/history**", session.historyRecovery?.handler ?? historyHandler);
  if (REVIEWED_MEMORY_SCENARIOS.includes(scenario)) {
    session.reviewedMemory = createReviewedMemoryReviewFixture(scenario, pkg.base.functionNames, {
      account,
      isActive: () => session.authActive && !session.disposed,
      getHistoryRecord: (id) => historyHandler.readRecord(id),
    });
    await registry.route("**/*", session.reviewedMemory.handler);
  }
  if (scenario === "developer-console-empty")
    await registry.route(
      "**/api/developer/console**",
      createDeveloperConsoleReviewHandler({ isActive: () => session.authActive }),
    );
  const completeAccountRead = async (route, response) => {
    if (!session.authActive)
      return route.fulfill(json({ error: "Synthetic account required." }, 401));
    const reason = await accountCompletion.wait(route.request().signal());
    if (!session.authActive || reason === "disposed")
      return route.fulfill(
        json({ error: "Synthetic account changed. Reset review controls." }, 401),
      );
    if (reason !== "released")
      return route.fulfill(
        json(
          {
            error: `Synthetic account read ${reason}. Reset to inspect again; no service was contacted.`,
          },
          503,
        ),
      );
    return route.fulfill(response());
  };
  if (scenario === "account-plan-loading")
    await registry.route(BACKEND_ORIGIN + "/rest/v1/rpc/current_subscription_summary", (route) => {
      if (!["GET", "POST"].includes(route.request().method()))
        return route.fulfill(json({ error: "Unsupported synthetic plan method." }, 405));
      return completeAccountRead(route, () =>
        json({ effectiveTier: account, source: "private-review-fixture" }),
      );
    });
  if (scenario === "chat-prose-numbering-review")
    await registry.route("**/*", (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (
        url.origin !== FIXTURE_ORIGIN ||
        !/^\/(?:api|_serverFn)(?:\/|$)/.test(url.pathname) ||
        request.method() === "GET"
      )
        return route.fallback();
      return route.fulfill(
        json(
          { error: "Synthetic prose/numbering review is read-only; this action is disconnected." },
          session.authActive ? 503 : 401,
        ),
      );
    });
  // These local routes are the only token/user endpoints, never a real provider.
  await registry.route(BACKEND_ORIGIN + "/auth/v1/**", (route) => {
    const url = new URL(route.request().url()),
      method = route.request().method();
    if (url.pathname === "/auth/v1/user" && method === "GET" && scenario === "account-loading")
      return completeAccountRead(route, () =>
        json(syntheticSession(account, session.authIssuedAt).user),
      );
    if (url.pathname === "/auth/v1/user" && method === "GET")
      return route.fulfill(
        session.authActive
          ? json(syntheticSession(account, session.authIssuedAt).user)
          : json({ error: "Synthetic guest account." }, 401),
      );
    if (
      url.pathname === "/auth/v1/token" &&
      method === "POST" &&
      url.searchParams.get("grant_type") === "refresh_token"
    )
      return route.fulfill(
        session.authActive
          ? json(syntheticSession(account, session.authIssuedAt))
          : json({ error: "Select a review account." }, 401),
      );
    if (url.pathname === "/auth/v1/logout" && method === "POST") {
      session.dispose();
      return route.fulfill({ status: 204, body: "" });
    }
    if (url.pathname === "/auth/v1/settings" && method === "GET")
      return route.fulfill(json({ external: {}, disable_signup: true, passkey_enabled: false }));
    return route.fallback();
  });
  // Last registration keeps the resource scenario's read-only boundaries ahead
  // of every reusable CRUD fixture and collection-state overlay.
  if (scenario === "library-pdf-resource-review") {
    const originals = installLibraryPdfResourceSamples(crudState.items);
    await registry.route(
      "**/*",
      createLibraryPdfResourceReviewHandler(originals, {
        isActive: () => session.authActive && !session.disposed,
        functionNames: pkg.base.functionNames,
      }),
    );
  }
  if (scenario === "project-member-review")
    await registry.route(
      "**/*",
      createProjectMemberReviewHandler(pkg.base.functionNames, {
        isActive: () => session.authActive && !session.disposed,
        getProjects: () => crudState.projects,
      }),
    );
  return session;
}

// Private controller navigation only; deliberately does not submit/reset the form.
export function reviewNavigationScript() {
  return `const navigateButton=document.getElementById('navigate-selected-path');if(navigateButton)navigateButton.onclick=()=>{const product=document.getElementById('product'),path=document.getElementById('review-path').value,status=document.getElementById('review-navigation-status');if(!product||!${scriptJSON(PATHS)}.includes(path)){status.textContent='Choose a listed relative path in an active review session.';return;}product.src=path;status.textContent='Navigated to '+path+'. Active account, scenario and local data preserved; other selector changes were ignored.';};`;
}

/** Accept only an observed absolute same-origin app-page URL. This helper never
 * reads selectors, invents a route or authorizes a request to a service endpoint.
 */
export function observedReviewAppUrl(href, origin) {
  if (typeof href !== "string" || !href || href !== href.trim()) return null;
  try {
    const url = new URL(href);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.pathname.startsWith("//") ||
      // Conservatively omit encoded paths and public assets from this app link.
      /[%\\.]/.test(url.pathname) ||
      /^\/(?:api|_serverFn|__[^/]*|auth|oauth|~oauth|reset-password|login|logout|sign-in|sign-up|signin|signup|callback)(?:\/|$)/i.test(
        url.pathname,
      ) ||
      /^\/developers\/authorize(?:\/|$)/i.test(url.pathname) ||
      [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()].some((key) =>
        /^(?:access_token|refresh_token|token|code|password|secret|authorization)$/i.test(key),
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function reviewCurrentAppLinkScript() {
  return `(()=>{const product=document.getElementById('product'),link=document.getElementById('current-app-link'),status=document.getElementById('current-app-url');if(!product||!link||!status)return;const accept=${observedReviewAppUrl.toString()};const refresh=()=>{let href=null;try{href=accept(product.contentWindow.location.href,window.location.origin);}catch{}if(href){link.href=href;link.removeAttribute('aria-disabled');status.textContent=href;}else{link.removeAttribute('href');link.setAttribute('aria-disabled','true');status.textContent='No ordinary same-origin app URL is available.';}return Boolean(href);};product.addEventListener('load',refresh);for(const event of ['focus','pointerenter','pointerdown','contextmenu'])link.addEventListener(event,refresh);for(const event of ['click','auxclick'])link.addEventListener(event,event=>{if(!refresh())event.preventDefault();});refresh();})();`;
}

export function reviewViewportSizeScript() {
  return `(()=>{const button=document.getElementById('apply-selected-size');if(!button)return;const sizes=${scriptJSON(SIZES)};button.onclick=()=>{const product=document.getElementById('product'),choice=document.getElementById('review-size'),status=document.getElementById('review-size-status');if(!status)return;if(!product||!choice||!Object.hasOwn(sizes,choice.value)){status.textContent='Choose a listed size in an active review session.';return;}const size=sizes[choice.value];product.style.width=size.width+'px';product.style.height=size.height+'px';product.title='Kova synthetic review, '+size.width+' by '+size.height+' pixel CSS viewport';status.textContent='Applied '+size.width+' × '+size.height+' CSS viewport to the same mounted app frame. Existing session retained; no navigation or reset. Other selectors were ignored.';};})();`;
}

function renderControls(pkg, csrf, session, bootstrap = false, error = "") {
  const selected = session?.selection ?? {
    account: "free",
    theme: "dark",
    path: "/",
    size: "desktop",
    state: "populated",
    scenario: "default",
  };
  const choose = (name, values, labels = {}, label = name[0].toUpperCase() + name.slice(1)) =>
    `<label for="review-${name}">${htmlEscape(label)}<select id="review-${name}" name="${name}">${values.map((value) => `<option value="${htmlEscape(value)}"${selected[name] === value ? " selected" : ""}>${htmlEscape(labels[value] ?? value)}</option>`).join("")}</select></label>`;
  const size = SIZES[selected.size];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kova private synthetic review</title><style>
body{margin:0;background:#191919;color:#eee;font:14px system-ui}header{padding:12px 16px;border-bottom:1px solid #555}h1{font-size:18px;margin:0 0 6px}p{margin:6px 0;line-height:1.45;color:#ccc}form{display:flex;flex-wrap:wrap;gap:10px;align-items:end}label{display:flex;flex-direction:column;gap:4px;text-transform:capitalize}select,button{font:inherit;border:1px solid #666;border-radius:7px;background:#292929;color:#fff;padding:8px;min-height:38px}select{max-width:300px}button{cursor:pointer}a{color:#9cc8ff}main{overflow:auto;padding:0;width:100%;min-height:70vh}iframe{display:block;width:${size.width}px;height:${size.height}px;border:0;background:#111;margin:0 auto;max-width:none}.row{display:flex;gap:18px;flex-wrap:wrap;align-items:center}#restore{display:none;position:fixed;z-index:9999;right:4px;top:4px;font-size:12px;background:#222d}.error{color:#ffb5b5}small{color:#bbb}#controller[hidden]{display:none}</style></head><body>
<header id="controller"><h1>Kova private interface review</h1><p>Disposable synthetic Guest / Free / Plus / Pro accounts. No live authentication, AI, email, billing, plugin connections or scheduled execution. Open/reset clears only this dedicated review origin's local/session storage and known chat database, and discards its previous in-memory fixture session.</p>
<form method="post" action="/__local-review/start"><input type="hidden" name="csrf" value="${csrf}">${choose("account", ["guest", "free", "plus", "pro"])}${choose("theme", ["dark", "light", "system"])}${choose("path", PATHS)}${choose("size", Object.keys(SIZES), Object.fromEntries(Object.entries(SIZES).map(([key, value]) => [key, `${key} · ${value.width} × ${value.height}`])))}${choose("state", ["populated", "empty", "error", "loading"], { populated: "default fixture data", empty: "synthetic empty", error: "synthetic error", loading: "synthetic loading · 20 second hold" }, "Library / Projects / Tasks state")}${choose("scenario", [...pkg.state.REVIEW_STATE_SCENARIOS, ...pkg.image.IMAGE_REVIEW_SCENARIOS], Object.fromEntries(pkg.state.REVIEW_STATE_OPTIONS.map(({ id, label }) => [id, label ?? id])))}<button type="submit">Open / reset synthetic review</button><button id="navigate-selected-path" type="button"${session ? "" : " disabled"}>Navigate selected path</button><button id="apply-selected-size" type="button"${session ? "" : " disabled"}>Apply selected size</button></form><p>Navigate selected path changes only the app iframe location, preserving the active account, scenario and local data. Changes to other selectors are ignored until Open / reset. Only the listed relative paths are allowed.</p><p id="review-navigation-status" role="status"></p><p>Apply selected size resizes the same mounted app frame without navigating or resetting its session. Other selectors are ignored. These are CSS viewport sizes, not physical-device certification.</p><p id="review-size-status" role="status"></p>
${session?.chatStream ? `<form id="chat-stream-control" method="post" action="/__local-review/chat-stream-action"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="sessionId" value="${session.id}"><input type="hidden" name="streamId" value=""><button name="outcome" value="released" type="submit" disabled>Release synthetic success</button><button name="outcome" value="failed" type="submit" disabled>Fail synthetic response</button><span id="chat-stream-status" role="status">Waiting for a text-only chat request.</span></form><p>${selected.scenario === "chat-response-image-review" ? "chat-response-image-review holds an image_pending event before its local sample or failure prose." : "chat-stream-review returns fixed synthetic text only."} No prompt is sent to an AI provider or echoed. Type and Send next in the app while held. Use the app’s actual Stop button to test client cancellation; a controller failure is not Stop. Each response waits at most 120 seconds; reset/sign-out cancels it. Chat-history writes remain limited to the existing sample metadata and may truthfully show local unsynced changes.</p>` : ""}
${session?.chatResponse ? `<p>${htmlEscape(REVIEW_CHAT_RESPONSE_DISCLOSURE)}</p>` : ""}
${selected.scenario === "chat-response-image-review" ? `<p>${htmlEscape(REVIEW_CHAT_IMAGE_DISCLOSURE)}</p>` : ""}
${selected.scenario === "chat-action-partial-review" ? `<p>${htmlEscape(REVIEW_CHAT_ACTION_DISCLOSURE)}</p>` : ""}
${selected.scenario === "chat-writing-result-review" ? `<p>${htmlEscape(REVIEW_CHAT_WRITING_DISCLOSURE)} ${htmlEscape(WRITING_REVIEW_DIFF_DISCLOSURE)}</p>` : ""}
${selected.scenario === "chat-prose-numbering-review" ? `<p>${htmlEscape(REVIEW_PROSE_NUMBERING_DISCLOSURE)}</p>` : ""}
${selected.scenario === GENERATIVE_UI_REVIEW_SCENARIO ? `<p>${htmlEscape(GENERATIVE_UI_REVIEW_DISCLOSURE)}</p>` : ""}
${VERSION_CONFLICT_REVIEW_SCENARIOS.includes(selected.scenario) ? `<p>${htmlEscape(VERSION_CONFLICT_REVIEW_DISCLOSURE)}</p>` : ""}
${selected.scenario === "library-pdf-resource-review" ? `<p>${htmlEscape(LIBRARY_PDF_RESOURCE_REVIEW_DISCLOSURE)}</p>` : ""}
${session?.accountCompletion ? `<form id="account-release" method="post" action="/__local-review/release-account"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="sessionId" value="${session.id}"><button type="submit"${session.accountCompletion.state !== "holding" ? " disabled" : ""}>Release synthetic ${selected.scenario === "account-loading" ? "account identity" : "plan read"}</button><span id="account-release-status" role="status">${htmlEscape(session.accountCompletion.state)} · local fixture only</span></form>` : ""}
<p>account-loading holds the real auth user validation read; account-plan-loading holds only the plan-summary RPC. Use the visible Release button within 120 seconds, otherwise the hold ends with a labeled error. Reset/sign-out cancels pending reads. chat-many-history supplies nine unpinned and two pinned sample conversations. accessibility-text-spacing adds only a private stylesheet with 1.5 line-height, .12em letter spacing, .16em word spacing and 2em paragraph spacing. Reset to default removes that stylesheet.</p>
<p>${htmlEscape(REVIEW_FONT_FAILURE_DISCLOSURE)}</p>
${session?.fontFailure ? `<p id="font-failure-evidence">Adapter-observed private font GET failures: ${session.fontFailure.requested.size} of 7 possible faces. ${htmlEscape([...session.fontFailure.requested].map((path) => path.split("/").at(-1)).join(", ") || "No private font requests observed yet.")} Only faces used by the page need to load. <a href="/__local-review">Refresh font request evidence</a> after inspecting the app. These are HTTP response observations, not a rendered-font assertion.</p>` : ""}
<p>${htmlEscape(LIBRARY_DOCUMENT_REVIEW_DISCLOSURE)}</p>
<p>${htmlEscape(TRASH_REVIEW_DISCLOSURE)} picker-many-projects exposes nine read-only sample project choices; details and execution stay unavailable. assistant-directory-recovery fails the first directory read, then Retry returns a verified empty sample. Both reset with this controller and never reach a service. The public directory sample accepts its normal cookieless GET and contains no account data. The chat-copy-task scenario contains a synthetic saved-task receipt, draft text and its one matching read-only task. Its ordinary button opens the existing task editor. The title and daily UTC schedule reuse the existing sample row; execution is disabled, run history is empty, and all task mutations remain disconnected. No live task was created. chat-task-unconfirmed deliberately lacks a saved-task receipt. State applies to Library, Projects and Scheduled tasks list reads. Project details and unrelated server endpoints keep their fixtures. Explicit scenarios override matching state; use tasks-editor for populated tasks. Empty/error reads stay fixed until reset. Empty also clears synthetic browser chats and HTTP history unless an explicit chat scenario supplies them. Loading holds each matching list read for at most 20 seconds, then returns a labeled synthetic error; reset, sign-out and request abort cancel its timers. No live backend read occurs. The chat-long-content scenario opens a synthetic 30-message conversation with a multiline code sample, a long filename, and a twelve-column table; its long reusable prompt is also visible in Prompt Studio. Prompt history, edits and usage analytics remain disconnected. The voice-catalog scenario shows explicitly sample sound choices and proposed tier locks; voice stays disconnected and these are not real entitlements. The chat-sources-used scenario adds a claim-local citation, a synthetic 2020 publication date and 2026 retrieval time, a second historical source without dates or excerpt, memory-provided and browser-event metadata. No source-kind or connector-origin fields are invented; they do not browse or retrieve memory. Use chat-outputs with default fixture data to open a separate sample chat with text, image, Library and code outputs; the two original chats stay unchanged.</p>
<p>${htmlEscape(pkg.state.PROJECT_RECOVERY_REVIEW_DISCLOSURE ?? "")}</p>
${MANAGEMENT_REVIEW_SCENARIOS.includes(selected.scenario) ? `<p>${htmlEscape(MANAGEMENT_REVIEW_DISCLOSURE)}</p>` : ""}
${selected.scenario === "project-create-uncertain" ? `<p>${htmlEscape(pkg.state.PROJECT_CREATE_UNCERTAIN_REVIEW_DISCLOSURE)}</p>` : ""}
${selected.scenario === "project-archive-review" ? `<p>${htmlEscape(PROJECT_ARCHIVE_REVIEW_DISCLOSURE)}</p>` : ""}
${selected.scenario === "project-populated-archive-review" ? `<p>${htmlEscape(PROJECT_POPULATED_ARCHIVE_REVIEW_DISCLOSURE)}</p>` : ""}
${selected.scenario === "project-member-review" ? `<p>${htmlEscape(PROJECT_MEMBER_REVIEW_DISCLOSURE)}</p>` : ""}
${REVIEWED_MEMORY_SCENARIOS.includes(selected.scenario) ? `<p>${htmlEscape(REVIEWED_MEMORY_DISCLOSURE)}</p>` : ""}
${selected.scenario === "project-move-review" ? `<p>${htmlEscape(PROJECT_MOVE_REVIEW_DISCLOSURE)}</p>` : ""}
${selected.scenario === "chat-outputs" ? `<p>${htmlEscape(PINNED_CONTEXT_REVIEW_DISCLOSURE)}</p>` : ""}
<p>${selected.scenario === "usage-large-counts" ? htmlEscape(USAGE_LARGE_COUNTS_REVIEW_DISCLOSURE) : "Daily usage is synthetic: 3 chats, 0 images and 0 uploads, with the current UTC date and next UTC midnight reset. No usage is billed or recorded by these fixtures."}</p>
${CONDITIONAL_REVIEW_SCENARIOS.includes(selected.scenario) ? `<p>${htmlEscape(CONDITIONAL_REVIEW_DISCLOSURE)}</p>` : ""}
${ASYNC_READ_REVIEW_SCENARIOS.includes(selected.scenario) ? `<p>${htmlEscape(ASYNC_READ_REVIEW_DISCLOSURE)}</p>` : ""}
${WORK_HISTORY_REVIEW_SCENARIOS.includes(selected.scenario) ? `<p>${htmlEscape(WORK_HISTORY_REVIEW_DISCLOSURE)}</p>` : ""}
${SUPPORT_REVIEW_SCENARIOS.includes(selected.scenario) ? `<p>${htmlEscape(SUPPORT_REVIEW_DISCLOSURE)}</p>` : ""}
${DIRECTORY_PLUGIN_REVIEW_SCENARIOS.includes(selected.scenario) ? `<p>${htmlEscape(DIRECTORY_PLUGIN_REVIEW_DISCLOSURE)}</p>` : ""}
${session?.providerReturn ? `<p>Provider-return status is a fixed local sample held for 5 seconds, below the application’s 15-second status timeout. It does not verify an OAuth return or change a provider connection. Other loading scenarios retain their 20-second hold.</p>` : ""}
<p>${session ? `Active: ${htmlEscape(selected.account)} · ${htmlEscape(selected.scenario)}. ` : ""}Iframe sizes are CSS viewports, not physical-device or keyboard certification. Trial scenarios require Plus; billing scenarios otherwise need Plus/Pro. Use Settings → Subscriptions.</p>
<div class="row"><button id="hide" type="button">Hide review controls</button>${session && !session.disposed ? `<a href="${htmlEscape(downloadDiagnosticPaths(session.id).page)}" target="_blank" rel="noopener noreferrer">Synthetic download diagnostic</a>` : ""}<a href="/__private-review/plugin-preview" target="_blank" rel="noopener">13 plugin proposal flows</a><a href="/__private-review/sources-preview" target="_blank" rel="noopener">Browser activity states</a><a href="/__private-review/voice-preview" target="_blank" rel="noopener">Voice interaction states</a><a href="/__private-review/account-deletion-preview" target="_blank" rel="noopener">Account deletion and recovery states</a><a href="/__private-review/core-preview" target="_blank" rel="noopener">Introductory offer, controls and other drafts</a></div>
${session ? `<p><a id="current-app-link" target="_blank" rel="noopener noreferrer" aria-disabled="true" tabindex="0">Open current app in new tab</a> · <span id="current-app-url">Waiting for the app URL.</span></p><p>The observed same-origin app URL updates on frame load and when you focus or use the link. Opening it preserves the existing review session without resetting data. Main-chat selection is local state, not a chat-specific URL. Auth, private and service URLs are excluded. Close extra app tabs before resetting the review.</p>` : ""}
${session ? `<p>${htmlEscape(DOCUMENT_EXPORT_REVIEW_DISCLOSURE)}</p>` : ""}
<p><small>Source ${pkg.source.commit}; compiled app ${pkg.source.buildCommit}. Existing production components; review adapter is separate. Chat history supports disposable sample rename/pin/unpin/archive/restore only. Other account chat writes remain unavailable. No live chat synchronization. ${selected.scenario.startsWith("image-") ? htmlEscape(pkg.image.IMAGE_REVIEW_DISCLOSURE) : ""}</small></p>${error ? `<p class="error" role="alert">${htmlEscape(error)}</p>` : ""}</header>
<button id="restore" type="button">Private ${htmlEscape(selected.account)} review · Show controls</button><main>${session ? `<iframe id="product" title="Kova synthetic review, ${size.width} pixel CSS viewport"${bootstrap ? "" : ` src="${htmlEscape(selected.path)}"`}></iframe>` : ""}</main>
<script id="review-navigation">${reviewNavigationScript()}</script><script id="review-current-app-link">${reviewCurrentAppLinkScript()}</script><script id="review-viewport-size">${reviewViewportSizeScript()}</script><script>const streamForm=document.getElementById('chat-stream-control');if(streamForm){let submitting=false;const status=document.getElementById('chat-stream-status'),buttons=[...streamForm.querySelectorAll('button')],streamId=streamForm.elements.streamId;const refresh=async()=>{try{const response=await fetch('/__local-review/chat-stream-status');const result=await response.json();if(!response.ok)throw new Error(result.error);streamId.value=result.active?.id||'';buttons.forEach(button=>button.disabled=submitting||!result.active);status.textContent=result.active?'Synthetic response '+result.active.sequence+' held. Release, fail, or use Stop in the app.':result.last?'Synthetic response '+result.last.sequence+': '+result.last.outcome+'. Send another text message to inspect again.':'Waiting for a text-only chat request.';}catch(error){buttons.forEach(button=>button.disabled=true);status.textContent=error.message;}};streamForm.onsubmit=async(event)=>{event.preventDefault();const body=new URLSearchParams(new FormData(streamForm));body.set('outcome',event.submitter?.value||'');submitting=true;buttons.forEach(button=>button.disabled=true);try{const response=await fetch(streamForm.action,{method:'POST',body});const result=await response.json();if(!response.ok)throw new Error(result.error);await refresh();}catch(error){status.textContent=error.message;}finally{submitting=false;}};void refresh();const timer=setInterval(()=>{if(!submitting)void refresh();},750);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});}const releaseForm=document.getElementById('account-release');if(releaseForm)releaseForm.onsubmit=async(event)=>{event.preventDefault();const button=releaseForm.querySelector('button'),status=document.getElementById('account-release-status');button.disabled=true;try{const response=await fetch(releaseForm.action,{method:'POST',body:new URLSearchParams(new FormData(releaseForm))});const result=await response.json();if(!response.ok)throw new Error(result.error);status.textContent='Released · synthetic local response only';}catch(error){status.textContent=error.message;button.disabled=false;}};document.getElementById('hide').onclick=()=>{document.getElementById('controller').hidden=true;document.getElementById('restore').style.display='block'};document.getElementById('restore').onclick=()=>{document.getElementById('controller').hidden=false;document.getElementById('restore').style.display='none'};${bootstrap ? `void(async()=>{await new Promise((resolve,reject)=>{const reset=indexedDB.deleteDatabase('kovagpt-chat-history-v1');reset.onsuccess=()=>resolve();reset.onerror=()=>reject(new Error('The synthetic chat database could not be reset.'));reset.onblocked=()=>reject(new Error('Close other private review app tabs, then reset again.'));});localStorage.clear();sessionStorage.clear();for(const [key,value] of Object.entries(${scriptJSON(initialStorage(selected, session.authIssuedAt))}))localStorage.setItem(key,value);document.getElementById('product').src=${scriptJSON(selected.path)};})().catch(error=>{const notice=document.createElement('p');notice.className='error';notice.setAttribute('role','alert');notice.textContent=error.message;document.getElementById('controller').append(notice)});` : ""}</script></body></html>`;
}

const types = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
};
function cookies(header) {
  return Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter((pair) => pair.length === 2),
  );
}
async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBodyBytes) {
      const error = new Error("Review request is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Fetch only the already-guarded loopback app, without following redirects.
 * The shared network guard intentionally forces fetch redirects to error. Native
 * HTTP lets this adapter inspect Location while the same socket guard stays active.
 */
export function readGuardedUpstreamDocument(value, { signal } = {}) {
  const url = new URL(value);
  if (url.origin !== FIXTURE_ORIGIN || url.username || url.password)
    return Promise.reject(new Error("private_review_upstream_origin_denied"));
  return new Promise((resolveResponse, reject) => {
    const request = httpRequest(
      url,
      { method: "GET", signal, headers: { Accept: "text/html" } },
      (response) => {
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) {
            response.destroy(new Error("private_review_upstream_document_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () =>
          resolveResponse({
            status: response.statusCode,
            headers: new Headers(
              Object.entries(response.headers).flatMap(([name, value]) =>
                value === undefined
                  ? []
                  : [[name, Array.isArray(value) ? value.join(", ") : value]],
              ),
            ),
            text: async () => Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}

/** Permit only the packaged PDF and document-extraction worker files, never arbitrary same-origin/blob workers. */
export function packagedPdfWorkerSources(clientRoot, origin) {
  const assets = resolve(clientRoot, "assets");
  if (!existsSync(assets)) return "'none'";
  const workers = readdirSync(assets)
    .filter((name) => {
      if (!/^(?:pdf|document-extraction)\.worker-[A-Za-z0-9_-]+\.(?:mjs|js)$/.test(name))
        return false;
      const path = resolve(assets, name);
      return realpathSync(path).startsWith(clientRoot + sep) && statSync(path).isFile();
    })
    .sort();
  return workers.length ? workers.map((name) => `${origin}/assets/${name}`).join(" ") : "'none'";
}

// The PDF exporter deliberately uses credentials:'omit'. Only these exact,
// public packaged font bytes may bypass the synthetic session-cookie gate.
export const REVIEW_PDF_FONTS = Object.freeze([
  Object.freeze({
    path: "/assets/DejaVuSans-uCh15Ap1.ttf",
    bytes: 759720,
    sha256: "ae7b7855e115a5966d8b1b3f80f254ccc117ec86f9965e202ee2940453837280",
  }),
  Object.freeze({
    path: "/assets/DejaVuSans-Bold-D5xQDVUG.ttf",
    bytes: 708920,
    sha256: "5c1247acef7f2b8522a31742c76d6adcb5569bacc0be7ceaa4dc39dd252ce895",
  }),
]);

export function packagedPdfFont(clientRoot, pathname) {
  const font = REVIEW_PDF_FONTS.find((entry) => entry.path === pathname);
  if (!font) return null;
  try {
    const root = realpathSync(clientRoot);
    const path = realpathSync(resolve(root, "." + pathname));
    if (!path.startsWith(root + sep)) return null;
    const stat = statSync(path);
    if (!stat.isFile() || stat.size !== font.bytes) return null;
    const bytes = readFileSync(path);
    return createHash("sha256").update(bytes).digest("hex") === font.sha256 ? bytes : null;
  } catch {
    return null;
  }
}

export function createPrivateReviewServer({
  pkg,
  port = 4191,
  upstream = FIXTURE_ORIGIN,
  fetchImpl = readGuardedUpstreamDocument,
}) {
  const origin = `http://127.0.0.1:${port}`;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 4189 || port === 4190)
    throw new Error("Choose an unprivileged dedicated review port other than 4189/4190.");
  if (upstream !== FIXTURE_ORIGIN)
    throw new Error("Only the guarded loopback upstream on 4189 is supported.");
  const sessions = new Map();
  // Public directory transport deliberately omits cookies. This isolated
  // counter has no account data and is armed only by the explicit controller.
  let anonymousDirectoryReads = null;
  let anonymousDirectorySession = null;
  const discardSession = (id) => {
    if (anonymousDirectorySession?.id === id) anonymousDirectorySession = null;
    sessions.get(id)?.dispose();
    sessions.delete(id);
  };
  const dispose = () => {
    anonymousDirectoryReads = null;
    anonymousDirectorySession = null;
    for (const id of [...sessions.keys()]) discardSession(id);
  };
  const formTokens = new Set();
  const clientRoot = realpathSync(resolve(pkg.root, "dist/client"));
  const previewFiles = new Map([
    ["/__private-review/plugin-preview", ["review/plugin-preview.html", "text/html"]],
    ["/__private-review/voice-preview", ["review/voice-preview.html", "text/html"]],
    [
      "/__private-review/account-deletion-preview",
      ["review/account-deletion-preview.html", "text/html"],
    ],
    [
      "/review/account-deletion-preview.js",
      ["review/account-deletion-preview.js", "text/javascript"],
    ],
    ["/review/account-deletion-preview.css", ["review/account-deletion-preview.css", "text/css"]],
    ["/__private-review/sources-preview", ["review/sources-preview.html", "text/html"]],
    ["/review/sources-preview.js", ["review/sources-preview.js", "text/javascript"]],
    ["/review/sources-preview.css", ["review/sources-preview.css", "text/css"]],
    ["/review/voice-preview.css", ["review/voice-preview.css", "text/css"]],
    ["/review/voice-preview.js", ["review/voice-preview.js", "text/javascript"]],
    ["/__private-review/core-preview", ["review/core-preview.html", "text/html"]],
    ["/review/plugin-preview.js", ["review/plugin-preview.js", "text/javascript"]],
    ["/review/core-preview.js", ["review/core-preview.js", "text/javascript"]],
    ["/review/core-preview.css", ["review/core-preview.css", "text/css"]],
    ["/review/plugin-preview.css", ["review/plugin-preview.css", "text/css"]],
  ]);
  const securityHeaders = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Kova-Private-Review": "synthetic-only",
    "Content-Security-Policy": `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ${origin}; frame-src 'self' blob: data:; frame-ancestors 'self'; worker-src ${packagedPdfWorkerSources(clientRoot, origin)}; object-src 'none'; media-src 'self' blob: data:; base-uri 'none'; form-action 'self'`,
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
  function send(response, output = {}, extraHeaders = {}) {
    if (response.destroyed) return;
    const contentType =
      output.contentType ?? (Object.hasOwn(output, "json") ? "application/json" : "text/plain");
    let body = Object.hasOwn(output, "json") ? JSON.stringify(output.json) : (output.body ?? "");
    if (typeof body === "string" && /(?:text\/|javascript|json)/.test(contentType))
      body = rewriteReviewText(body, origin);
    response.writeHead(output.status ?? 200, {
      ...output.headers,
      ...securityHeaders,
      ...extraHeaders,
      "Content-Type": contentType,
    });
    response.end(body);
  }
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== `127.0.0.1:${port}`)
        return send(response, json({ error: "Loopback Host required." }, 403));
      if (request.headers["sec-fetch-site"] === "cross-site")
        return send(response, json({ error: "Cross-site review requests are blocked." }, 403));
      if (!["GET", "HEAD"].includes(request.method) && request.headers.origin !== origin) {
        if (request.url === "/__local-review/start") {
          console.warn("PRIVATE_REVIEW_ORIGIN_REJECTED");
        }
        return send(response, json({ error: "Same-origin review action required." }, 403));
      }
      if (request.url.startsWith("http") || request.url.startsWith("//"))
        return send(response, json({ error: "Relative review paths only." }, 400));
      const url = new URL(request.url, origin),
        jar = cookies(request.headers.cookie);
      let session = sessions.get(jar[cookieName]);
      const diagnostic = downloadDiagnosticResponse({
        url,
        rawPath: request.url,
        method: request.method,
        active: Boolean(
          session &&
          !session.disposed &&
          (session.selection.account === "guest" || session.authActive),
        ),
        sessionId: session?.id,
        hasBody:
          Number(request.headers["content-length"] ?? 0) > 0 ||
          Boolean(request.headers["transfer-encoding"]),
      });
      if (diagnostic) return send(response, diagnostic);
      if (url.pathname === "/__local-review/health" && request.method === "GET")
        return send(
          response,
          json({ privateReview: true, source: pkg.source.commit, build: pkg.source.buildCommit }),
        );
      if (url.pathname === "/__local-review" && request.method === "GET") {
        const existing = jar[csrfCookieName];
        const csrf = formTokens.has(existing) ? existing : randomUUID();
        if (formTokens.size >= 128 && !formTokens.has(csrf))
          formTokens.delete(formTokens.values().next().value);
        formTokens.add(csrf);
        return send(
          response,
          { contentType: "text/html", body: renderControls(pkg, csrf, session) },
          {
            "Set-Cookie": `${csrfCookieName}=${csrf}; HttpOnly; SameSite=Strict; Path=/`,
          },
        );
      }
      if (url.pathname === "/__local-review/release-account" && request.method === "POST") {
        const form = new URLSearchParams((await readBody(request)).toString("utf8"));
        const csrf = form.get("csrf");
        if (!csrf || csrf !== jar[csrfCookieName] || !formTokens.has(csrf))
          return send(response, json({ error: "Reload review controls before releasing." }, 403));
        if (
          !session?.authActive ||
          form.get("sessionId") !== session.id ||
          !session.accountCompletion
        )
          return send(
            response,
            json({ error: "Review session changed. Open the current controls." }, 409),
          );
        if (!session.accountCompletion.release())
          return send(
            response,
            json({ error: "Synthetic hold expired or was canceled. Reset to inspect again." }, 409),
          );
        return send(response, json({ released: true, syntheticOnly: true }));
      }
      if (url.pathname === "/__local-review/chat-stream-status" && request.method === "GET") {
        if (!session?.authActive || !session.chatStream)
          return send(response, json({ error: "Open an active chat-stream-review session." }, 409));
        return send(response, json(session.chatStream.status));
      }
      if (url.pathname === "/__local-review/chat-stream-action" && request.method === "POST") {
        const form = new URLSearchParams((await readBody(request)).toString("utf8"));
        const csrf = form.get("csrf");
        if (!csrf || csrf !== jar[csrfCookieName] || !formTokens.has(csrf))
          return send(
            response,
            json({ error: "Reload review controls before releasing a stream." }, 403),
          );
        if (!session?.authActive || form.get("sessionId") !== session.id || !session.chatStream)
          return send(response, json({ error: "Synthetic review session changed." }, 409));
        if (!session.chatStream.complete(form.get("streamId"), form.get("outcome")))
          return send(
            response,
            json({ error: "Synthetic stream changed or ended. Use the current controls." }, 409),
          );
        return send(response, json({ syntheticOnly: true, completed: true }));
      }
      if (url.pathname === "/__local-review/start" && request.method === "POST") {
        const form = new URLSearchParams((await readBody(request)).toString("utf8"));
        const csrf = form.get("csrf");
        if (!csrf || csrf !== jar[csrfCookieName] || !formTokens.has(csrf)) {
          console.warn("PRIVATE_REVIEW_CSRF_REJECTED");
          return send(response, json({ error: "Reload review controls before resetting." }, 403));
        }
        try {
          const selection = Object.fromEntries(
            ["account", "theme", "path", "size", "state", "scenario"].map((key) => [
              key,
              form.get(key),
            ]),
          );
          const next = await createFixtureSession(pkg, selection);
          if (session) discardSession(session.id);
          // Keep the local server bounded even if many test tabs create sessions.
          if (sessions.size >= 24) discardSession(sessions.keys().next().value);
          sessions.set(next.id, next);
          session = next;
          anonymousDirectoryReads =
            selection.scenario === "assistant-directory-recovery" ? 0 : null;
          anonymousDirectorySession =
            DIRECTORY_PLUGIN_REVIEW_SCENARIOS.includes(selection.scenario) &&
            selection.scenario.startsWith("assistant-directory-")
              ? session
              : null;
          return send(
            response,
            { contentType: "text/html", body: renderControls(pkg, csrf, session, true) },
            {
              "Set-Cookie": `${cookieName}=${session.id}; HttpOnly; SameSite=Strict; Path=/`,
            },
          );
        } catch (error) {
          return send(response, {
            status: 400,
            contentType: "text/html",
            body: renderControls(pkg, csrf, session, false, error.message),
          });
        }
      }
      if (url.pathname.startsWith(REVIEW_FONT_FAILURE_PREFIX + "/")) {
        const failure = session?.fontFailure;
        if (
          !failure ||
          session.disposed ||
          url.search ||
          (url.pathname !== failure.stylesheetPath && !failure.fontPaths.includes(url.pathname))
        )
          return send(response, json({ error: "Private font review resource not found." }, 404));
        if (!["GET", "HEAD"].includes(request.method))
          return send(response, json({ error: "Read-only private font inspection." }, 405));
        if (url.pathname === failure.stylesheetPath)
          return send(response, { contentType: "text/css", body: failure.css });
        if (request.method === "GET") failure.requested.add(url.pathname);
        return send(response, {
          status: 503,
          contentType: "text/plain",
          body: "Synthetic local typography font failure for a session-unique face. Reset to default fixture data to restore font requests.",
        });
      }
      if (url.pathname === REVIEW_SPACING_PATH) {
        if (!session || session.selection.scenario !== "accessibility-text-spacing")
          return send(
            response,
            json(
              { error: "This stylesheet is only available in its explicit review scenario." },
              404,
            ),
          );
        if (!["GET", "HEAD"].includes(request.method))
          return send(response, json({ error: "Read-only accessibility stylesheet." }, 405));
        return send(response, { contentType: "text/css", body: REVIEW_SPACING_CSS });
      }
      if (previewFiles.has(url.pathname) && request.method === "GET") {
        const [file, contentType] = previewFiles.get(url.pathname);
        return send(response, { contentType, body: readFileSync(resolve(pkg.root, file), "utf8") });
      }
      // This public read deliberately omits credentials in the real client.
      // Expose only the active scenario's fictional catalog, never account data.
      if (
        !session &&
        request.method === "GET" &&
        url.pathname === "/api/kovas/directory" &&
        anonymousDirectorySession
      ) {
        const publicSession = anonymousDirectorySession;
        return send(
          response,
          await withReviewRequestSignal(request, response, (signal) =>
            publicSession.registry.dispatch({
              url: FIXTURE_ORIGIN + url.pathname + url.search,
              method: request.method,
              headers: request.headers,
              signal,
            }),
          ),
        );
      }
      if (
        !session &&
        request.method === "GET" &&
        url.pathname === "/api/kovas/directory" &&
        anonymousDirectoryReads !== null
      ) {
        anonymousDirectoryReads += 1;
        return send(
          response,
          anonymousDirectoryReads === 1
            ? json({ error: "Synthetic public directory failure" }, 503)
            : json({ rows: [] }),
        );
      }
      if (REVIEW_PDF_FONTS.some((font) => font.path === url.pathname)) {
        if (!["GET", "HEAD"].includes(request.method))
          return send(response, json({ error: "Packaged PDF fonts are read-only." }, 405));
        if (request.url !== url.pathname)
          return send(response, json({ error: "Exact packaged PDF font paths only." }, 400));
        const bytes = packagedPdfFont(clientRoot, url.pathname);
        return send(
          response,
          bytes
            ? { contentType: "font/ttf", body: bytes }
            : json({ error: "Packaged PDF font unavailable." }, 404),
        );
      }
      if (!session) {
        if (
          request.method === "GET" &&
          !extname(url.pathname) &&
          !/^\/(api|_serverFn|__private-review)\//.test(url.pathname)
        )
          return send(
            response,
            { status: 303, body: "Open private review controls." },
            { Location: "/__local-review" },
          );
        return send(response, json({ error: "Open the private review controls first." }, 401));
      }
      if (url.pathname === DOCUMENT_EXPORT_PATH) {
        if (request.url !== url.pathname + url.search)
          return send(response, json({ error: "Exact private export path required." }, 400));
        return await withReviewRequestSignal(request, response, async (signal) => {
          // Preserve the actual 4191 URL and received Origin. This is local byte
          // delivery, never a canonicalized service request or upstream passthrough.
          const result = await session.documentExport.handle(
            nativeDocumentExportRequest(request, url.href, signal),
          );
          const bytes = Buffer.from(await result.arrayBuffer());
          if (response.destroyed) return;
          // Headers normalizes casing so the actual parser's stricter CSP and
          // MIME are single values, not duplicate mixed-case HTTP fields.
          const headers = new Headers(securityHeaders);
          for (const [name, value] of result.headers) headers.set(name, value);
          headers.set("connection", "close");
          response.writeHead(result.status, Object.fromEntries(headers));
          response.end(bytes);
        });
      }
      if (url.pathname === "/api/chat" && (session.chatStream || session.chatResponse)) {
        if (request.method !== "POST")
          return send(response, json({ error: "Synthetic chat requires POST." }, 405));
        if (!session.authActive || request.headers["x-kova-owner"] !== REVIEW_OWNER)
          return send(response, json({ error: "Synthetic chat account does not match." }, 401));
        return await withReviewRequestSignal(request, response, async (signal) => {
          const bytes = await readBody(request);
          let value;
          try {
            value = JSON.parse(bytes.toString("utf8"));
          } catch {}
          if (
            url.search ||
            !/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "") ||
            bytes.length > REVIEW_CHAT_STREAM_MAX_BYTES ||
            !validReviewChatBody(value)
          )
            return send(
              response,
              json(
                {
                  error:
                    "This synthetic stream accepts bounded plain-text chat only; tools, files and custom assistants stay disconnected.",
                  retryable: false,
                },
                400,
              ),
            );
          if (session.chatResponse)
            return send(response, await session.chatResponse.respond(signal));
          const stream = session.chatStream.start(signal);
          if (stream.error)
            return send(response, json({ error: stream.error, retryable: false }, stream.status));
          response.writeHead(200, {
            ...securityHeaders,
            "Content-Type": "text/event-stream; charset=utf-8",
            "X-Accel-Buffering": "no",
          });
          response.flushHeaders();
          response.write(reviewChatOpeningEvent(session.selection.scenario));
          const outcome = await stream.completion;
          if (response.destroyed) return;
          if (!session.authActive || outcome === "disposed" || outcome === "aborted")
            return response.destroy();
          response.end(reviewChatCompletionEvent(outcome, session.selection.scenario));
        });
      }
      if (
        url.pathname.startsWith(BACKEND_PREFIX + "/") ||
        /^\/(api|_serverFn)\//.test(url.pathname)
      ) {
        const canonical = url.pathname.startsWith(BACKEND_PREFIX + "/")
          ? BACKEND_ORIGIN + url.pathname.slice(BACKEND_PREFIX.length) + url.search
          : FIXTURE_ORIGIN + url.pathname + url.search;
        return send(
          response,
          await withReviewRequestSignal(request, response, async (signal) =>
            session.registry.dispatch({
              url: canonical,
              method: request.method,
              headers: request.headers,
              body: await readBody(request),
              signal,
            }),
          ),
        );
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        return send(response, json({ error: "Unsupported private review method." }, 405));
      if (url.pathname === "/kova-sw.js" || request.headers["service-worker"])
        return send(
          response,
          json({ error: "Service workers are disabled in private review." }, 403),
        );
      if (
        session.selection.scenario === "font-load-failure" &&
        REVIEW_FONT_PATHS.includes(url.pathname)
      )
        return send(response, {
          status: 503,
          contentType: "text/plain",
          body: "Synthetic local typography font failure. Reset to default fixture data to restore font requests.",
        });
      // Serve only packaged public assets. Realpath containment blocks symlinks/traversal.
      const candidate = resolve(clientRoot, "." + decodeURIComponent(url.pathname));
      if (
        candidate.startsWith(clientRoot + sep) &&
        existsSync(candidate) &&
        statSync(candidate).isFile()
      ) {
        const actual = realpathSync(candidate);
        if (!actual.startsWith(clientRoot + sep))
          return send(response, json({ error: "Invalid asset path." }, 403));
        const contentType = types[extname(actual)] ?? "application/octet-stream";
        const bytes = readFileSync(actual);
        return send(response, {
          contentType,
          body: /(?:text\/|javascript|json)/.test(contentType) ? bytes.toString("utf8") : bytes,
        });
      }
      if (url.pathname.startsWith("/__") || extname(url.pathname))
        return send(response, json({ error: "Private review resource not found." }, 404));
      // Only public page rendering goes upstream. Never pass browser cookies,
      // bearer headers or request bodies, and never forward API/server functions.
      const upstreamResponse = await fetchImpl(FIXTURE_ORIGIN + url.pathname + url.search, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { Accept: "text/html" },
      });
      if ([301, 302, 303, 307, 308].includes(upstreamResponse.status)) {
        const location = upstreamResponse.headers.get("location");
        let target;
        try {
          target = new URL(location, FIXTURE_ORIGIN + url.pathname + url.search);
        } catch {}
        if (
          !location ||
          !target ||
          target.origin !== FIXTURE_ORIGIN ||
          target.username ||
          target.password
        )
          return send(
            response,
            json(
              {
                error:
                  "Private review blocked an upstream redirect outside its guarded local origin.",
              },
              503,
            ),
          );
        return send(
          response,
          { status: upstreamResponse.status, body: "Continue within private review." },
          {
            Location: target.pathname + target.search + target.hash,
          },
        );
      }
      const contentType = upstreamResponse.headers.get("content-type") ?? "text/plain";
      if (!contentType.includes("text/html")) return send(response, unavailable());
      let document = await upstreamResponse.text();
      if (session.fontFailure)
        document = document.replace(
          /<\/head>/i,
          `<link rel="stylesheet" href="${session.fontFailure.stylesheetPath}" data-private-review="font-load-failure"></head>`,
        );
      if (session.selection.scenario === "accessibility-text-spacing")
        document = document.replace(
          /<\/head>/i,
          `<link rel="stylesheet" href="${REVIEW_SPACING_PATH}" data-private-review="accessibility-text-spacing"></head>`,
        );
      return send(response, {
        status: upstreamResponse.status,
        contentType,
        body: document,
      });
    } catch (error) {
      console.error(
        "PRIVATE_REVIEW_REQUEST_ERROR",
        JSON.stringify({
          name: error.name ?? "Error",
          code: error.code ?? error.cause?.code ?? null,
        }),
      );
      if (!response.headersSent)
        send(
          response,
          json(
            { error: "Private review request failed. Check the local adapter log." },
            error.status ?? 500,
          ),
        );
      else response.end();
    }
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("close", dispose);
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return {
    server,
    origin,
    sessions,
    dispose,
    listen: () =>
      new Promise((resolveListening, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolveListening());
      }),
  };
}

async function main() {
  const args = new Map(
    process.argv.slice(2).map((item) => {
      const [key, ...value] = item.replace(/^--/, "").split("=");
      return [key, value.join("=")];
    }),
  );
  const ownDirectory = dirname(fileURLToPath(import.meta.url));
  const packageRoot =
    args.get("package") ??
    (existsSync(resolve(ownDirectory, "SOURCE.json"))
      ? ownDirectory
      : resolve(ownDirectory, "../../exports/KovaGPT-Recovery-Candidate-5502efb"));
  const port = Number(args.get("port") ?? "4191");
  // Reuse the existing review-only egress boundary: this process may contact
  // only the independently guarded app on loopback 4189. No credential env is used.
  process.env.PORT = "4189";
  const guard = existsSync(resolve(ownDirectory, "network-guard.mjs"))
    ? resolve(ownDirectory, "network-guard.mjs")
    : resolve(packageRoot, "review/network-guard.mjs");
  await import(pathToFileURL(guard).href);
  const pkg = await loadReviewPackage(packageRoot);
  const version = await fetch(FIXTURE_ORIGIN + "/api/version", {
    signal: AbortSignal.timeout(5000),
  }).then((response) => response.json());
  if (version.sha !== pkg.source.buildCommit)
    throw new Error("The guarded upstream build does not match the pinned review package.");
  const review = createPrivateReviewServer({ pkg, port });
  await review.listen();
  console.log(
    `PRIVATE_HTTP_REVIEW_READY ${review.origin}/__local-review source=${pkg.source.commit} build=${pkg.source.buildCommit}`,
  );
  console.log(
    "Synthetic in-memory review only. CSP blocks external services. Ctrl+C stops this adapter; upstream remains unchanged.",
  );
  const stop = () => {
    review.dispose();
    review.server.close(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
