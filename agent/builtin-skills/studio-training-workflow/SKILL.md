---
name: studio-training-workflow
description: Prepare NEP or HotPP training, independent evaluation and model export from audited datasets; keep labels, splits, consumer format and unavailable trainers explicit.
---

# Training and evaluation in AIMatterLab

Use `describe_engine` for `nep.train`, `nep.eval`, `nep.analyze`, `hotpp.train`, `hotpp.eval` or `hotpp.export`. For a requested run reuse the current registered environment and check the selected route. `training.torchnep`, `learning.nepmaker` and `learning.activemiao` provide planning references. Their source or CLI guidance can inform a draft. The built-in worker has no corresponding training or orchestration adapter.

Inspect actual dataset assets, species, units and energy/force/virial labels. Record hashes and disjoint train/validation/test identities. Keep independent test data separate and honor sealed-test restrictions. Missing virial labels cannot produce a virial RMSE. Existing model or dataset inputs should be reused rather than regenerated.

Prepare real trainer configurations and file paths within the authorized workspace. Reuse traceable values and derive technical wrapper keys from the engine contract. Ask about unresolved scientific objectives or conflicting data. Label a small demonstrator clearly. Preserve the workflow if one exists. Use the authorized compute route for a delegated independent job. Continue checks and repair within scope, including explicit draft-only and no-run limits.

Checkpoint, full eager model and deployment export are different assets. HotPP export must match the consumer and atomic-number convention; use the actual selected export mode and then validate with that MD environment. Native NEP models retain their species order and native format. Export completion does not prove compatibility without a consumer check.

Read actual training exits, curves, selected checkpoint and independent evaluation output. Report per-split energy/force and only available virial metrics with units and counts. Test-fit quality, resumed-training compatibility and MD physical behavior are separate claims. Preserve all input provenance and never automatically retrain or access a sealed set to improve a reported result.


The selected route supplies exactly one matching reference: `references/native_nep.json`, `references/hotpp.json`, `references/torchnep.json` or `references/active_learning.json`. Read that supplied reference for source-pinned baseline hazards and basic/detail ordering. Do not load references for unrelated trainers. It is a compact AIMatterLab-authored reference, not permission to copy old defaults into a different registered version. Resolve actual consumed CLI/YAML/nep.in fields from the current source first. HotPP `Data.testSet` is training validation; final independent evaluation is separate. For the source revision identified in the TorchNEP reference, a fresh run defaults to CUDA FP32 and CUDA Graph. The CLI reserves the validation fraction and skips validation when no validation file exists. Use `--restart` for NEP text weights or `--resume` for the full epoch-boundary checkpoint. Read the selected package's advertised operation separately from the built-in adapter catalog. Native NEP generation/SNES and TorchNEP epoch/Adam are different semantics. A planned adapter stays unavailable even if a tutorial/CLI exists. Keep actual upstream names in fields and fold optional architecture/loss/optimizer details instead of asking the user to re-learn invented aliases.
