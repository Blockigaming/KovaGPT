#!/usr/bin/env python3
from pathlib import Path
import re
import subprocess

subprocess.check_call(["git", "fetch", "origin", "main"])
for path in ["src/routes/apps.tsx", "src/components/ChatMessage.tsx", "src/lib/connectors-catalog.ts"]:
    try:
        data = subprocess.check_output(["git", "show", "origin/main:" + path])
        Path(path).write_bytes(data)
        print("restored", path, len(data))
    except Exception as e:
        print("skip", path, e)

main = Path("src/routes/apps.tsx").read_text()
main2 = re.sub(
    r'const WORKING_IDS = new Set<string>\(\[\s*"google",\s*"gmail",\s*"google-drive",\s*"google-calendar",\s*"github",\s*\.\.\.Object\.keys\(CONNECTION_FLOWS\),\s*\]\);',
    'const WORKING_IDS = new Set<string>([\n  "google",\n  "gmail",\n  "google-drive",\n  "google-calendar",\n  "github",\n  "plaid",\n  ...Object.keys(CONNECTION_FLOWS),\n]);',
    main,
    count=1,
)
print("WORKING_IDS", "patched" if main2 != main else "NOT MATCHED")
main = main2

old_logo = (
    "function AppLogo({ id }: { id: string }) {\n"
    "  const asset = getPluginReview(id)?.brandAsset.src;\n"
    "  return (\n"
    '    <span className="spec400-plugin-logo" aria-hidden="true">\n'
    '      {asset ? <img src={asset} alt="" /> : <PanelsTopLeft />}\n'
    "    </span>\n"
    "  );\n"
    "}"
)
new_logo = (
    "function AppLogo({ id }: { id: string }) {\n"
    "  const review = getPluginReview(id);\n"
    "  const asset = review?.brandAsset.src;\n"
    "  const domain = review?.connector.domain?.trim();\n"
    "  const favicon =\n"
    "    !asset && domain\n"
    "      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`\n"
    "      : undefined;\n"
    "  const src = asset || favicon;\n"
    "  return (\n"
    '    <span className="spec400-plugin-logo" aria-hidden="true">\n'
    '      {src ? <img src={src} alt="" /> : <PanelsTopLeft />}\n'
    "    </span>\n"
    "  );\n"
    "}"
)
if old_logo in main:
    main = main.replace(old_logo, new_logo)
    print("logo patched")
else:
    print("logo NOT MATCHED")

old_cat = "const catalog = MASTER_PLUGIN_REVIEW_CATALOG.map((entry) => entry.connector);"
new_cat = (
    "const catalog = MASTER_PLUGIN_REVIEW_CATALOG.map((entry) => entry.connector).slice().sort((a, b) => {\n"
    '    const aWorking = WORKING_IDS.has(a.id) || a.status === "live" || a.status === "setup_required" ? 0 : 1;\n'
    '    const bWorking = WORKING_IDS.has(b.id) || b.status === "live" || b.status === "setup_required" ? 0 : 1;\n'
    "    if (aWorking !== bWorking) return aWorking - bWorking;\n"
    "    return a.label.localeCompare(b.label);\n"
    "  });"
)
if old_cat in main:
    main = main.replace(old_cat, new_cat)
    print("sort patched")
else:
    print("sort NOT MATCHED")
Path("src/routes/apps.tsx").write_text(main)

chat = Path("src/components/ChatMessage.tsx").read_text()
start = chat.find("const CONTINUED_WAIT_MS")
inner = chat.find("\nfunction ChatMessageInner")
if start > 0 and inner > start:
    chat = chat[:start] + chat[inner + 1 :]
    needle = 'import { PromptMessage } from "./PromptMessage";'
    if needle in chat and 'from "./StreamingStatus"' not in chat:
        chat = chat.replace(needle, needle + '\nimport { StreamingStatus } from "./StreamingStatus";', 1)
    Path("src/components/ChatMessage.tsx").write_text(chat)
    print("chat patched")
else:
    print("chat NOT MATCHED", start, inner)

conn_path = Path("src/lib/connectors-catalog.ts")
if conn_path.exists():
    conn = conn_path.read_text()
    if 'id: "plaid"' in conn:
        conn = re.sub(r'(id: "plaid",[\s\S]*?status: ")[^"]+(")', r"\1setup_required\2", conn, count=1)
        conn_path.write_text(conn)
        print("plaid status set")
    else:
        print("plaid missing")
