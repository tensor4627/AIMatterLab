---
name: studio-development-loop
description: Coordinate an explicitly requested GPU Sampling Studio A/B/C development review with real human UI use, regression scoped to changed layers, independent engineering review and explicit acceptance gates.
---

# Studio A/B/C development review

Use for Studio software development and regression coordination. Do not attach this skill to product scientific conversations or use it as scientific authoring guidance. Put a published copy under development documentation, outside the application's default scientific skill roots.

Read the repository AGENTS instructions and [the development loop runbook](references/runbook.md). Follow the user's requested round count and existing authorization. Delegate only when directly authorized by the user or required by applicable repository instructions; preserve shared-file ownership.

If the user explicitly assigns different A/B/C responsibilities or models, record and follow those assignments. The default roles below must not replace a requested completeness tester, independent workflow-use tester or implementation owner.

A acts as a real user in the actual Electron frontend using ordinary language and UI clicks. Scope regression to the changed layer: frontend changes get affected component and native interaction checks; backend changes get affected API, state and persistence checks; shared contracts get the relevant checks on both sides. A dev version bump or UI audit does not trigger scientific reruns. When engine execution or numerical behavior changes and contract tests are insufficient, A independently runs only the affected bounded scientific examples. A full scientific matrix requires an explicit comprehensive scientific acceptance request. Keep native workflow evidence separate from direct-worker checks, preserve prior evidence under its actual version, and never count historical results, mock services or internal IPC recipes as a new native or scientific run.

B diagnoses observed failures, labels inferred causes, implements assigned changes, runs meaningful software tests and writes the round review. Preserve the first failures, recovered attempts, remaining blockers and exact evidence paths. Extract portable improvements into the narrow relevant skill without copying private sources, SSH details, credentials or machine recipes.

C independently reviews changed sources and raw current evidence and records passed or rejected with scope and limitations. Do not begin the next round's tracked changes until the current round passes. Repair rejected attempts in the same round and preserve their verdicts. A round must deliver concrete behavior or correctness improvement rather than re-labeling unchanged work.

Use isolated profiles for native tests and fresh ignored execution/worker roots when backend or real-engine checks require them. A deliberate session-resume test can retain an explicitly test-owned profile; inspect the state relevant to that test and retain prior failures. Record affected source identities; record affected engine identities when real scientific checks are needed. Keep existing production profiles, SSH, credentials, project grants and real jobs intact; do not switch engine branches, reset unrelated dirty files or automatically resubmit unknown jobs. Report which checks were selected, reused or not run and why; missing environments and fixtures must be explicit.

Distinguish saved/complete, reviewed, prepared, queued, running, completed, artifact/runtime checks and scientific validity. Respect draft-only requests. A short MD, bias or NEB smoke is not evidence of production physics, potential quality or converged sampling. Keep the human review-and-execute boundary and stale-input protection intact.

After the requested rounds pass, coordinate A/B/C review of frontend flow, readability, consistency and visual quality. Implement a bounded agreed scope, inspect actual layouts/themes/font sizes and verify affected controls. Public iteration/release notes record concrete changes, validation and limitations; raw/private evidence stays ignored. Update Git-managed release documents and tag only after package verification, without publishing or pushing absent user authorization.
