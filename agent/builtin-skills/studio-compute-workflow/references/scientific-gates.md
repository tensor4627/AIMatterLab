# Scientific gates for a short sampling test

Use real registered implementations, fixtures and public APIs. The relevant gate must load the **saved serialized artifact**, a representative structure and real target neighbors. A successful build or an import is insufficient.

- Audit structure hash, atom count/order, model species and units; record CV order, atom selection semantics, PBC, cutoff and neighbor/history capacities.
- Validate CV reference values and finite bias, force and virial in the selected environment. Use finite differences where the fixture provides a reference. Do not invent missing references or labels.
- Default deployment artifact is `.pt`. If the user explicitly selects `.pt2`, verify its manifest, CUDA/PyTorch/LibTorch/toolchain and capacity contract. Incompatibility fails visibly; never switch the selected backend silently.
- `gpumd.sampling` requires the matching GPU-Sampling executable, actual GPUMD input/config and the precise bias artifact. `pydyn.sampling` requires a separate sampling-capable PyDyn registration, its matching pyGAS source and sampling API. Do not replace one route with the other to make its test green.
- MetaD/WTMetaD state and hills belong to the individual run. One walker is the default. Resume requires that engine's actual restart contract, not simply rerunning the input. OPES has an independent state/restart/reweighting contract.
- Keep a pilot short with explicit steps, GPU resources and wall time. Record actual finite CV/bias/hill outputs, engine termination and returned artifacts. Distinguish sampling progress from equilibrated statistics.
- FES or reweighting analysis must state its method, temperature, units, binning and applicability; an attractive curve is not evidence of convergence. Missing trajectory/hills cannot be synthesized.

Training, active learning, DFT review requests and NEB may be proposed only when actually required and supported. A module listed in the UI does not prove its adapter is available. Data processing can reuse existing user assets without rerunning optional upstream stages.

## Native GPU-Sampling NEB

Use `gpumd.neb` with the registered `gpu-sampling` executable and Python/ASE. This native route consumes `run.in`, snapshotted NEP potential and endpoint text XYZ files (`is.xyz`/`fs.xyz` by default), or an explicit XYZ path. It does not require a pyGAS bias. Exactly one `neb_run fire <force_tolerance> <max_steps>` is allowed. Place optional reviewed controls in `parameters.neb` (`optimizer`, `force_tolerance`, `max_steps`, `interpolate`, `cell_mode`, `pressure_gpa`, `climb`, `ina`, `need_relax`); they must match the actual input. Every referenced file must be an immutable input. Check atom count/element order/PBC, finite nonsingular geometry and explicit fixed/variable cell choice. Current Studio audits text XYZ; do not silently convert an explicitly selected binary path.

Return `neb_energies.out` (relative native objective in eV) and `final_traj.xyz`, plus available interpolation/FIRE diagnostics. Reaching max_steps is not force convergence. Variable-cell NEB optimizes the enthalpy objective; distinguish force and optional peak-energy stopping, and report image count changes. A saved path is not a FIRE optimizer checkpoint. PyDyn NEB remains unregistered.


## Source-backed authoring and structure assets

Use list_source_projects / inspect_source_project before defining pyGAS CVs. The AST catalog contains the selected checkout's real constructors, forwards and hashes. render_pygas_workflow uses that checkout's graph catalog/renderer to produce source, not a natural-language CV placeholder. The renderer saves the graph and build source as project inputs and returns paths/hashes/preview, avoiding model copying of generated code; the resulting pygas.build task may run within the current user delegation and existing project/resource authorization. Generated scripts carry a source identity gate: the registered pyGAS checkout must match and remain unchanged. A rendered graph is not a built or target-validated artifact. Standalone pyGAS and PyDyn's embedded copy remain separate.

create_structure prepares ASE bulk, molecule, surface, explicit or imported structures as actual extxyz assets. It records ASE/reference defaults, preserves atom order, reloads the result and checks finite geometry, periodic cells and overlap. suggest_parameters derives facts from this real asset, preserves supplied intent and marks pilot heuristics as proposals. Choose reversible technical defaults without asking again; discuss unresolved scientific intent (phase, event/CV, atom groups, thermodynamic target) only when it cannot be established. A database geometry or pilot timestep is not a potential or production validation.

Materials Project search/import tools use a private main-process key and the official summary endpoint. Missing key means blocked; never invent material IDs or pretend a search ran. Inspect candidate phase/symmetry before selecting. Import rejects disordered/partially occupied sites rather than silently rounding occupancy, retains database ID/origins/retrieval/hash, then uses ASE checks. No key travels to the model, worker, SSH job or reproduction bundle.

Use diagnose_tools and exact-engine probe_environment to separate source/executable discovery, runtime imports and real scientific checks. TorchNEP/NEPMaker/ActiveMiao remain planned adapters until implemented; finding a checkout does not make a training/active-learning route available.
