import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const sourceRoots = ["src/components", "src/routes"];
const visibleCoreFiles = [
  "src/components/ChatInput.tsx",
  "src/components/ChatMessage.tsx",
  "src/components/Sidebar.tsx",
  "src/components/MobileTopBar.tsx",
  "src/components/SettingsDialog.tsx",
  "src/components/OperationalState.tsx",
  "src/routes/index.tsx",
];
const voiceCriticalFiles = [
  "src/components/ChatInput.tsx",
  "src/components/ChatMessage.tsx",
  "src/components/Sidebar.tsx",
  "src/components/MobileTopBar.tsx",
  "src/components/CommandPalette.tsx",
  "src/components/SettingsDialog.tsx",
  "src/components/ResponsiveModelSelector.tsx",
  "src/routes/index.tsx",
];
const deadControlPatterns = [
  { label: "empty click handler", pattern: /onClick\s*=\s*\{\s*\(\)\s*=>\s*\{\s*\}\s*\}/u },
  { label: "undefined click handler", pattern: /onClick\s*=\s*\{\s*\(\)\s*=>\s*undefined\s*\}/u },
  { label: "hash-only link", pattern: /(?:href|to)\s*=\s*["']#["']/u },
  { label: "javascript link", pattern: /href\s*=\s*["']javascript:/iu },
  { label: "fake coming-soon success", pattern: /(?:toast|alert)\s*\(\s*["'](?:coming soon|not implemented|placeholder)/iu },
];
const voicePatterns = [
  /\bSpeechRecognition\b/u,
  /\bwebkitSpeechRecognition\b/u,
  /\bSpeechSynthesisUtterance\b/u,
  /\bspeechSynthesis\b/u,
  /\bstartListening\b/u,
  /\bstopListening\b/u,
  /\bisListening\b/u,
  /\bvoiceMode\b/u,
  /\bDictate\b/u,
  /\bdictation\b/iu,
  /\bRead aloud\b/iu,
  /\bmicrophone\b/iu,
  /<Mic(?:\s|\/|>)/u,
  /<Volume2(?:\s|\/|>)/u,
];

function filesUnder(directory) {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  const output = [];
  for (const name of readdirSync(absolute)) {
    const path = join(absolute, name);
    if (statSync(path).isDirectory()) output.push(...filesUnder(relative(root, path)));
    else if ([".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(extname(path))) {
      output.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  return output;
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

export function auditUiTruthfulness() {
  const errors = [];
  const visibleFiles = sourceRoots.flatMap(filesUnder);
  for (const path of visibleCoreFiles) {
    if (!existsSync(join(root, path))) errors.push(`${path}: required visible surface missing`);
  }

  for (const path of visibleFiles) {
    const source = read(path);
    for (const rule of deadControlPatterns) {
      if (rule.pattern.test(source)) errors.push(`${path}: ${rule.label}`);
    }
  }

  for (const path of voiceCriticalFiles) {
    if (!existsSync(join(root, path))) continue;
    const source = read(path);
    for (const pattern of voicePatterns) {
      if (pattern.test(source)) errors.push(`${path}: exposed voice/dictation contract ${pattern}`);
    }
  }

  const stateSources = [
    "src/components/OperationalState.tsx",
    "src/components/states.tsx",
    "src/components/RealtimeReadiness.tsx",
    "src/lib/readiness-client.ts",
  ]
    .filter((path) => existsSync(join(root, path)))
    .map(read)
    .join("\n");
  for (const state of [
    "loading",
    "empty",
    "offline",
    "retry",
    "permission-denied",
    "rate-limited",
    "expired-auth",
    "unavailable",
    "error",
  ]) {
    if (!new RegExp(state, "iu").test(stateSources)) {
      errors.push(`operational state coverage missing: ${state}`);
    }
  }

  const chatInput = existsSync(join(root, "src/components/ChatInput.tsx"))
    ? read("src/components/ChatInput.tsx")
    : "";
  for (const contract of ["textarea", "attachment", "stream", "send"]) {
    if (!new RegExp(contract, "iu").test(chatInput)) errors.push(`ChatInput contract missing: ${contract}`);
  }

  const sidebar = existsSync(join(root, "src/components/Sidebar.tsx"))
    ? read("src/components/Sidebar.tsx")
    : "";
  for (const contract of ["New chat", "Search", "Projects", "Library", "Settings"]) {
    if (!sidebar.includes(contract)) errors.push(`Sidebar contract missing: ${contract}`);
  }

  return { errors: [...new Set(errors)].sort(), checkedFiles: visibleFiles.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = auditUiTruthfulness();
  if (result.errors.length) {
    console.error(`UI truthfulness audit failed:\n${result.errors.join("\n")}`);
    process.exit(1);
  }
  console.log(`UI_TRUTHFULNESS_AUDIT=PASS checkedFiles=${result.checkedFiles}`);
}
