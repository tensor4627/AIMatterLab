# Native GPU-Sampling NEB input review

Use the `gpumd.neb` result of `describe_engine` for `parameter_groups.neb`, accepted controls and file bindings. The [engine contract](../../../../contracts/tools/engine-contracts.json) and [worker audit](../../../../backend/worker/studio_worker/tools/neb_checks.py) own this interface. Read them at the running version when behavior differs. Use the actual checked values from `run.in` for any declared `parameters.neb` controls.

## Build the real input snapshot

- Put `run.in`, its matching potential, and either endpoint/optional midpoint XYZ files or a text XYZ path with at least three images in the input snapshot. Native endpoint defaults are `is.xyz` and `fs.xyz`. `is_name`, `fs_name`, `mid_name` or `traj_name` refer to snapshotted input names. Use `mid_name_list` at the end of its `neb_set` row when needed. The audit expects snapshot-relative filenames and explicit text XYZ geometry.
- Choose cell mode, pressure, interpolation count and climbing treatment with the user or from reviewed inputs. `no_vc` sets fixed cell. Matching cells or explicit cell mapping are required for that audit. `p`, `p3` and `p6` set variable-cell pressure in GPa. Preserve the actual pressure components in the declared form. [Pinned GPU-Sampling pressure settings](https://github.com/bigd4/GPUMD/blob/bd719b98f1608e25477c63238c1f42d9a63d3bd1/src/neb/GPU-cfneb_manual.md#L19-L22)
- Use exactly one `neb_run fire <force_tolerance> <max_steps>` with a positive finite force tolerance in eV/Å and a positive integer step limit. MD and minimization belong to their own operations. Preserve image, atom and potential-species consistency. Without INA, endpoints, midpoint images and interpolation must supply at least three initial images. [Pinned GPU-Sampling FIRE parser](https://github.com/bigd4/GPUMD/blob/bd719b98f1608e25477c63238c1f42d9a63d3bd1/src/neb/neb.cu#L1192-L1210)

## Fixed-cell syntax example

This demonstration uses two matching endpoint files and an inventoried `nep.txt`. Replace its numerical values and file bindings with the selected workflow evidence.

```text
potential nep.txt
neb_set no_vc interpolate 3 no_ina
neb_run fire 0.02 50
```

```json
{
  "optimizer": "fire",
  "force_tolerance": 0.02,
  "max_steps": 50,
  "interpolate": 3,
  "cell_mode": "fixed",
  "ina": false,
  "initial_file": "is.xyz",
  "final_file": "fs.xyz",
  "potential_file": "nep.txt"
}
```

A syntactically matching declaration supports preparation. Real structure validation also checks nonempty ordered atoms, finite nonsingular geometry, PBC and potential coverage. Running that exact snapshot, checking reaction-path energies and establishing convergence and applicability remain separate observations.
