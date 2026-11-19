---
name: studio-opes-analysis
description: Author source-matched OPES reweighting inputs and interpret support diagnostics through AIMatterLab without confusing native OPES weights with WTMetaD or executing analysis automatically.
---

# OPES analysis in AIMatterLab

Use with the existing public pyGAS OPES guidance for the current analysis.opes function. Before writing fes.yaml, read the complete focused document `studio-opes-analysis/references/cli-contract.json` through the existing read_scientific_skill document_id selector for analysis.opes. It contains the source-backed CLI keys, defaults, valid illustrative YAML, units and output layout. Do not invent missing schema keys or ask the user for software-internal names.

Use the authoritative current authoring project and pinned original OPES output, preserve workflow identity and scientific choices, and save actual fes.yaml with authorized authoring tools. Reuse already supplied CVs, temperature and grid; derive exact header names from the real log. Ask only unresolved scientific choices. The example is not a real case answer. A correct run.id is distinct from a run directory basename. Do not use a shell or rename scientific data to bypass a metadata-only input reader.

Honor pyGAS provider sharing and record the exact registered source and input receipts. Native OPES weights use the instantaneous total bias. Report empty bins, ESS and prefix-to-full block diagnostics. For a draft, stop after saving and reading back the input. For a requested analysis run, use the authorized `pygas.opes-reweight` execution path and inspect its actual output. Preserve the original sampling run and project permissions.
