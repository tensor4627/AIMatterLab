# GPU Sampling Studio：交给本地 Agent 的安装提示

你是用户本机的安装协作者。请实际执行本文流程，安装 GPU Sampling Studio、配置用户选定的计算环境，并运行版本化短例。适用于 Codex、Claude Code 等具备文件、终端和 Git 能力的通用 Agent。目标集群无需安装这些 Agent CLI。

## 获取可信源码

- 若本文位于完整仓库内，使用当前 checkout，先阅读 AGENTS.md、installation/manifest.json、installation/config.example.json 和 docs/one-prompt-install.md。
- 若只有本文，向用户一次询问源码 GitHub URL。发布仓库尚未填入 manifest 时不得猜测地址、伪造下载成功或把其他项目当作本项目。
- 在用户选择的新目录 clone 指定发布版本。检查真实 Git revision、发布包哈希与依赖锁；不要覆盖旧安装、重置用户文件或切换现有科学引擎仓库分支。
- 当前桌面平台为 Windows + WSL。缺少 WSL、重启权限、CUDA、兼容 Agent provider 或指定科学仓库时如实记录 blocked，并解释所缺条件。

## 一次收集关键配置

先只读发现本机 Node、pnpm、Python、WSL 发行版、已有 Agent CLI、科学环境和 SSH 配置。然后将不能可靠发现的内容合并成一次问题：

1. 本地 WSL 或 SSH 集群；集群必须明确 host、username、port、密钥路径引用及跳转，不询问或复制密钥/密码内容。
2. 选择软件内 Agent provider：Codex / Kimi / Qwen。安装 Agent 可以是 Claude Code，软件内 provider 是独立选择。登录与 OAuth 必须由用户完成。
3. 需要验收的模块和短例；首版提供 worker、CPU reference-md、实际 PyDyn CUDA pydyn-md。默认验收这三项。用户明确只选 CPU 时保留实际选择范围，不宣称 GPU/PyDyn 验证通过。
4. 已有目标 Python/引擎路径，或独立安装前缀、GitHub 科学源码 URL/full commit、精确版本的 Python 包。优先复用已登记环境，新增环境放独立目录。
5. GPU、队列/partition、CPU、内存、时限，以及集群登录节点是否允许安装依赖。未知调度系统、内存单位和 GPU 选项要与用户确认。

配置保存在忽略的 .studio/installation/config.json。复制样例后填真实值。不要把连接、代理、账号、密钥或日志写入源码、共享报告或对话摘要。

## 执行安装

使用 Python 运行 scripts/one_prompt.py，所有 state 放 .studio/installation 或 checkout 之外的私有目录。依次：

1. plan：审查配置与选定范围，不连接、不安装、不提交。
2. configure：仅在用户需要新环境时启用 bootstrap；只在带本安装标记的专用前缀创建 venv 和 pinned GitHub 源码。读取私有 configure.json，将返回的 environment 合并回用户配置，再重新 plan / target-probe。不要改系统 Python、已有 venv 或源码分支。
3. target-probe：发现真实目标 imports。SSH 全部强制显式用户名，不回退 Windows 用户。不将登录节点 probe 当成计算节点科学验证。
4. smoke：执行版本化短例。WSL 使用独立 worker；SSH 先生成任务草稿与批脚本。让用户在 Studio 审阅后提交，或在用户明确授权了这一份短例脚本及资源后使用 --approve-submit。不重提 unknown。等待真实退出收据，并检查短例实际产物。
5. desktop：锁定依赖安装、构建、独立 profile 的实际 Electron 验收；实际读取 provider 账户和模型目录，并完成一条真实模型回复。缺少登录时让用户登录后重跑；本地测试服务不能替代。
6. finalize：只有当前源码和配置对应的 desktop、target-probe、全部选定 smoke 均 passed 才输出 installation_success=true。旧收据、缺失检查、排队/unknown、未运行模块都不能冒充成功。

命令形式：
python scripts/one_prompt.py ACTION --config .studio/installation/config.json --state-dir .studio/installation

该入口会生成独立 profile 启动文件，保留本机其他安装。桌面正常任务默认普通聊天；用户开启任务规划模式后，才生成中央流程与参数页。正式科学任务由用户点击审阅执行。

## 集群适配

只读检查 LSF / Slurm、队列、资源约束、Python/CUDA/modules/引擎路径。参照 docs/ssh-cluster-management.md，在私有 connection 配置登记 scheduler、queue、remote_root、activation、limits、lsf_memory_scope 和 read_roots。SSH 提交 Skill 保存版本；任何修改只在审阅配置保存后生效。

如果站点禁止登录节点安装/编译，不绕过政策：将安装 runtime 与 bootstrap recipe 放进用户审阅的调度脚本，使用已有基线 Python，在分配的计算节点创建环境，保存安装收据，再 probe 和 smoke。远端仅收到环境 recipe/单次任务 helper，不部署 Agent CLI，也不携带本机 SSH/模型凭据。

NEP / HotPP / pyGAS / GPUMD / sampling 等模块需要对应版本的模型、数据、偏置和短例验收。首版安装器未内置这些额外 fixture；选择未提供 fixture 的模块会 blocked。不要取消选定模块来制造成功，不运行 scripts/science-smoke.py 中本机历史路径，也不将 ASE 参考 MD 标成 PyDyn/GPUMD。

## 交付给用户

交付启动文件、私有证据目录，以及脱敏的安装结果：选定模块，passed / failed / blocked / not_run，真实模型调用与真实科学运行的范围。保护连接信息。未达到成功门槛时给出具体修复步骤，并继续可完成的部分；不要仅因为构建完成或窗口打开就称安装成功。
