"""Recover immutable source objects only; never update a branch or execute product code."""
import ast
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request
import zlib

REPO = "Blockigaming/KovaGPT"
BASE = "40602623903e019ecf8ccc5437ce212b1ab52210"
TARGET = "e8859d4930de97d334f80aefceb3d144cde447b3"
TRANSFER = "05ced7f64ff1a73caa257dab595196f0f820694f"
MISSING = {
    "tests/browser-runtime/work-sync-storage.spec.ts",
    "tests/unit/application-rate-limit-contract.test.mjs",
    "tests/unit/principal-work-storage.test.mjs",
    "tests/unit/pwa-client-runtime.test.mjs",
    "tests/unit/scheduled-task-output-checkpoint.test.mjs",
    "tests/unit/work-execution-protocol.test.mjs",
    "tests/unit/work-runner-service.test.mjs",
}
assert os.environ["GITHUB_REPOSITORY"] == REPO
assert os.environ["GITHUB_REF"] == "refs/heads/codex/recover-unpublished-20260906"


def git(*args, data=None):
    return subprocess.run(["git", *args], input=data, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=True).stdout


def api(path, body=None):
    request = urllib.request.Request(
        "https://api.github.com/repos/" + REPO + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Accept": "application/vnd.github+json", "Content-Type": "application/json",
                 "Authorization": "Bearer " + os.environ["GH_TOKEN"]},
        method="GET" if body is None else "POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def blob_hash(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


transfer = git("show", TRANSFER + ":.github/workflows/publish-verified-continuation.yml").decode()
objects = []
for name, count in [("binary", 8), ("text", 9)]:
    shas = ast.literal_eval(re.search(r"\b" + name + r" = (\[.*?\])", transfer, re.S)[1])
    assert len(shas) == count and all(re.fullmatch(r"[a-f0-9]{40}", sha) for sha in shas)
    values = []
    for sha in shas:
        value = base64.b64decode(api("/git/blobs/" + sha)["content"])
        assert blob_hash(value) == sha
        values.append(value)
    objects.append(values)
