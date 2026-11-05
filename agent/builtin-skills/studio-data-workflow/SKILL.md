---
name: studio-data-workflow
description: Manage Studio structure, trajectory, dataset, potential and bias assets with ASE inspection, bounded previews and explicit analysis requests; avoid inventing files, credentials or future DFT execution.
---

# Assets and structure inspection in Studio

Use actual registered assets and supplied paths. inspect_asset checks structures/datasets; read_project_input reads bounded text or binary metadata without deserializing a model. create_structure supports bounded ASE bulk, molecule, surface, explicit or authorized import recipes. suggest_parameters derives facts from the resulting real structure, preserving user intent. Read the saved structure back and check composition, atom order, cell and PBC before using a preview as input evidence.

Keep generated inputs in the conversation-owned authoring root. Existing updates need read-back SHA; metadata and a displayed path do not prove a file was generated. Missing future artifacts remain missing. A preview is not a relaxation or scientific validation. The current viewer is a lightweight structure/trajectory preview; do not claim OVITO integration or unsupported editing.

For Materials Project, use only an explicitly configured account key through the designated settings/credential mechanism; never request the key in chat or paste it into files. Without a configured key, continue supported ASE/local structure preparation and state the blocked query.

Choose the specialized pyGAS trajectory, WTMetaD reweighting or OPES skill for requested analysis. Retain the distinction between CV logs, deposited hills, state checkpoints and trajectories; ask for unresolved scientific definitions. Associate outputs with their source run, hashes, units and analysis assumptions. Capability guidance from a source skill does not imply a dedicated executable adapter exists.

Cross-module DFT/active-learning requests are reviewable requests until their executors exist and are explicitly selected. Do not fabricate submissions or returned labels. Human review and project authorization continue to govern computation. Keep real run state, original assets and private connection information intact.
