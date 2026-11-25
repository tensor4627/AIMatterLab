---
name: studio-neb-workflow
description: Prepare the implemented native GPUMD GPU-Sampling NEB route from real endpoints and engine contracts; keep PyDyn NEB and physical barrier claims explicit when unsupported.
---

# Native NEB in AIMatterLab

For native NEB use `describe_engine` with `gpumd.neb`. `neb.pydyn` provides planning guidance only. Inspect the supplied endpoints or explicit path for matching atom count, species/order, cell/PBC and potential. Derive correspondence from those structures and resolve any ambiguous mapping. Check the selected execution environment when the requested operation needs it.

Preserve the user's endpoint paths, optimizer controls and cell mode. Resolve fixed/variable cell, pressure, interpolation, images, climbing choice, force tolerance and step limit from actual intent or source-backed input. Label delegated demonstration settings. Use the exact current contract and a real run.in; driver paths belong to file references, not unknown executable-control fields.

For a bound and activated custom or resource tool, read its resource execution skill first. For native `gpumd.neb`, use `describe_engine` and read [the NEB parameter contract](references/neb.json) and [the native input review and tested syntax example](references/native-input.md) by their advertised document IDs on `neb.gpumd`.

For a saved workflow, write the real inputs in its authoring directory, use the current SHA before replacing a file, and update the same task with `present_task`. Reuse supplied structures, potential and path. For an explicitly delegated independent job in ordinary chat, follow `cluster.lsf-slurm-deployment` on the acquired resource. Use the returned preparation and validation receipts for that run. A draft-only request ends at saved inputs. A reviewed workflow uses its own snapshot and execution controls.

After execution, inspect each image's atom order and finite geometry/energy and the actual optimizer log. Distinguish step limit, stopping tolerance, runtime integration and a verified transition state. A finite path or a short optimizer stop does not establish a physical saddle or barrier. Preserve historical failures and never resubmit an unknown run automatically.