parts = list(objects[0])
alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
missing_records = 0
for part, value in enumerate(objects[1], 4):
    lines = value.decode().splitlines()
    for row, line in enumerate(lines):
        checksum, text = line.split(":", 1)
        size = 75 if row < len(lines) - 1 else (50 if part < 12 else 70)

        def checked(candidate):
            try:
                decoded = base64.b64decode(candidate, validate=True)
                if len(decoded) == size and f"{zlib.crc32(decoded):08x}" == checksum:
                    return decoded
            except ValueError:
                pass
            return None

        decoded = checked(text)
        if decoded is None:
            encoded_size = 4 * ((size + 2) // 3)
            candidates = set()
            if len(text) > encoded_size:
                extra = len(text) - encoded_size
                candidates = {text[:i] + text[i + extra:] for i in range(len(text) - extra + 1)}
            elif len(text) == encoded_size:
                candidates = {text[:i] + c + text[i + 1:] for i in range(len(text)) for c in alphabet}
            elif len(text) == encoded_size - 1:
                candidates = {text[:i] + c + text[i:] for i in range(len(text) + 1) for c in alphabet}
            matches = {v for candidate in candidates if (v := checked(candidate)) is not None}
            if len(matches) == 1:
                decoded = matches.pop()
            else:
                missing_records += 1
                decoded = b"\xff" * size
        parts.append(decoded)
packed = b"".join(parts)
assert len(packed) == 62845 and packed[:8] == b"PACK\0\0\0\2"
# The entire transfer is damaged. Only independently valid streams whose object
# hashes match the immutable target tree are eligible for import.


def decode(offset):
    start = offset
    byte = packed[offset]
    offset += 1
    kind, size, shift = (byte >> 4) & 7, byte & 15, 4
    if kind not in (1, 2, 3, 4, 6, 7):
        raise ValueError("kind")
    while byte & 128:
        byte = packed[offset]
        offset += 1
        size |= (byte & 127) << shift
        shift += 7
        if shift > 40:
            raise ValueError("size")
    base = None
    if kind == 6:
        byte = packed[offset]
        offset += 1
        base = byte & 127
        while byte & 128:
            byte = packed[offset]
            offset += 1
            base = ((base + 1) << 7) + (byte & 127)
        base = start - base
    elif kind == 7:
        base = packed[offset:offset + 20].hex()
        offset += 20
    if size > 2_000_000 or packed[offset] != 0x78:
        raise ValueError("payload")
    decoder = zlib.decompressobj()
    data = decoder.decompress(packed[offset:], 2_000_001)
    if not decoder.eof or len(data) != size:
        raise ValueError("stream")
    return {"kind": kind, "data": data, "base": base,
            "end": len(packed) - len(decoder.unused_data)}


records = {}
for offset in range(12, len(packed) - 20):
    if any(begin < offset < record["end"] for begin, record in records.items()):
        continue
    try:
        records[offset] = decode(offset)
    except (ValueError, IndexError, zlib.error):
        continue


def varint(data, index):
    value, shift = 0, 0
    while True:
        byte = data[index]
        index += 1
        value |= (byte & 127) << shift
        if not byte & 128:
            return value, index
        shift += 7
        if shift > 40:
            raise ValueError("delta")


def expand(base, data):
    base_size, index = varint(data, 0)
    size, index = varint(data, index)
    if len(base) != base_size or size > 2_000_000:
        raise ValueError("delta size")
    result = bytearray()
    while index < len(data):
        command = data[index]
        index += 1
        if command & 128:
            offset = count = 0
            for bit in range(4):
                if command & (1 << bit):
                    offset |= data[index] << (8 * bit)
                    index += 1
            for bit in range(3):
                if command & (1 << (4 + bit)):
                    count |= data[index] << (8 * bit)
                    index += 1
            count = count or 65536
            if offset + count > len(base):
                raise ValueError("delta range")
            result.extend(base[offset:offset + count])
        elif command:
            result.extend(data[index:index + command])
            index += command
        else:
            raise ValueError("delta zero")
        if len(result) > size:
            raise ValueError("delta overflow")
    if len(result) != size:
        raise ValueError("delta result")
    return bytes(result)


names = {1: "commit", 2: "tree", 3: "blob", 4: "tag"}
for record in records.values():
    if record["kind"] in names:
        record.update(type=names[record["kind"]], expanded=record["data"])
for iteration in range(len(records) + 1):
    changed = False
    for record in records.values():
        if "expanded" not in record:
            base = record["base"]
            try:
                if isinstance(base, int):
                    parent = records[base]
                    data, kind = parent["expanded"], parent["type"]
                else:
                    kind = git("cat-file", "-t", base).decode().strip()
                    data = git("cat-file", kind, base)
                record.update(expanded=expand(data, record["data"]), type=kind)
            except (KeyError, ValueError, IndexError, subprocess.CalledProcessError):
                continue
        if "sha" not in record:
            record["sha"] = git("hash-object", "-w", "-t", record["type"], "--stdin",
                                data=record["expanded"]).decode().strip()
            changed = True
    if not changed:
        break
assert git("show", "-s", "--format=%T", TARGET).decode().strip() == "14cf43ca143cf9a41bf069108d021238e77431af"
manifest, missing = [], set()
for line in git("diff", "--raw", "--no-abbrev", BASE, TARGET).decode().splitlines():
    entry, path = line.split("\t", 1)
    old_mode, mode, old_sha, sha, status = entry.split()
    assert status in ("A", "M") and mode == "100644"
    assert path.startswith(("src/", "tests/", "work-runner/", "supabase/", "docs/", "scripts/", ".github/workflows/")) or path in ("database-contract.json", "release-migrations.json")
    try:
        data = git("cat-file", "blob", sha)
    except subprocess.CalledProcessError:
        missing.add(path)
        continue
    assert blob_hash(data) == sha
    text = data.decode("utf-8")
    result = api("/git/blobs", {"content": text, "encoding": "utf-8"})
    assert result["sha"] == sha
    manifest.append({"path": path, "sha": sha, "mode": mode, "type": "blob"})
assert missing == MISSING and len(manifest) == 74
output = Path(os.environ["RUNNER_TEMP"]) / "imported-source"
output.mkdir(exist_ok=True)
(output / "manifest.json").write_text(json.dumps({"source": TARGET, "base": BASE,
    "imported": manifest, "unrecoverable_tests": sorted(missing)}, indent=2))
print(f"Imported {len(manifest)} exact source blobs. Seven test blobs require reconstructed coverage. No branch reference changed.")
