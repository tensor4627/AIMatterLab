---
name: studio-cv-bias-planning
description: Turn a scientific CV/bias request into actual pyGAS library composition and source-backed parameter forms, using PLUMED examples only after checking semantics; discuss a formula before creating a missing custom CV.
---

# Library-first CV and bias planning

Use the current conversation-owned workflow and the registered pyGAS source version. Follow this order. A prose description or `cv_definition` string never substitutes for an executable definition.

1. Identify the intended event/observable and actual structure/topology. Inspect the current CV, Bias, Switch and Neighbor catalog and its parameter schema. Reuse a suitable existing composition and approved user-library revision before proposing new code.
2. Choose the library primitives and explicit connections: Neighbor → CV → optional switch/reducer → ordered fixed-size collector → bias or CV-only output. Read actual forward signatures, ranks and the installed graph contract. A per-atom CV requires a deliberate group/reduction. A scalar needs the supported length-one shape adapter; dropping a vector component to silence a build is forbidden.
3. Use matching PLUMED tutorial examples as a design reference. Record the action, source URL, units, atom-number conversion, PBC/periodic domain, grouping, normalization and formula differences. Verify the selected pyGAS method body rather than equating similar names. Unsupported equivalence remains explicit; never silently substitute a different observable.
4. Publish the actual library class names and constructor parameters in the same workflow. Reuse the GUI catalog fields `name`, `required`, `annotation`, `type_hint`, default expression, module dependencies and output size. Module arguments are graph references, not text asking the user to write Python. Each value points to user intent, an actual input/source default, a measured fact or a labeled pilot proposal.
5. Save the canonical graph and rendered source through Studio authoring tools with CAS/readback. Manual and natural-language changes update that graph/source pair and invalidate stale review/artifacts. Keep human build, review and execution gates.

## Parameter display

Show a concise summary first: intended observable, chosen composition/formula, ordered atoms/groups, reduction, CV units/periodicity and bias family. Basic scientific parameters appear in workflow order. Schema defaults and rarely changed technical controls appear in categorized folded details. Keep actual upstream names visible so the user can compare with the corresponding manual. Do not create invented parameters or empty mandatory fields for things the agent can derive.

Do not treat GUI example fillers as source defaults or physical inference. An example `sigma`, `temp`, `weight`, cutoff or switch radius is a proposal only until justified. Read required/default semantics from the actual class revision. Do not evaluate a default expression while inspecting or displaying it. Built-in fields accept structured values and module references, never arbitrary executable Python expressions. Use an allowlisted serializer or a source-bound trusted default; a complex unsupported value requires a vetted adapter or the explicit custom-extension review path.

## Known mapping hazards

- `PairwiseDistanceMean` is the mean nearest-neighbor distance in the inspected implementation, not a general PLUMED `DISTANCE ATOMS=i,j` primitive. Use only after checking the exact intended definition and numerical scope.
- `CoordNum` produces per-center results from directed edges. Specify group filtering, neighbor visibility, switching and sum/mean explicitly; do not assume equality with PLUMED group coordination.
- `PeriodicTorsion` uses four ordered atoms and row-cell minimum-image bond vectors. Derive topology and check sign/domain on the actual structure. A molecule name is not an atom-index map.
- Preserve the collector's CV order in sigma/scale/wraps/history/FES. Mixed periodic and nonperiodic components require actual class support, not a guessed periodic wrapper.
- Use the actual WTMetaD or OPES procedure/state contract. Legacy OPES-like bias classes are not automatically PLUMED OPES. Fixed walls/umbrella require the real one-half prefactor and unit convention; PLUMED KAPPA is not blindly copied.
- Studio defaults to portable `.pt`. Honor explicit AOTI/dual selection with target preflight and no backend fallback. Upstream GUI workspace/dual-export defaults never override Studio-owned run roots or the user's selected artifact format.

## Missing CV

When the catalog and compatible approved user library cannot express the observable, explain the precise gap. Research and propose a formula with symbol meanings/units, atom groups/order, PBC/domain, reducer, differentiability and singularities. Ask for the user's explicit formula confirmation before generating its implementation. A model-written `approved:true` is not human approval.

Present the confirmed formula and its own typed parameter list. Keep implementation in the Studio-managed private custom-CV library, outside sibling engines and release code. Never edit an engine branch or add a native MD force hook. Only the approved CV primitive may extend the existing pyGAS graph; pyGAS still owns procedures, bias, history and deployment ABI. If the installed Studio version lacks the custom-library tools, state that exact limitation instead of inventing a tool or bypassing the framework.

Formula approval is first: bind the actual mathematical spec, schema, domain and semantics before generating code; do not pre-approve a nonexistent code hash. Generated implementation and immutable snapshot then receive the ordinary concrete code/build review and human execution gate. A revision records formula/schema/code hashes, dependencies, output metadata and target/source identity. Changed formula/schema/domain invalidates formula consent; changed code requires implementation review and new numerical evidence. Adjusting parameters within the agreed definition preserves formula consent but invalidates affected parameter-scoped numerical/artifact/prepared-run evidence. Do not repeatedly ask the user to approve an unchanged formula. Reuse by immutable revision and display the original validation scope; listing metadata never imports or executes its code. Private user-library source has its own explicit provider sharing boundary.

## First-definition numerical evidence

Prepare bounded tests after confirmation and run them only through the human execution gate. Check known/reference or analytic-limit values; output shape/finiteness; actual neighbor/PBC/translation/permutation cases where mathematically applicable; autograd versus finite differences away from singularities; strain/virial when used; serialization and real target reload. Store actual reports tied to code/parameter/structure/environment hashes. Missing or failed evidence remains `not_run`, `blocked` or `failed`, not a green scientific badge.

Offer a separate representative stable-phase/reference comparison when useful. Explain the objective, expected discrimination, required structures and cost, and let the user decide whether to run it. Do not invent a phase or call a local finite-difference check physical validation, universal suitability or FES convergence.
