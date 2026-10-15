# GPU Sampling Studio

Keep scientific engines in sibling repositories unchanged. Engine environments are explicit, versioned registrations; never switch their branches automatically. Run inputs and validation evidence belong to untracked runtime directories. No fabricated job status, metrics, model access, or scientific validation. Bias gates must load the serialized artifact and check the real target environment. An explicitly selected AOTI artifact must fail on incompatibility without backend fallback.

The Electron renderer has no Node or filesystem access. All privileged IPC is typed, sender-validated, and routed through the main process. MCP tools cannot change project authorization. The worker owns run state; the desktop owns its index. Submitted jobs survive desktop closure. Never automatically resubmit an unknown run. Tests: Node protocol/security tests and Python worker lifecycle tests; real scientific checks are reported separately.

Release discipline: manage this repository with Git. For each generation, update CHANGELOG.md and its version document with concrete features, validation scope, and passed/failed/blocked/not_run results. Keep raw evidence in ignored runtime directories. Create local release tags only after checking the corresponding package; never invent historical commits or push without authorization.

Compatibility policy: before 1.0, prioritize substantial improvements over preserving disposable development/test conversations. Document necessary breaking changes explicitly. Preserve SSH connections, credentials, registered compute environments, project authorization, and real run state unless the user explicitly requests otherwise. Starting with 1.0, require backward compatibility and versioned data migrations.
