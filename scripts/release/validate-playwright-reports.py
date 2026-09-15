"""Fail closed on missing, duplicate, unsafe, or corrupt Playwright report shards."""
import json
from pathlib import Path, PurePosixPath
import shutil
import sys
import zipfile

EXPECTED = {f"e2e-blob-{shard}" for shard in range(1, 4)} | {
    f"e2e-blob-public-{project}-{shard}"
    for project in ("phone-390x844", "tablet-1024x768", "desktop-1440x900")
    for shard in range(1, 4)
}


def validate(source: Path, destination: Path) -> int:
    if not source.is_dir() or source.is_symlink():
        raise ValueError("Report download directory is missing or unsafe")
    if destination.exists():
        raise ValueError("Report destination must be new")
    entries = list(source.iterdir())
    if {p.name for p in entries} != EXPECTED:
        raise ValueError("Expected all twelve public and core report artifacts")
    reports = []
    for folder in entries:
        if folder.is_symlink() or not folder.is_dir():
            raise ValueError("Unsafe artifact directory")
        files = list(folder.iterdir())
        if len(files) != 1 or files[0].is_symlink() or files[0].suffix != ".zip":
            raise ValueError("Every artifact must contain exactly one report ZIP")
        report = files[0]
        if report.stat().st_size > 100 * 1024 * 1024:
            raise ValueError("Compressed report exceeds its safety bound")
        with zipfile.ZipFile(report) as archive:
            members = archive.infolist()
            names = [member.filename for member in members]
            if names.count("report.jsonl") != 1 or len(names) != len(set(names)):
                raise ValueError("Report journal missing or ZIP members duplicated")
            if sum(member.file_size for member in members) > 512 * 1024 * 1024:
                raise ValueError("Expanded report exceeds its safety bound")
            for member in members:
                path = PurePosixPath(member.filename)
                if path.is_absolute() or ".." in path.parts or "\\" in member.filename:
                    raise ValueError("Unsafe report member")
            if archive.testzip() is not None:
                raise ValueError("Report CRC verification failed")
            methods = set()
            with archive.open("report.jsonl") as journal:
                for line in journal:
                    methods.add(json.loads(line)["method"])
            if not {"onConfigure", "onBegin", "onEnd"}.issubset(methods):
                raise ValueError("Incomplete report journal")
        reports.append((folder.name, report))
    # Do not expose a partial merge input when any preceding check fails.
    destination.mkdir()
    for name, report in reports:
        shutil.copyfile(report, destination / f"{name}.zip")
    return len(reports)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: validate-playwright-reports.py SOURCE NEW_DESTINATION")
    try:
        count = validate(Path(sys.argv[1]), Path(sys.argv[2]))
    except (ValueError, OSError, zipfile.BadZipFile, KeyError) as error:
        raise SystemExit(f"Report validation failed: {error}") from None
    print(f"Validated {count} complete report artifacts; no test result was rewritten")
