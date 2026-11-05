"""Bounded IO and process identity helpers (Python 3.10+)."""
import hashlib
import json
import os
import subprocess
from pathlib import Path


def atomic_json(path, value):
    path = Path(path)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def contained(path, roots):
    candidate = Path(path).expanduser().resolve()
    if not any(candidate == Path(root).expanduser().resolve() or
               Path(root).expanduser().resolve() in candidate.parents for root in roots):
        raise ValueError("Path is outside the authorized roots")
    return candidate


def leaf(name):
    if not isinstance(name, str) or not name or name in (".", "..") or "/" in name or "\\" in name:
        raise ValueError("Input names must be simple file names")
    return name


def identity(pid):
    if os.name != "posix" or not Path("/proc").exists():
        return None
    try:
        raw = Path(f"/proc/{int(pid)}/stat").read_text()
        fields = raw[raw.rfind(")") + 2:].split()
        if fields[0] == "Z":
            return None
        return {"pid": int(pid), "start": fields[19],
                "boot": Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
    except (OSError, ValueError, IndexError):
        return None


def alive(expected):
    return bool(expected and identity(expected["pid"]) == expected)


def run_json(python, module_file, command, payload, env=None, timeout=90):
    try:
        result = subprocess.run([python, str(module_file), command], input=json.dumps(payload),
                                text=True, capture_output=True, env=env, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        detail = exc.stderr or b""
        if isinstance(detail, bytes):
            detail = detail.decode("utf-8", errors="replace")
        raise ValueError(f"Scientific {command} timed out after {timeout}s; last diagnostics: {detail[-4000:]}") from exc
    if result.returncode:
        stderr = result.stderr if len(result.stderr) <= 6000 else result.stderr[:2000] + "\n... diagnostic tail ...\n" + result.stderr[-4000:]
        raise ValueError(f"Scientific {command} exited with code {result.returncode}; stderr: {stderr}\nstdout: {result.stdout[-2000:]}")
    lines = result.stdout.strip().splitlines()
    if not lines:
        raise ValueError("Scientific check returned no result")
    return json.loads(lines[-1])
