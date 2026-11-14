# Compute discovery and deployment

Use the registered AIMatterLab connection first. SSH is a transport from the local controller, not an instruction to install an agent CLI on the cluster. Never copy model credentials, SSH secrets, proxy settings or local private skills to a target. The desktop/worker retains connection information; the remote job needs only its scientific snapshot, selected environment recipe and the versioned minimal job helper.

For a new connection, collect a host alias or hostname, **explicit remote username**, port and existing credential reference through the private connection editor. Never infer the remote username from the local OS account. Preserve host-key verification. Do not print a connection string or secret in a public report. A connection failure calls for bounded diagnostics on that connection, not discovery of unrelated hosts.

Choose the requested stage before acting. Connection-only setup ends at the WSL/SSH connection; it does not automatically advance to remote discovery or submission. Scheduler adaptation starts with user-selected templates and a reviewable plan. Only a later explicitly included probe phase runs bounded, read-only checks. Do not dump the process environment or credentials. Reuse configured environments and runtime receipts instead of rereading installation skills or reinstalling software for routine planning.

## Portable WSL and SSH connection setup

For local WSL, use an actually installed distribution and a user-selected dedicated Linux-filesystem worker directory. Check the selected local endpoint, keep worker identity with the project and do not replace another service because its version differs. Starting a AIMatterLab worker is separate from installing scientific engines. A window close does not stop submitted jobs.

For SSH, import a user-selected existing connection or use the manual editor. Preserve explicit username, known-host checks and credential references. An existing client's default key or agent is valid when no key file is specified. Passwords, one-time codes and key material stay out of templates and chats. Two-factor authentication is a human handoff; a tunnel is proposed and reviewed as a connection recipe, not created by copying credentials or weakening host checks. Do not install an Agent CLI on a cluster to make SSH work.

## Template-first scheduler adaptation plan

This section describes a future adaptation workflow, not an implemented automatic parser or authorization to probe a live system.

1. Request two or three examples that the user has successfully used, preferably a small task and a GPU task. Accept explicit local file selections or explicitly selected remote file references. Keep originals and source hashes privately; do not put site scripts or resolved values into Git.
2. Identify the scheduler family and the actual submission entry point. Separate LSF/Slurm directives from modules, environment activation, working-directory setup and the scientific command. A site wrapper or unfamiliar directive remains a review item; do not silently substitute generic `bsub` or `sbatch` behavior.
3. Form candidates for queue/partition, account/QOS, CPU/GPU request, wall time and memory, each with its source line and uncertainty. Preserve conflicts across templates. Resolve LSF per-slot versus per-job memory and site-specific units explicitly; a script example alone does not prove a universal rule.
4. Ask only for unresolved permitted targets, their order, payment conditions and resource limits. Names and preferences belong to a private profile. Generic examples in shared instructions use placeholders, never a developer's actual queues or nodes.
5. Present a configuration proposal and exact script preview. Nothing in a template body becomes activation code or a submission command automatically. The user selects which candidates to adopt; existing project scope and immutable run identity remain authoritative.
6. Leave environment tests, scheduler probes and bounded job verification as separate later tasks. Without their explicit scope, record them as pending and stop at the plan. Do not label template analysis, successful SSH or saved settings as a working submission chain.

The implementation backlog includes bounded template ingestion, candidate/conflict review and versioned site-wrapper adapters. Map adopted candidates to the existing per-target environment and activation references; their configuration and immutable snapshots already exist. Site-specific submission, monitoring and retrieval still need later bounded acceptance. Only advertise a part as implemented after its own code and relevant evidence exist.

## Scheduler-specific questions

| Scheduler | Read-only observations | Resolve before preparing a batch |
| --- | --- | --- |
| LSF | `bqueues`, selected `bjobs`, selected queue details and site-provided documentation | Queue access, GPU request syntax, wall-time unit, total versus per-slot memory, CPU slots, project/account if required |
| Slurm | `sinfo`, selected `squeue` / `scontrol` / `sacct`, site-provided documentation | Partition access, GPU/GRES/TRES syntax, account/QOS if required, memory unit, time limits |
| Local / WSL | Registered Python/engine paths and GPU availability | GPU assignment, concurrency, process supervisor and time limit |

