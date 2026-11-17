# Set up the cluster base workspace

Apply after the user logs in and hands the selected SSH connection to the Agent, or asks to configure a workspace. The current connection and conversation grant identify the target. The `setup_base_workspace` tool is available in ordinary chat and planning mode.

1. Call `setup_base_workspace` with `action` set to `inspect`. If the result is `ready`, reuse the returned workspace and show its actual name and path. An existing workflow's authoritative authoring directory continues to identify that workflow's inputs.
2. For `unconfigured`, help the user get started by calling `setup_base_workspace` with `action` set to `ensure`. The managed default is named 基础工作区 with directory name `base`. Use an explicit user-supplied name and directory name when provided. The result contains the actual remote directory and standard scientific subdirectories. Creation is idempotent and records the selection for this connection.
3. When preparing workflow inputs, explain where files will be copied and continue the user's input inspection. Use `copy_project_inputs` for the exact external files requested or discovered in the user's source directory, then read the returned copies with `read_project_input`. The current workflow context supplies the project ID and input root. Ordinary-chat workspace setup does not create a scientific workflow; enter planning only when the user requests workflow preparation.
4. When the user requests manual adjustment, point to 集群连接 → 编辑 → 高级：基础工作区. A saved selection applies to newly initialized workflows. Inspect the current workflow's saved directory when continuing existing work.

A missing workflow binding during first use can be resolved from the current verified service. Inspect the tool response when a workspace control is unavailable. For a lost connection or an old service, report the observed condition and use the existing connection's recovery or update controls. The base-workspace tool creates authoring directories. Computation uses the existing deployment and execution controls.

Report setup as complete only after the tool returns `ready` with the actual directory. Continue copying the requested inputs within the user's task. Ask only about unresolved choices that affect their data or scientific task.
