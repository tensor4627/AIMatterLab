---
name: studio-data-workflow
description: Manage AIMatterLab structure, trajectory, dataset, potential and bias assets with ASE inspection, bounded previews and explicit analysis requests; avoid inventing files, credentials or future DFT execution.
---

# Assets and structure inspection in AIMatterLab

Use actual registered assets and supplied paths. inspect_asset checks structures/datasets; read_project_input reads bounded text or binary metadata without deserializing a model. create_structure supports bounded ASE bulk, molecule, surface, explicit or authorized import recipes. suggest_parameters derives facts from the resulting real structure, preserving user intent. Read the saved structure back and check composition, atom order, cell and PBC before using a preview as input evidence.

Keep generated inputs in the conversation-owned authoring root. Existing updates need read-back SHA; metadata and a displayed path do not prove a file was generated. Missing future artifacts remain missing. A preview is not a relaxation or scientific validation. The current viewer is a lightweight structure/trajectory preview; do not claim OVITO integration or unsupported editing.

For Materials Project call `search_materials_project` with an exact formula or mp-ID in `query`. Select the intended phase from its returned candidates. Use `import_materials_project` with its `material_id`, the authorized `project_id` and `environment_id`, then inspect the saved extxyz and provenance. The desktop also offers these actions on the assets page. The main process uses a configured key. If the key is missing, point to **设置 → 数据源** and continue any requested local ASE work. Keep the key out of chat and inputs.

For atom number density from a timestamped, fully periodic extended XYZ trajectory, use the registered `trajectory.density` engine. It writes `density.csv` with time, atom count, volume and atom number per unit volume. Use `workflow.roadmap` when connecting it to GPUMD MD. For general trajectory/CV analysis, WTMetaD reweighting or OPES, choose the appropriate pyGAS function and respect its source-sharing scope. Associate outputs with their source run, hashes, units and assumptions.

Cross-module DFT/active-learning requests are reviewable requests until their executors exist and are explicitly selected. Do not fabricate submissions or returned labels. Human review and project authorization continue to govern computation. Keep real run state, original assets and private connection information intact.
