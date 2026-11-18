"""Build the offline diagnostic index from one Git tree, without running that revision's code."""

import argparse
import ast
import json
import os
import re
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

from decisions import categories, classify, decisions


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
JS = {".js", ".jsx", ".cjs", ".mjs", ".ts", ".tsx", ".mts", ".cts"}
WRAPPERS = {".py", ".ps1", ".nsh", ".cmd", ".sh"}
TOOL_SCRIPTS = set("""
build-cli-installer check-aimlab-adapter-conformance check-aimlab-parity check-aimlab-tools
cli-archive-source cluster-reconcile desktop-launch dev generate-cli-runtime-lock localize-skill
localize-ui one_prompt package-companions package-runtime protocol sign-windows-setup source-start
stage-agents stage-dsh-runtime start sync-tool-contracts verify-aimlab-sources windows-launch-preflight
windows-release-signature workspace-installer-files
""".split())
EMBEDDED_PYTHON = {
    "backend/main/compute/existing-worker.mjs",
    "developer/skills/studio-tool-integration/scripts/create-cpu-reference.mjs",
}
HINTS = "backend/worker/studio_worker/pygas-editor-hints.json"


def included(name):
    path = Path(name)
    if name == HINTS:
        return True
    if path.suffix not in JS | WRAPPERS or name.endswith((".d.ts", ".d.mts", ".d.cts")):
        return False
    if {"tests", "fixtures", "generated"}.intersection(path.parts):
        return False
    if path.parts[0] == "scripts":
        return len(path.parts) == 2 and path.stem in TOOL_SCRIPTS
    return (path.parts[0] in {"agent", "backend", "contracts", "desktop", "frontend", "installation", "build", "developer"}
            or name in {"Launch-AIMatterLab.cmd", "vite.config.ts"})


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def checkout_sources(revision, destination):
    names = [name for name in git("ls-tree", "-r", "--name-only", "-z", revision).decode().split("\0") if included(name)]
    # Only materialize known product sources. No submodules, hooks, dependencies or release executables.
    with subprocess.Popen(["git", "cat-file", "--batch"], cwd=ROOT, stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE) as blobs:
        for name in names:
            blobs.stdin.write(f"{revision}:{name}\n".encode())
            blobs.stdin.flush()
            _, kind, size = blobs.stdout.readline().split()
            if kind != b"blob":
                raise ValueError(f"Expected source blob for {name}")
            body = blobs.stdout.read(int(size))
            if len(body) != int(size) or blobs.stdout.read(1) != b"\n":
                raise ValueError(f"Incomplete source blob for {name}")
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
        blobs.stdin.close()
        if blobs.wait():
            raise RuntimeError("Git could not supply every source")
    return names


def extract(command, names, source):
    proc = subprocess.run(command, cwd=source, input=json.dumps(names).encode(), capture_output=True,
                          env={**os.environ, "PYTHONUTF8": "1"})
    notes = proc.stderr.decode("utf-8", errors="replace").splitlines()
    if proc.returncode:
        raise RuntimeError("\n".join([*command, *notes]))
    return [json.loads(line) for line in proc.stdout.splitlines() if line], notes


def hint_sites(source):
    body = (source / HINTS).read_text(encoding="utf-8")
    lines = body.splitlines()
    rows = []

    def walk(node, location):
        if isinstance(node, dict):
            if isinstance(node.get("reason"), str):
                encoded = json.dumps(node["reason"], ensure_ascii=False)
                match = next((i for i, line in enumerate(lines) if '"reason"' in line and encoded in line), None)
                if match is None:
                    raise ValueError(f"Could not locate reason in {location}")
                rows.append(dict(path=HINTS, line=match + 1, column=lines[match].index('"reason"') + 1,
                                 owner=location, kind="catalog", signal=node["reason"],
                                 guard=f"{location}.graph_support = {node.get('graph_support')}", key=location.split(".")[-1]))
            for key, item in node.items():
                walk(item, f"{location}.{key}" if location else key)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                walk(item, f"{location}[{i}]")
    walk(json.loads(body), "")
    return rows


QUOTED = r'''(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')'''


def dictionary(source):
    body = (source / "frontend/ui/i18n.ts").read_text(encoding="utf-8")
    pairs = re.findall(f"({QUOTED})\\s*:\\s*({QUOTED})", body)
    return {ast.literal_eval(key): ast.literal_eval(value) for key, value in pairs}


def run(revision, source):
    names = checkout_sources(revision, source)
    js = [name for name in names if Path(name).suffix in JS]
    python = [name for name in names if Path(name).suffix in WRAPPERS or name in EMBEDDED_PYTHON]
    rows, notes = extract(["node", str(HERE / "js-sites.mjs")], js, source)
    other, warnings = extract([sys.executable, str(HERE / "python_sites.py")], python, source)
    rows.extend(other)
    rows.extend(hint_sites(source))
    translations = dictionary(source)
    indices = {name: i for i, name in enumerate(names)}
    review = json.loads((HERE / "reviewed-0.1.13.json").read_text(encoding="utf-8"))
    reviewed = {}
    if revision == review["revision"]:
        for name, families in review["sites"].items():
            for family, positions in families.items():
                for position in positions:
                    key = f"{name}:{position}"
                    if key in reviewed or family not in decisions:
                        raise ValueError(f"Invalid review entry {key}")
                    reviewed[key] = family
    packed = []
    for row in sorted(rows, key=lambda r: (r["path"], r["line"], r["column"], r["kind"], r["signal"])):
        signal = row["signal"]
        strings = [signal, *(v[1:-1] for v in re.findall(QUOTED, signal))]
        en = list(dict.fromkeys(translations[v] for v in strings if v in translations))
        location = f"{row['path']}:{row['line']}:{row['column']}"
        adjudicated = location in reviewed
        family = reviewed.pop(location) if adjudicated else classify(row)
        packed.append([indices[row["path"]], row["line"], row["column"], row["kind"], row["owner"],
                       signal, row["guard"], family, row.get("key", ""), " / ".join(en),
                       review["notes"].get(location, "") if adjudicated else "", adjudicated])
    if reviewed:
        raise ValueError(f"Reviewed sites missing from the extracted source: {', '.join(reviewed)}")
    return dict(revision=revision, files=names, rows=packed, decisions=decisions, categories=categories,
                notes=sorted(set(notes + warnings)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", default="v0.1.13")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    revision = git("rev-parse", "--verify", "--end-of-options", args.revision + "^{commit}").decode().strip()
    with tempfile.TemporaryDirectory() as base:
        data = run(revision, Path(base))
    template = (HERE / "report.html").read_text(encoding="utf-8")
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="\n") as output:
        output.write(template.replace("<!--DIAGNOSTIC_DATA-->", encoded))
    print(json.dumps({"revision": revision, "sources": len(data["files"]), "sites": len(data["rows"]),
                      "kinds": Counter(row[3] for row in data["rows"]),
                      "families": Counter(row[7] for row in data["rows"]), "notes": data["notes"]}))


if __name__ == "__main__":
    main()
