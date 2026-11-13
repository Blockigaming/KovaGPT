#!/usr/bin/env python3
"""Decode zlib+base64 parts into source files."""
from pathlib import Path
import zlib, base64

ROOT = Path(__file__).resolve().parent
PARTS = ROOT / "zparts"
TARGETS = {
    "apps": (Path("src/routes/apps.tsx"), 8),
    "chat": (Path("src/components/ChatMessage.tsx"), 7),
    "conn": (Path("src/lib/connectors-catalog.ts"), 6),
}

for key, (dest, n) in TARGETS.items():
    b64 = "".join((PARTS / f"{key}.{i:02d}.b64").read_text().strip() for i in range(n))
    data = zlib.decompress(base64.b64decode(b64))
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    print("wrote", dest, len(data))
print("DONE")
