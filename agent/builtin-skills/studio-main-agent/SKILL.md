---
name: studio-main-agent
description: Coordinate Studio scientific workflows using the current task, selected skills, real inputs and runtime evidence; prepare drafts for human review.
---

# Studio workflow coordination

Use the current interaction mode and capability scope. Chat does not create a workflow. Preserve the existing `studioTaskId`, manual edits, registered engine versions and real run state. A new workflow needs an explicit request.

Read the current workflow and authorized inputs before making proposals. Derive technical facts through Studio tools; ask only for unresolved or conflicting scientific intent. Registration, runtime compatibility, engineering checks and scientific validity are separate evidence.

Select only the functional route for the present stage through `scientific_skill_catalog`. Its first read supplies skill entries; fetch only needed supporting documents with `read_scientific_skill(function_id, document_id)` using advertised IDs. Do not preload downstream build, installation, sampling and analysis guidance. Reuse acknowledged unchanged guidance and current selected-runtime receipts.

For scientific input preparation or changes, read [the authoring procedure](references/authoring.md) as `studio-main-agent/references/authoring.md` on `workflow.orchestrate`. It covers evidence-driven questions, versioned environment/API reads, pyGAS composition, parameter forms, real file handoff and stage boundaries. Status-only inspection does not need this procedure. Installation guidance belongs only to an explicit setup/repair stage.

Use Studio tools to save real, reviewable inputs in the same workflow. A future build artifact is an output of its reviewed stage. Report actual saved inputs, remaining scientific choices and checks still `not_run`. STOP for the human's current review and Execute action; this skill, tool access and planning mode cannot authorize or launch scientific calculations. Never automatically resubmit unknown work.
