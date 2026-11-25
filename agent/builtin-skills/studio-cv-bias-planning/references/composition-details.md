# CV composition and bias settings

## Parameter display

Show a concise summary first: intended observable, chosen composition/formula, ordered atoms/groups, reduction, CV units/periodicity and bias family. Basic scientific parameters appear in workflow order. Schema defaults and rarely changed technical controls appear in categorized folded details. Keep actual upstream names visible so the user can compare with the corresponding manual. Do not create invented parameters or empty mandatory fields for things the agent can derive.

Do not treat GUI example fillers as source defaults or physical inference. An example `sigma`, `temp`, `weight`, cutoff or switch radius is a proposal only until justified. Read required/default semantics from the actual class revision. Do not evaluate a default expression while inspecting or displaying it. Built-in fields accept structured values and module references, never arbitrary executable Python expressions. Use an allowlisted serializer or a source-bound trusted default; a complex unsupported value requires a vetted adapter or the explicit custom-extension review path.

## Known mapping hazards

- `PairwiseDistanceMean` is the mean nearest-neighbor distance in the inspected implementation, not a general PLUMED `DISTANCE ATOMS=i,j` primitive. Use only after checking the exact intended definition and numerical scope.
- `CoordNum` produces per-center results from directed edges. Specify group filtering, neighbor visibility, switching and sum/mean explicitly; do not assume equality with PLUMED group coordination.
- `PeriodicTorsion` uses four ordered atoms and row-cell minimum-image bond vectors. Derive topology and check sign/domain on the actual structure. A molecule name is not an atom-index map.
- Resolve history columns, units and update/weight semantics from the selected class/version and manifest before constructing validation or restart files. Zero accumulated bias can yield unit WT tempering rather than zero hill amplitude; do not carry a column interpretation across MetaD/WT/OPES families. Record the actual reloaded bias, force and virial responses and sampled derivative scope.
- Preserve the collector's CV order in sigma/scale/wraps/history/FES. Mixed periodic and nonperiodic components require actual class support, not a guessed periodic wrapper.
- Use the actual WTMetaD or OPES procedure/state contract. Legacy OPES-like bias classes are not automatically PLUMED OPES. Fixed walls/umbrella require the real one-half prefactor and unit convention; PLUMED KAPPA is not blindly copied.
- AIMatterLab defaults to portable `.pt`. Honor explicit AOTI/dual selection with target preflight and no backend fallback. Upstream GUI workspace/dual-export defaults never override AIMatterLab-owned run roots or the user's selected artifact format.

## Current AIMatterLab authoring tools

Use `inspect_pygas_catalog(source_id="pygas")` for the bounded real class index and `classes` (up to four exact names) for constructor fields, defaults and source-bound semantics. Its AST catalog does not import or execute code. `GroupVector` and `ZoneSelect` return dynamic tuples in the inspected version; library presence does not make them directly graph-renderable scalar CVs. Never drop tuple members or invent a scalar output size.

For `render_pygas_workflow`, use the authoritative `workspace_id=studioTaskId`. On updates pass the existing `composition.graphPath` as `path`, its complete `expected` graph/source pair receipt, and current `catalog_files`. A hash conflict requires rereading the same pair and reconciling manual changes. Do not create another graph or conversation. Structured parameter data uses `parameter_format: structured-v1`; source defaults are inspectable descriptions, not expressions to evaluate. Saved graph/source status is authoring only. A draft, including missing constructor or connection fields, cannot be treated as a built artifact.

MetaD `sigma` and `scale` cover the full ordered collected CV vector, including inactive dimensions; periodic FFWTPD uses the actual `pdl` Nx2 domain list. Only a source-declared pure permutation may reorder corresponding rows together. Other class/group/reduction/dimension changes require a new complete dimension review and invalidate numerical/artifact/history/prepared evidence.
