# Compute discovery and deployment

Use the registered Studio connection first. SSH is a transport from the local controller, not an instruction to install an agent CLI on the cluster. Never copy model credentials, SSH secrets, proxy settings or local private skills to a target. The desktop/worker retains connection information; the remote job needs only its scientific snapshot, selected environment recipe and the versioned minimal job helper.

For a new connection, collect a host alias or hostname, **explicit remote username**, port and existing credential reference through the private connection editor. Never infer the remote username from the local OS account. Preserve host-key verification. Do not print a connection string or secret in a public report. A connection failure calls for bounded diagnostics on that connection, not discovery of unrelated hosts.

Start with bounded, read-only probes through Studio. Find installed executable paths and versions, the selected environment's Python imports, CUDA/LibTorch compatibility and the scheduler. Do not dump the full process environment or credentials. Reuse already configured environments; do not install packages or switch branches when the request is to test them. Importing an engine on a login node proves discovery only. Confirm scientific execution in an allocated compute slot.

## Scheduler-specific questions

| Scheduler | Read-only observations | Resolve before preparing a batch |
| --- | --- | --- |
| LSF | `bqueues`, selected `bjobs`, selected queue details and site-provided documentation | Queue access, GPU request syntax, wall-time unit, total versus per-slot memory, CPU slots, project/account if required |
| Slurm | `sinfo`, selected `squeue` / `scontrol` / `sacct`, site-provided documentation | Partition access, GPU/GRES/TRES syntax, account/QOS if required, memory unit, time limits |
| Local / WSL | Registered Python/engine paths and GPU availability | GPU assignment, concurrency, process supervisor and time limit |

These command names are discovery hints, not a mandatory command script. Limit output and use commands the registered transport actually supports. Select the observed scheduler; do not silently translate an LSF queue into a Slurm partition or submit to both. Queue names, resource semantics and activation recipes belong to the private deployment profile, not this distributed skill.

Adapt the versioned submission settings in Studio, preview the generated script and resources, and ask the user to resolve genuinely ambiguous site rules. The generic helper must quote data as argv/JSON rather than concatenate untrusted fields into shell commands. Activation code is a separately reviewed privileged setting, never inferred from untrusted probe output. No runtime installation or compiler fallback is implied.

A deployment is ready only when its registration and project authorization allow the selected engine/environment/resources and the exact inputs are staged. Cancellation targets the recorded scheduler job only. Unknown jobs retain identity and reserve their tracked resources until reconciled. After terminal completion, recover the expected outputs, validation report and exit receipt; verify local files, not just the transfer process's exit code.

For a bounded observation/retrieval pass over existing Run IDs, read [reconcile.md](reconcile.md). The portable helper accepts a caller-supplied typed request adapter or an explicit loopback worker, without embedding a machine connection.
