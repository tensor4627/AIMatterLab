"""Audit native GPU-Sampling NEB inputs; never manufacture a MetaD bias."""
import math
from pathlib import Path, PurePosixPath

FILES = {"is_name", "fs_name", "mid_name", "traj_name"}
FLAGS = set("need_relax no_vc match_cell_to_initial use_initial_cell no_remove_translation no_remove_rotation find_mic energy_based_spacing energy_based_k climb find_min dyneb dynamic_relaxation no_ina ina_k trim_images count_force_calc print_k".split())
ARITY = {k: 1 for k in "is_name fs_name mid_name traj_name interpolate p cell_factor dist_ncount k energy_spacing_damping energy_k_damping energy_spacing_dist_power tangent scale_fmax dyneb_energy_exponent dyneb_peak_width etol ina_memory_guard ina_memory_reserve_mb ina_interval ina_local_relax_steps ina_local_relax_neighbors ina_k_efficient ina_insert_midpoint_weight trim_similar_tol trim_etol ina_check_coord inacc_num inacc_rc peek_interval dump_interval print_interval ina_force_tol active_atom_threshold diagnostic_interval".split()}
ARITY.update({"p3": 3, "p6": 6, "dist_range": 2, "energy_spacing_coeff": 2, "energy_k_coeff": 2, "energy_convergence": 2})

def relative(value, inputs):
    p = PurePosixPath(value)
    if p.is_absolute() or ".." in p.parts or "\\" in value or not p.parts:
        raise ValueError("NEB references must stay in the immutable input directory")
    name = str(p)
    if name not in inputs:
        raise ValueError("NEB references an input that was not snapshotted: " + name)
    return name

def contract(directory, inputs, declared=None):
    declared = declared or {}
    if not isinstance(declared, dict):
        raise ValueError("NEB parameters must be an object")
    directory = Path(directory)
    rows = [x.split("#", 1)[0].split() for x in (directory / "run.in").read_text().splitlines()]
    runs = [r for r in rows if r and r[0] == "neb_run"]
    if len(runs) != 1 or any(r and (r[0] == "run" or r[0].startswith("minimize")) for r in rows):
        raise ValueError("Use exactly one neb_run without an MD/minimize run")
    run = runs[0]
    if len(run) < 4 or run[1] != "fire":
        raise ValueError("Selected native NEB requires neb_run fire <force_tolerance> <max_steps>")
    tolerance, steps = float(run[2]), int(run[3])
    if not math.isfinite(tolerance) or tolerance <= 0 or steps <= 0:
        raise ValueError("NEB force tolerance and maximum steps must be positive and finite")
    settings = {}; pressure = [0.0]
    for row in rows:
        if not row or row[0] != "neb_set":
            continue
        i = 1
        while i < len(row):
            key = row[i]; i += 1
            if key in FLAGS:
                settings[key] = True
                continue
            n = len(row)-i if key == "mid_name_list" else ARITY.get(key)
            if n is None or n < 1 or i+n > len(row):
                raise ValueError("Unsupported or incomplete NEB option in input audit: " + key)
            values = row[i:i+n]; i += n
            if key not in FILES | {"mid_name_list", "tangent"}:
                numbers = [float(v) for v in values]
                if not all(math.isfinite(v) for v in numbers):
                    raise ValueError("Nonfinite NEB setting: " + key)
            settings[key] = values
            if key in ("p", "p3", "p6"):
                pressure = [float(v) for v in values]
    for row in rows:
        if row and row[0] == "output_format" and row[1:] != ["xyz"]:
            raise ValueError("AIMatterLab native NEB currently audits text XYZ; binary paths need their explicit reader contract")
    potentials = [relative(r[1], inputs) for r in rows if len(r) > 1 and r[0] == "potential"]
    if not potentials:
        raise ValueError("NEB requires an explicitly snapshotted potential")
    names = lambda key, default: settings.get(key, [default])[0]
    trajectory = settings.get("traj_name", [None])[0]
    if trajectory:
        structures = [relative(trajectory, inputs)]
    else:
        structures = [relative(names("is_name", "is.xyz"), inputs), relative(names("fs_name", "fs.xyz"), inputs)]
        if "mid_name" in settings:structures += [relative(settings["mid_name"][0], inputs)]
        if "mid_name_list" in settings:structures += [relative(x, inputs) for x in settings["mid_name_list"]]
    if any(Path(x).suffix.lower() != ".xyz" for x in structures):
        raise ValueError("AIMatterLab NEB structure audit requires explicit text .xyz inputs")
    interpolation = int(settings.get("interpolate", ["0"])[0])
    if interpolation < 0:raise ValueError("NEB interpolation count cannot be negative")
    hydro = pressure[0] if len(pressure) == 1 else (pressure[0] if pressure[:3] == [pressure[0]]*3 and all(v==0 for v in pressure[3:]) else None)
    actual = {"optimizer":"fire", "force_tolerance":tolerance, "max_steps":steps,
              "interpolate":interpolation, "cell_mode":"fixed" if settings.get("no_vc") else "variable",
              "pressure_gpa":hydro, "pressure_components_gpa":pressure, "climb":bool(settings.get("climb")),
              "ina":not settings.get("no_ina", False), "need_relax":bool(settings.get("need_relax")),
              "match_cell_to_initial":bool(settings.get("match_cell_to_initial") or settings.get("use_initial_cell")),
              "potential_files":potentials, "structure_files":structures, "trajectory_input":bool(trajectory)}
    actual["initial_file"] = structures[0]
    actual["final_file"] = structures[1] if not trajectory else None
    actual["potential_file"] = potentials[0] if len(potentials)==1 else None
    for key,value in declared.items():
        if key not in actual or actual[key] != value or (isinstance(value,bool) != isinstance(actual[key],bool)):
            raise ValueError("Declared NEB parameter differs from run.in or is unsupported: " + key)
    return actual

