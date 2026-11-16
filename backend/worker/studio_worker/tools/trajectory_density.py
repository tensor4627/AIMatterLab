"""Read native GPUMD extended XYZ once, hashing the bytes used for each density sample."""
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import shlex
import stat


COLUMNS = ("time_fs", "atoms", "volume_angstrom3", "number_density_per_angstrom3")


def finite(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite trajectory or output value")
    return number


class ObservedLines:
    def __init__(self, path):
        self.path = Path(path)
        self.stream = None
        self.sha = hashlib.sha256()
        self.size = 0

    def __enter__(self):
        fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        self.stream = os.fdopen(fd, "rb")
        self.before = os.fstat(fd)
        if not stat.S_ISREG(self.before.st_mode):
            self.stream.close()
            raise ValueError("Expected a regular artifact")
        return self

    def line(self):
        raw = self.stream.readline(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("Oversized artifact line")
        self.sha.update(raw)
        self.size += len(raw)
        return raw.decode("utf-8")

    def __exit__(self, kind, *args):
        try:
            if kind is None:
                def identity(info):
                    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns
                if (self.size != self.before.st_size or identity(self.before) != identity(os.fstat(self.stream.fileno()))
                        or identity(self.before) != identity(self.path.lstat())):
                    raise ValueError("Artifact changed during observation")
        finally:
            self.stream.close()


def time_sample(facts, time_fs):
    count = facts["samples"]
    if count == 0:
        facts["first_time_fs"] = time_fs
    else:
        delta = time_fs - facts["last_time_fs"]
        if delta <= 0:
            raise ValueError("Frame times must increase")
        if count == 1:
            facts["interval_fs"] = delta
        elif "interval_fs" in facts and not math.isclose(facts["interval_fs"], delta, rel_tol=1e-7, abs_tol=1e-7):
            del facts["interval_fs"]
    facts["last_time_fs"] = time_fs
    facts["samples"] += 1


def observe_xyz(path, emit=None):
    facts = {"samples": 0}
    with ObservedLines(path) as source:
        while (line := source.line()):
            atoms = int(line)
            if atoms <= 0 or facts.setdefault("atoms", atoms) != atoms:
                raise ValueError("Expected a fixed positive atom count")
            meta = dict(token.split("=", 1) for token in shlex.split(source.line()) if "=" in token)
            lattice = [finite(x) for x in meta["Lattice"].split()]
            if len(lattice) != 9:
                raise ValueError("Expected three lattice vectors")
            a,b,c,d,e,f,g,h,i = lattice
            volume = abs(a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g))
            props = meta["Properties"].split(":")
            if len(props) % 3:
                raise ValueError("Invalid extended XYZ properties")
            offsets = {}
            width = 0
            for name, dtype, size in zip(props[::3], props[1::3], props[2::3]):
                size = int(size)
                if size < 1 or name in offsets:
                    raise ValueError("Invalid property declaration")
                offsets[name] = (width, dtype, size)
                width += size
            if offsets.get("pos", (None,))[1:] != ("R",3) or offsets.get("species", (None,))[1:] != ("S",1):
                raise ValueError("Expected species and Cartesian positions")
            kinds = sorted(offsets)
            if facts.setdefault("fields", kinds) != kinds:
                raise ValueError("Frame properties changed")
            position = offsets["pos"][0]
            for _ in range(atoms):
                row = source.line().split()
                if len(row) != width:
                    raise ValueError("Incomplete atom record")
                for value in row[position:position+3]:
                    finite(value)
            time_fs = finite(meta["Time"])
            time_sample(facts, time_fs)
            if emit is not None:
                if meta.get("pbc","").upper().split() != ["T","T","T"] or not math.isfinite(volume) or volume <= 0:
                    raise ValueError("Number density requires a nonsingular three-dimensionally periodic cell")
                emit((time_fs, atoms, volume, finite(atoms / volume)))
    if not facts["samples"]:
        raise ValueError("Empty trajectory")
    return {"sha256":source.sha.hexdigest(), "size":source.size, "facts":facts}


def main():
    with Path("density.csv").open("x", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(COLUMNS)
        source = observe_xyz("trajectory.xyz", writer.writerow)
    with Path("consumption.json").open("x", encoding="utf-8") as stream:
        json.dump({"schema_version":1,"port":"trajectory","sha256":source["sha256"],
                   "bytes_read":source["size"],"samples":source["facts"]["samples"]},stream)


if __name__ == "__main__":
    main()
