import re
from pathlib import Path


def check_gascfg(directory, parameters):
    directory = Path(directory)
    values = {}
    for line in (directory / "GAScfg.yaml").read_text().splitlines():
        match = re.match(r"\s*([A-Za-z_]+)\s*:\s*([^#]+)", line)
        if match:
            values[match[1]] = match[2].strip()
    for name in ("max_cv_nums", "cv_size", "cv_storage_interval", "cv_change_interval",
                 "cv_log_interval", "neighbor_rc", "max_neighbors", "n_atoms"):
        try:
            if float(values[name]) <= 0:
                raise ValueError()
        except (KeyError, ValueError):
            raise ValueError("GAScfg requires a positive " + name) from None
    if int(values["cv_size"]) != int(parameters["cv_size"]):
        raise ValueError("GAScfg cv_size does not match the declared CV vector")
    if float(values["neighbor_rc"]) < float(parameters["cutoff"]):
        raise ValueError("GAScfg neighbor_rc is smaller than the CV cutoff")
    structure = directory / parameters["structure_file"]
    if structure.suffix.lower() == ".xyz":
        if int(values["n_atoms"]) != int(structure.read_text().splitlines()[0]):
            raise ValueError("GAScfg n_atoms does not match the structure")
    bias = parameters["bias_file"]
    lines = (directory / "run.in").read_text().splitlines()
    if not any(re.match(rf"\s*(GASMD|MetaD|OPES)\s+{re.escape(bias)}\s+GAScfg\.yaml(?:\s|$)", l)
               for l in lines):
        raise ValueError("run.in must load the exact declared bias and GAScfg.yaml")
    if parameters["mode"] == "opes" and not any(re.match(r"\s*OPES\s", l) for l in lines):
        raise ValueError("Independent OPES must use the OPES route")