def validate(payload):
    from ase.io import read
    import numpy as np
    directory = Path(payload["directory"])
    actual = contract(directory, payload["inputs"], payload.get("declared"))
    frames=[]
    for name in actual["structure_files"]:
        values=read(directory/name, index=":" if actual["trajectory_input"] else 0)
        frames.extend(values if isinstance(values,list) else [values])
    if len(frames)<(3 if actual["trajectory_input"] else 2):
        raise ValueError("NEB needs two endpoints or a trajectory with at least three images")
    if not actual["ina"] and len(frames)+actual["interpolate"]<3:
        raise ValueError("NEB without INA requires at least three initial images")
    first=frames[0]
    if not len(first):raise ValueError("NEB structures must contain atoms")
    for atoms in frames:
        if len(atoms)!=len(first) or not np.array_equal(atoms.numbers,first.numbers):
            raise ValueError("NEB images differ in atom count or element order")
        if not np.array_equal(atoms.pbc,first.pbc):raise ValueError("NEB image PBC differs")
        if not np.isfinite(atoms.positions).all() or not np.isfinite(atoms.cell.array).all() or abs(atoms.cell.volume)<1e-12:
            raise ValueError("NEB image has nonfinite geometry or singular cell")
        if actual["cell_mode"]=="fixed" and not np.allclose(atoms.cell.array,first.cell.array,rtol=0,atol=1e-8):
            if not actual["match_cell_to_initial"]:
                raise ValueError("Fixed-cell NEB needs matching cells or an explicit cell mapping")
    for name in actual["potential_files"]:
        header=(directory/name).read_text().splitlines()[0].split()
        if header and header[0].startswith("nep"):
            if len(header)<2 or not set(first.get_chemical_symbols()) <= set(header[2:2+int(header[1])]):
                raise ValueError("NEB potential species do not cover the structures")
    return {"status":"passed", "scientific_status":"not_run", "neb":actual, "n_atoms":len(first), "input_frames":len(frames),
            "scope":"Native NEB input references, declared controls, first-frame endpoint or full trajectory geometry and element order; optimizer convergence requires actual execution"}
