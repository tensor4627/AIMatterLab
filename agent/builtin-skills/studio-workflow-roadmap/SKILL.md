---
name: studio-workflow-roadmap
description: Plan a conversation-owned AIMatterLab calculation backwards from its requested products, identify inputs to confirm or supply, and save the tool invocations and artifact handoffs in the task roadmap.
---

# Plan from deliverables

1. State the requested products and what can be checked for each: quantities, units, output cadence, time range and required files. Record the user's choices and mark proposals.
2. Walk backwards from each result through its actual producer and output port to the required inputs. Use `describe_engine` or the selected tool or group declaration. Use the exact version, functions and port bindings for a registered group. Ordering alone creates no artifact handoff.
3. Reuse a resource ID for every consumer of the same artifact. Give independent invocations their own IDs. A force field or bias evaluated at each MD step is part of that invocation. Independent training, export or bias build creates a reusable file output.
4. Bind supplied inputs to existing editable fields. Use null or an empty list for a missing value. Record the user-provided facts, inferred choices, unresolved producers and actual missing inputs in the current task. Keep short display labels and full descriptive labels where supported.
5. Save the optional `roadmap` through `present_task` when advertised. Use `parameters` for engine inputs, `steps` for the editable form and `missing_fields` for outstanding values. Update the same graph when deliverables or producer/consumer links change. For a form-only tool, preserve the form and describe the proposed plan in chat.

When a chat enters planning, carry forward its approved inputs, project and verified resource. On a hosted cluster use `read_session_workspace` for the previously confirmed working directory when available. Before execution, check the actual saved inputs against the frozen ports and expected outputs.

- [Roadmap contract and example](references/roadmap-contract.md) covers stored resource IDs, labels, ports and file bindings.
- [Execution review and receipts](references/execution-receipts.md) covers a checkable output, a native trajectory handoff and frozen producer/consumer evidence.

For a supported graph the desktop offers **按流程图执行 → 核对执行快照 → 确认并执行整张图**. Draft-only ends at saved plans. Reconcile an unknown job using its recorded identities before retrying.
