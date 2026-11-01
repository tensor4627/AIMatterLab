---
name: studio-md-workflow
description: Prepare and review PyDyn or GPUMD molecular dynamics from existing or ASE-created structures and a compatible potential; route enhanced sampling to pyGAS without confusing authoring with execution.
---

# Molecular dynamics in Studio

Resolve the requested engine from the user's task and registered capabilities: pydyn.md, gpumd.md, pydyn.sampling or gpumd.sampling. Use describe_engine for its current input and parameter contract. Source registration supplies authoring information; the selected compute environment must independently pass probe_environment for that engine. Never switch an engine checkout or choose a different registered version silently.

Use inspect_asset for a supplied structure or create_structure for a user-delegated ASE recipe, then suggest_parameters with the actual structure. Preserve atom order, cell, PBC, temperature and units. Check the potential's species and intended consumer; checkpoint, eager and deployment models are distinct. HotPP consumers need a matching atomic-number convention. Never infer a scientifically meaningful CV or atom group just from a molecule name.

Keep the same conversation-owned workflow. Use read_project_input and its SHA before changing existing inputs; write actual driver/config text with write_project_input and present_task with the saved paths, clear scientific parameters and provenance. Ask only about unresolved physical intent. An illustrative pilot needs an explicit label and does not establish production settings.

For sampling, use the task's specialized pyGAS CV/bias/OPES skill. Preserve selected artifact format; an incompatible .pt2 must fail without fallback. The saved artifact and real target environment require independent validation before execution.

For native `gpumd.sampling`, read [the bounded native-input planning contract](references/gpumd-native-input.json) when the `sampling.gpumd` route attaches it. It supplies flat GAScfg serialization, independent OPES grammar, planned seed semantics and initial-evaluation/log timing; inspect its current source evidence. Preserve actual manifest/structure bounds and user controls instead of mixing parser/writer defaults or confusing common history fields with OPES capacity/PACE. A source-supported planned seed line does not prove target acceptance, deterministic replay or build correspondence; existing structure velocities still take precedence.

Complete mechanically authorable `run.in` and `GAScfg.yaml` with existing authorized write/readback tools and publish their actual hashes in the same task. Keep target/build uncertainty explicit for review; only a user-imposed target-test-before-seed condition leaves that particular seed decision pending. Do not replace native files with a review note or turn unresolved software mechanics into user scientific fields. Draft-only authoring does not authorize running the referenced writer script, loading models, probing, Prepare or execution.

Studio review and execution remain human actions. Do not validate/submit or change project authorization through skill instructions. Show the next required user action and the actual current parameter/prepared revision. Monitor only the returned run identity; unknown never means resubmit. Inspect real exits, finite thermo/trajectory outputs and checkpoint capability before reporting success. A short numerical run is not physical validation.
