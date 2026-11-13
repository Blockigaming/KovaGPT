#!/usr/bin/env python3
"""Assemble restored source files from scripts/restore-parts/."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARTS = ROOT / "restore-parts"
TARGETS = {
    "apps": Path("src/routes/apps.tsx"),
    "chat": Path("src/components/ChatMessage.tsx"),
    "conn": Path("src/lib/connectors-catalog.ts"),
}
COUNTS = {"apps": 23, "chat": 18, "conn": 23}

for key, dest in TARGETS.items():
    n = COUNTS[key]
    chunks = []
    for i in range(n):
        p = PARTS / f"{key}.{i:02d}.txt"
        chunks.append(p.read_text())
    text = "".join(chunks)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
    print("wrote", dest, len(text))
print("DONE")
