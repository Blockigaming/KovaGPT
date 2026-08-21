import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const root = process.cwd();
const scannedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const strongPlaceholderPatterns = [
  { label: "empty click handler", pattern: /onClick=\{\(\)\s*=>\s*\{\s*\}\}/u },
  { label: "undefined click handler", pattern: /onClick=\{undefined\}/u },
  { label: "fake hash link", pattern: /href=["']#["']/u },
  { label: "javascript pseudo-link", pattern: /javascript:\s*(?:void|;)/iu },
  {
    label: "placeholder success state",
    pattern: /toast\.(?:success|message)\(["'][^"']*(?:coming soon|not implemented)[^"']*["']\)/iu,
  },
];
const voicePatterns = [
  /\bSpeechRecognition\b/u,
  /\bwebkitSpeechRecognition\b/u,
  /\bstartListening\b/u,
  /\bstopListening\b/u,
  /\bisListening\b/u,
  /\bvoiceMode\b/u,
];

function trackedProductSource() {
  return execFileSync(
    "git",
    ["ls-files", "src/components", "src/routes", "src/lib", "src/platform"],
    {
      cwd: root,
    },
  )
    .toString("utf8")
    .split("\n")
    .filter((path) => path && scannedExtensions.has(extname(path)));
}

export function inspectVisibleControlContract({ files = trackedProductSource() } = {}) {
  const errors = [];
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    for (const rule of strongPlaceholderPatterns) {
      if (rule.pattern.test(source)) errors.push(`${path}:${rule.label}`);
    }
    for (const pattern of voicePatterns) {
      if (pattern.test(source)) errors.push(`${path}:exposed voice/dictation implementation`);
    }
  }

  const images = readFileSync("src/routes/images.tsx", "utf8");
  if (/aria-label=["']Edit image["']|>\s*Edit image\s*</iu.test(images)) {
    errors.push("src/routes/images.tsx:image editing is advertised without an editing backend");
  }

  const scheduled = readFileSync("src/routes/scheduled-tasks.tsx", "utf8");
  if (!/Scheduled Tasks Status/u.test(scheduled)) {
    errors.push("src/routes/scheduled-tasks.tsx:unavailable scheduler is not labeled as status");
  }
  if (/Create Scheduled Task|Schedule KovaGPT to do something/u.test(scheduled)) {
    errors.push("src/routes/scheduled-tasks.tsx:unavailable scheduler exposes creation copy");
  }

  const capabilities = readFileSync("src/lib/capability-registry.ts", "utf8");
  if (!/imageEditing:[\s\S]*availability: "unavailable"/u.test(capabilities)) {
    errors.push("capability-registry:image editing limitation missing");
  }
  if (!/scheduledTasks:[\s\S]*availability: "unavailable"/u.test(capabilities)) {
    errors.push("capability-registry:scheduled execution limitation missing");
  }
  if (!/voiceScope: "excluded"/u.test(capabilities)) {
    errors.push("capability-registry:Voice exclusion missing");
  }

  return [...new Set(errors)].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = inspectVisibleControlContract();
  if (errors.length) {
    console.error(`Visible-control contract failed:\n${errors.join("\n")}`);
    process.exit(1);
  }
  console.log("VISIBLE_CONTROL_CONTRACT=PASS fakeControls=0 voice=false");
}
