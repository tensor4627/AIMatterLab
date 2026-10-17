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
