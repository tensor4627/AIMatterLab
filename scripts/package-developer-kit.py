"""Build or verify the portable developer skill ZIP using its tracked source files."""

import argparse
import io
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parent.parent
SKILL = PurePosixPath("developer/skills/studio-tool-integration")
ARCHIVE = ROOT.joinpath(*SKILL.parts).with_suffix(".zip")


def source_files():
    tracked = subprocess.check_output(["git", "-C", str(ROOT), "ls-files", "-z", "--", SKILL.as_posix()])
    files = {}
    for name in sorted(set(tracked.decode("utf-8").split("\0")) - {""}):
        relative = PurePosixPath(name).relative_to(SKILL)
        source = ROOT.joinpath(*PurePosixPath(name).parts)
        if source.resolve() != source or not source.is_file():
            raise ValueError(f"Developer skill source must be a regular file: {name}")
        files[(PurePosixPath(SKILL.name) / relative).as_posix()] = source.read_bytes()
    if not files:
        raise ValueError("No tracked developer skill sources found")
    return files


def archive_bytes(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, contents in files.items():
            # Fixed ZIP metadata and stored bytes are independent of file timestamps,
            # checkout permissions, operating system, and compression library version.
            entry = zipfile.ZipInfo(name)
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, contents)
    return output.getvalue()


def verify_archive(expected, files):
    current = ARCHIVE.read_bytes()
    if current == expected:
        return
    with zipfile.ZipFile(io.BytesIO(current)) as archive:
        members = [entry for entry in archive.infolist() if not entry.is_dir()]
        actual = {entry.filename: archive.read(entry) for entry in members}
    differences = {
        "missing": sorted(files.keys() - actual.keys()),
        "extra": sorted(actual.keys() - files.keys()),
        "different": sorted(name for name in files.keys() & actual.keys() if files[name] != actual[name]),
        "duplicates": len(members) - len(actual),
    }
    raise ValueError("Developer kit ZIP differs from generated archive. " + json.dumps(differences))


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog="Sync canonical resources with node scripts/sync-tool-contracts.mjs before generating the ZIP.")
    parser.add_argument("--check", action="store_true", help="compare without writing")
    args = parser.parse_args()
    try:
        files = source_files()
        expected = archive_bytes(files)
        if args.check:
            verify_archive(expected, files)
        else:
            with tempfile.NamedTemporaryFile(dir=ARCHIVE.parent, suffix=".tmp", delete=False) as temporary:
                staging = Path(temporary.name)
            try:
                staging.write_bytes(expected)
                os.replace(staging, ARCHIVE)
            finally:
                staging.unlink(missing_ok=True)
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        parser.exit(1, f"{error}\nRun node scripts/sync-tool-contracts.mjs and then package-developer-kit.py to regenerate the ZIP.\n")
    print(json.dumps({"status": "checked" if args.check else "generated", "files": len(files)}))


if __name__ == "__main__":
    main()
