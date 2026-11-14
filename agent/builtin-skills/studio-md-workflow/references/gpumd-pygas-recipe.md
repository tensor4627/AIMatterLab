# Fixed NEP + serialized pyGAS bias + GPU-Sampling

This recipe describes a file handoff between a pyGAS producer and a registered `gpumd.sampling` consumer. The Python producer and native consumer may use different environments. A successful Python export does not prove that the native binary can load it.

## Resolve actual inputs

Read `describe_engine` for `pygas.build` and `gpumd.sampling`, the current workflow, project authorization, and registered environment. Keep the selected versions and explicit artifact format. Record the registered executable and actual prepared input identities; do not silently select another binary, engine checkout or model.

Use the user's structure and fixed NEP potential with their intended species and units. The paired bias manifest, CV dimensions, atom indices, PBC convention and cutoff must describe the actual serialized artifact and structure. An existing artifact can be inspected and used directly. If the workflow calls for building one, save the pyGAS composition and real build script, execute its `pygas.build` attempt in the authorized producer environment, and read the returned artifact and manifest. Keep the failed build attempt when a repair is needed.

## Prepare the consumer

The native input set normally includes `run.in`, `model.xyz`, `GAScfg.yaml`, the fixed NEP file and the selected bias artifact. Use the engine contract's actual filenames and parameter keys; retain every dependency declared by the input files. Read the native-input reference before writing GAS configuration. Do not infer the CV or scientific settings from a filename.

Record these dependencies in the same conversation-owned workflow. Copy/adopt the artifact through the existing project-scoped artifact path when crossing producer and consumer input roots, retaining the source run and hash. A model file produced in one environment is not a shared Python dependency installation in another.

Prepare a new immutable attempt. Scientific review can remain `not_run` or contain findings. The submit path independently checks project permission, actual snapshots and the serialized artifact against the target. An explicit `.pt2` failure stays an AOTI failure; do not substitute `.pt` or another backend.

## Run, inspect and repair

Within the current delegation, submit and monitor only the returned run. A short pilot can be useful when asked to establish basic integration; choose its length from the task rather than imposing a fixed pilot on every calculation. For a first integration check, inspect the actual process exit, native model-load messages and finite CV/thermo output with the expected dimensions and step convention.

On an explicit failure, read its error and files, repair the authorized next draft and prepare a new attempt. Keep the original command, input hashes and error. On an unknown submission, query the original run and scheduler identity; do not submit an identical replacement. Other independent work remains available. A successful exit is separate from scientific validation, convergence and physical applicability.

Collect metadata while the producer is active. Request stable hashes only for artifacts being adopted or exported, then verify that their recorded hashes and bytes agree. Reproduction exports list actual input, result and log files plus omissions; an omitted large trajectory is not present merely because its metadata appears in the export.

## Evidence boundary

The Studio review exercised this route with an existing registered native binary, fixed NEP and an existing serialized TorchScript artifact for a 100-step integration example. It observed successful native loading and finite CV output while leaving scientific review as `not_run`. This supports that exact file handoff and execution path. It does not establish a new pyGAS export, arbitrary combinations, AOTI compatibility, restart equivalence, native finite-difference parity, or physical validity. Establish the additional evidence appropriate to the actual task.
