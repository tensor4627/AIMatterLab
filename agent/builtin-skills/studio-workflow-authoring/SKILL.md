---
name: studio-workflow-authoring
description: Author real scientific inputs, reviewable values and pyGAS graphs in the current AIMatterLab workflow.
---

# Author scientific inputs in the current workflow

1. Use the desktop's current authoring workspace and the same `studioTaskId`. Read saved assets, parameters and manual edits. When setting a previously empty engine, save an honest scaffold with `present_task`, the selected `parameters.engine` and the actual `parameters.files` before requesting its environment API.
2. Match the goal to the actual `describe_engine` contract and tool I/O. Preserve the user's physical choices. Derive topologies, indices, shape, units and paths from the real source or inputs. Ask about consequential unresolved physical choices after completing independent preparation. Label a proposed pilot and record its basis.
3. Prepare real files and bind their returned paths. On updates, read the current revision, use its SHA-256 with `write_project_input` (or the graph/source CAS for pyGAS), then read the saved file back. Reconcile conflicts in the same task. Keep the real files and form synchronized.
4. Publish `present_task` with the saved paths, editable values in `parameters`, form metadata in `steps` and unresolved items in `missing_fields`. Place provenance and checks in evidence or step notes. Keep `parameters.validation` restricted to the actual engine's `validation_controls`.
5. A draft-only request ends with saved authoring materials. Continue into review, build and execution only within the current delegation and target grants. Keep source-derived authoring and actual artifact, runtime and scientific evidence separate.

Read only the needed document ID from `workflow.authoring`.

- [Files, assets and target APIs](references/input-files.md) for exact file copy, same-task revision updates, topology and version-bound API evidence.
- [Parameter form and review](references/review-form.md) for choosing questions, defaults, evidence, reviewable fields and authoring-stage limits.
- [pyGAS graph authoring](references/pygas-graphs.md) for topology, graph shape, versioned renderer semantics and saved graph/source identity.

Use `workflow.roadmap` for deliverables, producers, graph I/O and frozen run receipts. For an authorized independent job in chat, use `cluster.lsf-slurm-deployment`.