These command names are discovery hints, not a mandatory command script. Limit output and use commands the registered transport actually supports. Select the observed scheduler; do not silently translate an LSF queue into a Slurm partition or submit to both. Queue names, resource semantics and activation recipes belong to the private deployment profile, not this distributed skill.

When both scheduler families are present or the selected family does not match the observation, present the discrepancy for a settings update; do not silently change the saved scheduler. A denied or timed-out command leaves that observation unknown. Discovery can propose settings, but cannot approve queue access.

Use the connection's **Queues and environments** settings for the user's permitted targets and new-submission order. Keep required choices small: queue, ownership/payment class, supported engine and resource cap. Put activation recipes and detailed environment fields in the target's advanced settings. The user supplies permission and payment terms; the Agent supplies observable executable paths, versions and reusable environment facts. Saving a connection/profile and approving a project's queue scope are separate operations. Preserve unrelated project policy fields when approving the selected targets. Changing a profile version requires review of a queue policy tied to its previous version.

For each target, propose an existing bounded fixture for a supported route, its exact inputs, requested resources and generated batch script. Continue within existing submission authorization; otherwise stop at the requested preparation scope. Record each target's environment/import checks, serialized artifact reload, real execution and output checks separately. Login-node discovery and another queue's success do not pass the target's compute-node tests. Keep unavailable routes `blocked` or `not_run`; do not invent a completed test or a remote AIMatterLab installation.

Adapt the versioned submission settings in AIMatterLab, preview the generated script and resources, and ask the user to resolve genuinely ambiguous site rules. The generic helper must quote data as argv/JSON rather than concatenate untrusted fields into shell commands. Activation code is a separately reviewed privileged setting, never inferred from untrusted probe output. No runtime installation or compiler fallback is implied.

A deployment is ready only when its registration and project authorization allow the selected engine/environment/resources and the exact inputs are staged. Cancellation targets the recorded scheduler job only. Unknown jobs retain identity and reserve their tracked resources until reconciled. After terminal completion, recover the expected outputs, validation report and exit receipt; verify local files, not just the transfer process's exit code.

For a bounded observation/retrieval pass over existing Run IDs, read [reconcile.md](reconcile.md). The portable helper accepts a caller-supplied typed request adapter or an explicit loopback worker, without embedding a machine connection.

## Existing wheels and GPU architecture

A PyDyn environment may be an installed native wheel rather than a source checkout. Inspect its selected interpreter and actual `pydyn` / `pydyn.sampling` module origins. If the installed sampling package contains the native contract validator, register that explicit validator root; do not prepend a different global PyDyn source tree to PYTHONPATH. Preserve the wheel's native neighbor extension and record its origin. An available source snapshot without the matching extension is not interchangeable with the installed environment.

Inspect the scientific executable and native extensions, not just PyTorch's architecture list. Record binary hashes and available cubin/PTX targets, loader dependencies and the actual allocated GPU. Another installed environment is a separate, explicit registration with its own provenance; a CPU artifact load cannot establish the C++ LibTorch or CUDA loader contract. A directory name is not a verified program version, and a nearby source tree does not prove a binary's exact build commit. Keep unknown provenance explicit.

Use bounded route-specific probes. Cold starts may be slow on shared storage: preserve the last import diagnostics and fail visibly on timeout. Reuse only a fresh probe from the same preflight and interpreter, never an earlier run's cache. These optimizations do not replace saved-artifact, real-neighbor, force/virial or engine execution gates.

Login and compute nodes can have different libc/C++ runtimes. Resolve the registered native ELF's library/version requirements in the allocated target environment before expensive SDK/artifact checks; AIMatterLab records the binary SHA after a successful inspection. A wrapper, static executable, missing inspection tool or timeout is not a verified loader result. Ordinary loader inspection does not establish lazy symbol resolution, CUDA execution or model compatibility. Keep the actual engine launch as a separate gate. Never install a replacement libc, pull a container or guess a container entry point just because a runtime command exists; reuse an explicit existing recipe or obtain the missing configuration.
