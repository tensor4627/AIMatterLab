# Set up the cluster base workspace

## Work over the acquired SSH connection

Acquire the selected resource with command access and call `run_compute_command` on its lease. Preserve the request ID when the result is unconfirmed. Ordinary chat can inspect a queue, read files, copy inputs into the confirmed workspace, write a postprocessor or submit an explicitly requested independent job. Each lease remembers its current directory after a standalone `cd` or `cd -`. Use the `cwd` returned in the command receipt.

Each command request runs its batch in a fresh shell. Activate the environment and run the program in the same batch, for example `bash -c 'source ./activate-env.sh && exec ./run.sh'` using scripts prepared in the workspace. Exports, loaded modules and foreground processes are scoped to that invocation. Check `output` and `exit_code` in the command receipt. Redirect large logs to a file in the workspace. For an acquired terminal, `read_compute_terminal` pages through the visible terminal's output and `interrupt` clears staged text while idle.

For work outside the confirmed root, read-only inspection uses the authenticated account's existing access. For a user-requested external write or execution, show the exact destination and command in the composer approval. Treat a denied or expired approval as the result of that attempt. Verify the destination of a copy and the source job ID for any follow-up. Keep a potentially destructive change tied to its specific reviewed paths.

## Locate a workspace

At the first managed SSH handoff the user reviews the remote account and absolute root. The resource remembers this choice across logins. New software goes into `software/` under it. Each conversation receives its own directory under `workfile/YYYY-MM-DD/task-N/` on its first confirmed cluster workflow. Use `read_session_workspace` for the path; use the reported source and observation time when offline. Return to that same directory across dates or after restarting the desktop. The authoring workspace below holds drafts and source inputs before confirmation.

Use this reference for a requested base workspace. For an already hosted SSH resource, acquire the conversation's own lease through `compute.queue`. A user may request directory setup or environment inspection on the leased resource. For a service-managed authoring workspace use the steps below when `setup_base_workspace` is advertised for the current selected job-service context, including the legacy shared-terminal route.

1. Call `setup_base_workspace` with `action` set to `inspect`. If the result is `ready`, reuse the returned workspace and show its actual name and path. An existing workflow's authoritative authoring directory continues to identify that workflow's inputs.
2. For `unconfigured`, help the user get started by calling `setup_base_workspace` with `action` set to `ensure`. The managed default is named 基础工作区 with directory name `base`. Use an explicit user-supplied name and directory name when provided. The result contains the actual remote directory and standard scientific subdirectories. Creation is idempotent and records the selection for this connection.
3. When preparing workflow inputs, explain where files will be copied and continue the user's input inspection. Use `copy_project_inputs` for the exact external files requested or discovered in the user's source directory, then read the returned copies with `read_project_input`. The current workflow context supplies the project ID and input root. Ordinary-chat workspace setup does not create a scientific workflow; enter planning only when the user requests workflow preparation.
4. For manual adjustment of a saved SSH profile, open **计算资源**, select the connection, then **编辑连接** → **高级：基础工作区**. The same editor is available in **连接计算资源**. A saved selection applies to newly initialized workflows. Continue an existing workflow in its own saved directory.

A missing workflow binding during first use can be resolved from the current verified service. If a workspace control is unavailable, report which service capability is missing and continue requested work that the lease supports. For a lost connection, use its existing recovery controls. Service-managed workspaces provide authoring directories. Independent jobs and visual workflow calculations use their respective authorized execution routes.

Report setup as complete only after the tool returns `ready` with the actual directory. Continue copying the requested inputs within the user's task. Ask only about unresolved choices that affect their data or scientific task.
