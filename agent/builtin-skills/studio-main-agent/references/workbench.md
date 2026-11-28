# Find the right page or skill library

Use the labels in the user's language. The names below are the Chinese interface labels. For a “how do I” question, give the starting page, the next action and the result the user should see. If the connected chat exposes the requested action, carry it out within its current permissions.

## Desktop navigation

| User's goal | Starting point and what happens there |
| --- | --- |
| Connect a model or resume a discussion | **工作区** shows recent chats and runs. In the Agent pane, **账号与 API** selects a provider/account. Restore the original chat for its attachments and workflow. **新手引导** in the title bar walks through initial setup. |
| Plan or edit a calculation | Enable **任务规划模式** for a visual workflow. In the current flow, open a step to inspect or edit parameters and files. **复核** checks the saved revision. **配置部署** selects the registered compute resource and run settings in the owning conversation. Report the submission from its actual receipt. Ordinary chat can handle tool questions, queue queries, environment setup and expressly delegated independent jobs. |
| Find a scientific function | **工具与资源 → 计算与建模** lists 分子动力学引擎, pyGAS 插件, 力场训练器, 机器学习哈密顿量 and 主动学习. Inspect the card's available engines and status. **工具关系图** shows how inputs, tools and outputs relate. For the corresponding Agent guidance use the matching function in `scientific_skill_catalog`. |
| Inspect structures, trajectories or assets | **工具与资源 → 数据与分析** contains 数据资产与请求 and 结构与轨迹 Viewer. Open a supported asset for frame preview. For a real input to another operation, use the relevant import, copy or registration action and check the returned file identity. Selecting evidence for discussion attaches the selected excerpt to chat. |
| Locate a tool's upstream manual or register a package | **工具与资源 → 算力与管理 → 第三方工具包 → 随版本收录的源码仓库** shows each source, branch and guide. **选择并检查工具包** inspects a local delivery. **登记此工具包** saves its definition and version. **配置真实执行环境** shows the configurator available for that package. The Hamiltonian card describes HotHam's source availability and native backend separately. |
| Connect compute or configure a target tool | **连接计算资源** chooses local WSL or a hosted SSH connection. **计算资源** shows the resource, terminal, service and conversation channels. On an eligible target **配置此资源的科学工具** opens that resource's setup and test records. **工具与资源 → 算力与管理 → 计算环境** registers and probes executable/source paths. The user profile supplies base path access. **Agent 选项 → 会话审批** lists additional approvals for that conversation. A connected model, terminal and job service each supply different capabilities. |
| Inspect jobs and results | **运行记录** displays local/cluster jobs with filters and the last observation. Open the original record for its status, logs and available output files, or use **返回会话** when a chat is linked. A stale record or a disconnected service calls for reading the original job identity. This page also lists managed schedules where available. |

For Materials Project credentials use **设置 → 数据源**. For provider settings, appearance, language, workspace layout and desktop update status use the corresponding **设置** category. **搜索与命令** locates pages, tools, chats and jobs.

## Find the status of a tool

1. **Source listed.** For a release-only question, use the local inventory on `software.catalog` and the advertised bundled references. The inventory records a reviewed revision and integration status. Read the linked upstream guide when external sources are in scope. The matching native engine, when advertised, has its own contract.
2. **Definition checked.** `tool.onboarding` explains how to package a local program or script. In **第三方工具包**, select the saved version and use its definition receipt for the required ports and test case.
3. **Configured and tested.** Open the setup for the intended resource, environment and function. Read the minimal test's actual job, outputs and verdict, then the execution skill after activation. Use that tool/version on the same target in the workflow.

## Which instructions belong where?

| Scope | How to find it and when to save there |
| --- | --- |
| Software | The shipped startup index points to common routes. In **工具与资源 → 算力与管理 → 技能库**, **按功能查看指导** shows public built-in and registered-source guidance. Chat reads an entry by `function_id`, then one advertised `document_id` if needed. Maintain shared defaults in the product source. |
| User | For a method requested across chats, use `project_skill_catalog({"scope":"user"})` and read/write in that scope. “保存到本机工作区的技能库” selects the personal library. The catalog returns its actual directory. **设置 → 科学资源与技能 → 本地用户缓存目录** controls the local cache. Use the package registry for portable tool definitions and cite the chosen version in personal notes. |
| Project or conversation | `project_skill_catalog({})` and `scope="current"` resolve to the bound project or, for a chat without a project, its private library. Inspect the returned scope. Follow the bound project's editable `AGENTS.md` links by library and name. Record scientific choices, relative paths and artifact references here. Record account, interpreter and scheduler details under the corresponding resource. |
| Compute resource | Use `scope="resource"` and the acquired `resource_id` for a private procedure specific to that SSH resource and verified account. The library lives on the desktop. To see a tested tool's guide, open **计算资源**, select the SSH resource, then **远端总工作区 → 配置此资源的科学工具 → 此资源的工具与配置记录**. Open the setup and select **查看执行技能**. An active setup with a pending skill save offers **补写执行技能**. |
| Tool delivery or execution | **第三方工具包** retains a versioned delivery declaration, manual and test criteria. When explicitly selected for the chat, the catalog advertises the allowed documents on `selected.managed`. Read their exact IDs. An activated execution guide has its own target, version and provider binding. Check that binding before reusing directions for a run. |

For an ordinary private skill, read and write using the same scope and name. `write_project_skill` takes the previous `sha256` in `expected_sha256`, or JSON `null` to create. Verify the returned path and read back the saved revision. The reserved activation skill comes from the tested setup. If two applicable guides disagree on a consequential step, identify each source, explain the difference and ask which to apply to that step. The user's choice still uses the project's actual permissions.
