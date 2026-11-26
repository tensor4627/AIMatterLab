---
name: studio-compute-workflow
description: Acquire an AIMatterLab compute resource, inspect scheduler queues, reuse or configure environments, and prepare, submit or observe authorized jobs.
---

# AIMatterLab compute resources and jobs

Ordinary chat can use an authorized compute resource, inspect queues, configure an environment and submit an explicitly delegated independent job. Use planning for a requested or reusable workflow and update its existing task. Read the current tool receipts and project grants.

## Select and use a resource

- Call `list_compute_resources`. A name or short follow-up selects the matching listed `resource_id`. Call `acquire_compute_resource` using exactly one selector. If the target is unresolved, AIMatterLab opens the resource picker. Continue a `target_selected` receipt using its retry. Read the actual `acquired` result before reporting a lease.
- Choose `access: "command"` for short operations on a hosted SSH resource, `access: "service"` for a registered job service, or `access: "terminal"` for a shell. For live queues, call `run_compute_command` with that `resource_id`, a stable `request_id` and a bounded scheduler query, or use `inspect_compute_service` with `probe_scheduler: true`. Read exit and observation time. Use private site guidance for allowed queues, accounts and allocations. [Scheduler discovery and target checks](references/compute-discovery.md) covers the full selection and probe procedure.
- With Windows OpenSSH, the user completes gateway node selection, waits for the selected node's shell and chooses **登录完成，交由 AIMatterLab 管理**. An already verified connection offers **交由 AIMatterLab 管理**. For a pending or interrupted connection, return to the original profile and read [SSH recovery and channel selection](references/connection-recovery.md). Human authentication stays in the private terminal.

## Configure only the needed part

- For the current conversation's work directory or the resource's base workspace, use `cluster.workspace-setup` and [base-workspace.md](references/base-workspace.md). For explicit job-service setup or repair, use `cluster.connection-setup` and [job-service-connection.md](references/job-service-connection.md).
- For a new tool, an existing site script or a resource-private tool, use `cluster.resource-tools` and [resource-tools.md](references/resource-tools.md). Daily use of a configured tool follows its verified resource execution skill. For a scheduler profile, use [profile format](references/profile-format.md) and the applicable [Slurm](references/slurm.json) or [LSF](references/lsf.json) guide.
- Reuse the actual interpreter, executable and source version. Environment discovery, installation, compute-node tests and scheduler submission have distinct scope and evidence.

## Prepare and observe the operation

Use `cluster.lsf-slurm-deployment` and [execution.md](references/execution.md) for independent jobs. For a worker job, use `prepare_compute_run` with real inputs and a stable `spec.idempotency_key`. Its `id` is the `run_id` for `validate_compute_run`, `submit_compute_run` and later reads on the same resource. A reviewed visual workflow uses its own reviewed execution path. A delegated site script uses the acquired shell and the actual scheduler job ID. Honor draft-only, no-build, no-run and stop requests.

Use [scientific gates](references/scientific-gates.md) when selecting or loading a bias artifact on a real target. Keep an explicitly selected AOTI backend fixed. For a lost or unconfirmed result use [reconcile.md](references/reconcile.md) with the original job identity before considering retry. Report observed preparation, test, submission, outputs and scientific conclusions within their actual scope.
