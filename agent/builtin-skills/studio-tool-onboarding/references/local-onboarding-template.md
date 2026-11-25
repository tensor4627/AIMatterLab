# Save an L2 user-local tool definition

Record these five elements using the corresponding sections of `contracts/tools/tool-package.schema.json` as a guide.

1. **Input and output ports.** Record each port ID, staged filename, format and unit, plus required inputs and defaults, from `functions[].inputs`, `functions[].outputs` and `functions[].parameters`.
2. **Runtime and parallel requirements.** Record dependencies, hardware and supported ranks, threads or GPU counts using `environment.requirements`, `environment.hardware` and `environment.parallelism`.
3. **Minimal verifiable case.** Record the case ID, fixture references, expected output filenames and formats, and measurable pass criteria, as in `tests.cases`.
4. **Usage and failure handling.** Record the entrypoint, ordered argv, working directory and failure handling from `functions[].entrypoint` and `functions[].operation`.
5. **Pinned source and acquisition.** Record how to obtain the exact source, such as the repository URL and commit from `repository`, or a release archive or executable with a verified SHA-256.

Save with `write_project_skill`, `scope="user"` and `name="onboarded-tool-<id>"`. Set `expected_sha256` to `null` for a new definition or to the previous digest for an update. Use only the single-line `name` and `description` keys in YAML frontmatter. Put structured metadata in the Markdown body. Add `package_id`, `package_version` and `manifest_sha256` to the body when linking a registered package version.

Replace the illustrative values with the tool's definition before saving.

````markdown
---
name: onboarded-tool-demo
description: Define a converter that reports distances in angstroms.
---

```yaml
tool_id: demo
io_contract:
  inputs:
    coordinates: {filename: coordinates.csv, format: csv, units: nm}
  outputs:
    distances: {filename: distances.csv, format: csv, units: angstrom}
runtime_requirements: {interpreter: Python 3.11, hardware: cpu, parallelism: serial}
minimal_test_ref: demo.distance-check
source_ref: {kind: git, url: '<repository URL>', commit: '<full commit SHA>', acquisition: clone and check out the pinned commit}
status: definition_only_not_target_tested
```

Run `python3 convert.py --input coordinates.csv --output distances.csv` in the working directory. Preserve stderr and fail the case if the exit code is nonzero or the output is missing.

For `demo.distance-check`, use two points 1 nm apart and check that `distances.csv` reports 10 angstroms.
````

For a hosted target, hand the saved definition to `cluster.resource-tools` and use `plan_resource_tool_setup` to prepare the pinned setup and minimal case for that resource. The target test supplies verification evidence, and activation publishes the L3 execution skill under `scope="resource"`.
