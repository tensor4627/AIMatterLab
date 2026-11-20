# Configure and reuse a tool on one hosted resource

Use the connection selected by the user. Read its tool catalogue with `list_resource_tools`. For an installed tool, read the execution skill returned by `project_skill_catalog` and `read_project_skill` with `scope="resource"` and that resource ID. Recheck its environment, function and version before using it in a new workflow.

## Select the installation path

- **New installation.** Read the tool's delivery instructions. Inspect the target's architecture, registered runtime and modules. Pin the requested version, source commit or release digest. Put the new version in the resource workspace's `software/<tool>/` directory. Reuse site Git or the private resource Git under `software/git/`. Describe the actual installation, source entry or executable and the commands and files needed by this tool.
- **Existing scripts.** Use `discover_resource_tool_scripts` on the directory the user selected. Show each class with a representative script, scheduler, environment and source evidence. Ask the user which function it implements. Preserve original scripts and installations. Reuse a successful job only when its program, template, environment, inputs and outputs can be bound to this configuration; otherwise run the bounded test.
- **Custom tool.** Start with the user's script, examples and manual. Use the provider's available web search or `search_software_docs` / `read_software_docs` to find public sources. Only send the public software name, version and public documentation URL. Record citations for the actual version. Licensed binaries can be registered in place. Define input and output filenames and formats, parameters and defaults, runtime/parallel requirements, the executable argument template, and a small test with a checkable output.

## From review to daily use

For the custom route, the user can select a desktop script or manual in the resource tool form. Use the selected filename, digest and available text to draft the interface. If the material has no readable text, ask for a relevant excerpt. Keep any local-file transfer token inside the desktop.

For source builds, specify the build steps in the manifest and the separate minimal test with its own time and resource limits. Map every input and output port to a filename and format. Choose an output assertion appropriate to the test (`min_bytes`, `contains`, `json_keys` or `sha256`). Capture the checked template and pinned identity in the workspace management Git repository.

If adopting a matching existing success, provide the original `prior_run_id` for worker verification. For a host without site Git, Debian/Ubuntu can obtain a user-level package. On other hosts, or when that retrieval fails, give `git_bootstrap` a compatible archive, executable path and pinned SHA-256. When project authorization is missing, select the registered scheduler in the project form. The tool test and later use of the activated private engine each need to be covered by that project's grant.

Use `plan_resource_tool_setup` for the selected route, project and approved scheduler target. Present the review in **此资源的工具**. Explain the sources, installation path, expected allocation, test inputs and expected outputs. Use the reviewed setup identity for all subsequent status reads. The desktop attempts the acquisition on the cluster first, then on the desktop with a checked transfer to the same resource. If both attempts fail, request a local file or a path on that resource. Preserve the pinned version. A successful transfer, repository checkout or interpreter probe proves only that stage.

Read `read_resource_tool_setup` for the original test job ID, exit and checked outputs. On an unknown submission reconcile that job. Activation produces the execution skill for the exact target. Verify the skill by reading it back in the resource library. If the desktop reports a pending skill write, complete that write from the existing activation receipt. Keep sensitive settings in the private resource registration.

When a user asks to retain a further technique for daily work, write an ordinary named skill with `write_project_skill`, the same `scope="resource"` and the acquired `resource_id`. Use the previous digest when updating and reread the saved revision. Leave the automatically generated activation receipt under its reserved name.

When a workflow needs a missing tool, configure it for that workflow's resource, return to the original draft and recheck it. Once its graph has been frozen, retain its tool versions, work directory and job IDs. An update or repair produces new evidence for a subsequent reviewed invocation.
