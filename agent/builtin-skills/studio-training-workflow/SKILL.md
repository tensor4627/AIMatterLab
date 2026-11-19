---
name: studio-training-workflow
description: Prepare NEP or HotPP training, independent evaluation and model export from audited datasets; keep labels, splits, consumer format and unavailable trainers explicit.
---

# Training and evaluation in AIMatterLab

Use describe_engine for the requested implemented route: nep.train, nep.eval, nep.analyze, hotpp.train, hotpp.eval or hotpp.export. Probe its registered environment. TorchNEP source discovery is not a training adapter; NEPMaker and ActiveMiao orchestration are not implemented merely because they appear in a task diagram.

Inspect actual dataset assets, species, units and energy/force/virial labels. Record hashes and disjoint train/validation/test identities. Keep independent test data separate and honor sealed-test restrictions. Missing virial labels cannot produce a virial RMSE. Existing model or dataset inputs should be reused rather than regenerated.

Prepare real trainer configurations and file paths within the authorized workspace. Reuse traceable values and derive technical wrapper keys from the engine contract. Ask about unresolved scientific objectives or conflicting data. Label a small demonstrator clearly. Preserve the workflow if one exists. Use the authorized compute route for a delegated independent job. Continue checks and repair within scope, including explicit draft-only and no-run limits.

Checkpoint, full eager model and deployment export are different assets. HotPP export must match the consumer and atomic-number convention; use the actual selected export mode and then validate with that MD environment. Native NEP models retain their species order and native format. Export completion does not prove compatibility without a consumer check.

Read actual training exits, curves, selected checkpoint and independent evaluation output. Report per-split energy/force and only available virial metrics with units and counts. Test-fit quality, resumed-training compatibility and MD physical behavior are separate claims. Preserve all input provenance and never automatically retrain or access a sealed set to improve a reported result.


The selected route supplies exactly one matching reference: `references/native_nep.json`, `references/hotpp.json`, `references/torchnep.json` or `references/active_learning.json`. Read that supplied reference for source-pinned baseline hazards and basic/detail ordering. Do not load references for unrelated trainers. It is a compact AIMatterLab-authored reference, not permission to copy old defaults into a different registered version. Resolve actual consumed CLI/YAML/nep.in fields from the current source first. HotPP `Data.testSet` is training validation; final independent evaluation is separate. TorchNEP's reserved validation fraction does not create a split and weight restart is not full optimizer resume. Native NEP generation/SNES and TorchNEP epoch/Adam are different semantics. A planned adapter stays unavailable even if a tutorial/CLI exists. Keep actual upstream names in fields and fold optional architecture/loss/optimizer details instead of asking the user to re-learn invented aliases.
