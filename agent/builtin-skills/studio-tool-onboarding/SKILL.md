---
name: studio-tool-onboarding
description: Define and register a local scientific tool, inspect a source-local delivery, or connect a selected portable package version to a target setup.
---

# Register a scientific tool definition

Use `software.catalog` to find published sources and `cluster.resource-tools` to configure a selected target. Registration records a definition. Installation, minimal testing, activation and scientific validation each have their own evidence.

Begin with the real production program. Record input and output identities, formats, units and defaults. Specify the exact launch arguments, failure handling, environment and parallelism, a minimal case with inputs and observable checks, and the pinned source or acquisition method. Preserve the upstream implementation. Use the current authorized workspace when preparing the declaration, manual, delivery skill and test assets.

To save an `onboarded-tool-<id>` definition under `scope="user"`, read [the local onboarding definition template](references/local-onboarding-template.md) on `tool.onboarding` using its advertised document ID `studio-tool-onboarding/references/local-onboarding-template.md`.

- **Source-local delivery.** At the exact commit inspect `aimlab-tools/manifest.json`, `SKILL.md`, the manual, program and test resources. From an authorized AIMatterLab checkout run `node scripts/check-aimlab-tools.mjs --repo <source> --commit <commit>` and report its declaration and file-closure result. This path checks the committed source-local declaration. Review the [source-local declaration guide](https://github.com/tensor4627/AIMatterLab/blob/main/docs/aimlab-tools-internal.md) at the matching AIMatterLab revision.
- **Portable package.** Prepare `tool.json`, a committed repository, a delivery `SKILL.md`, manual and case resources. Use the [developer package guide](https://github.com/tensor4627/AIMatterLab/blob/main/developer/README.md) at the matching revision for layout and examples. In **工具与资源 → 算力与管理 → 第三方工具包** use **选择并检查工具包** and **登记此工具包**. For an existing package, inspect its saved version or review an update under the same record. Record package ID, version, commit and manifest SHA-256. The personal skill library can link the package version and save the user's own notes.

## Hand a portable definition to an SSH resource

The user can select the registered delivery `SKILL.md` for the next message in **技能库 → 高级：手动附加本地技能**. Call `scientific_skill_catalog` and inspect `selected_skill.definitions`. Read `selected.managed` with the advertised exact `document_id` for `tool.json`. Use the case's real function ID, reference test case ID and opaque `package_ref` in the `selected_definition` argument to `plan_resource_tool_setup`. The reference belongs to this turn. Reopen the registered delivery for a new selection.

Reading a large `tool.json` by its advertised `document_id` returns a bounded manifest index with per-function, per-case or chunk `document_id`s to read on demand.

Use `cluster.resource-tools` to acquire the selected resource, inspect its scheduler targets and prepare the draft. Use the package ID for a single-function package, or `<package_id>--<function_id>` (replacing dots with hyphens) for a multi-function package, as the resource tool ID. Keep required parameters out of setup defaults (supply them in `test.parameters`) and preserve declared optional defaults. The portable bridge supports a pinned Git checkout or matching installed entrypoint with the package's SHA-256, direct/Python/Bash entrypoints, exact file ports and scalar parameters. Translate the declared `{port}` argument into `{input:port}` or `{output:port}` and a scalar token into `{param:name}`. Match the reference case's expected output paths and formats. Set an explicit assertion for each target output and record the actual fixtures and checks. Advanced launchers and multi-file or directory ports can use a separately reviewed resource draft. A source-local declaration or older job service uses its supported existing setup path.

In **配置资源工具** review the target, source and test together. Read the original `setup_id`, scheduler job, output checks and activation when available. The reference case describes package requirements. The resource test establishes the actual command and checked outputs on this target. Once active, read the resource execution skill and verify the frozen activation in the confirmed workflow. For a local target use its supported environment and tool route.
