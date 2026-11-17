# AIMatterLab 0.1.8 · 交给本机 Agent 的安装提示

你是用户本机的安装协作者。请实际执行本文流程，安装 AIMatterLab、配置用户选定的计算环境，并运行版本化短例。适用于 Codex、Claude Code 等具备文件、终端和 Git 能力的通用 Agent。目标集群无需安装这些 Agent CLI。

## 获取可信源码

- 官方仓库为 `https://github.com/tensor4627/AIMatterLab.git`。0.1.8 的发布引用为 `refs/tags/v0.1.8`。需要登录时由用户在本机 Git 凭据界面完成。
- 从官方仓库安装时，以下命令适用于该标签已发布的版本。在用户选定的父目录核对标签对应的完整提交，并建立跟踪官方 main 的本地分支。已有本地 0.1.8 源码的安装方式见下文。

```powershell
git clone --no-checkout --branch v0.1.8 https://github.com/tensor4627/AIMatterLab.git AIMatterLab-0.1.8
if ($LASTEXITCODE -ne 0) { throw '请核对仓库读取权限和新目录位置' }
Set-Location -LiteralPath AIMatterLab-0.1.8
$sourceCommit = git rev-parse --verify 'refs/tags/v0.1.8^{commit}'
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40}$') { throw '发布标签核对失败' }
git merge-base --is-ancestor $sourceCommit refs/remotes/origin/main
if ($LASTEXITCODE -ne 0) { throw '发布提交不在官方 main 历史中' }
git switch --create aimatterlab-source $sourceCommit
if ($LASTEXITCODE -ne 0 -or (git rev-parse HEAD) -ne $sourceCommit) { throw '源码提交核对失败' }
git branch --set-upstream-to=origin/main
if ($LASTEXITCODE -ne 0) { throw '源码更新分支配置失败' }
$release = Get-Content -Raw -LiteralPath installation/manifest.json | ConvertFrom-Json
if ($release.product -ne 'AIMatterLab' -or $release.version -ne '0.1.8' -or $release.source_ref -ne 'refs/tags/v0.1.8') { throw '安装清单与所选版本不符' }
```

记录 `$sourceCommit` 作为此次安装的版本。用户以后选择更新时，在同一目录运行 `git pull --ff-only`，再双击仓库根目录的 `Launch-AIMatterLab.cmd`。

- 源码就位后，从该提交读取 `AGENTS.md`、`installation/config.example.json`、`scripts/one_prompt.py` 和 `agent/builtin-skills/studio-compute-workflow/SKILL.md`。按本次取得的安装提示继续配置。仓库和资源获取使用已核对的实际地址，版本化安装使用固定源码及其依赖锁。
- 已有完整工作区且用户要求沿用当前检出时，记录其实际提交和本地改动，使用其中的配置与安装器。需要精确复现 0.1.8 时使用独立、干净的目录。保留原安装、用户文件及科学引擎所在分支。
- 当前桌面平台为 Windows + WSL。缺少 WSL、重启权限、CUDA、兼容 Agent provider 或指定科学仓库时如实记录 blocked，并解释所缺条件。

需要科学工具时，先读随 AIMatterLab 提供的[工具仓库清单](installation/tool-sources.json)。按用户选择从 `url` 克隆 `branch` 到新目录，再阅读其中的 `guide` 完成安装。`validated_commit` 记录历史接入验收版本，登记环境时使用实际检出的提交。

## 一次收集关键配置

先只读发现本机 Node、pnpm、Python、WSL 发行版、已有 Agent CLI、科学环境和 SSH 配置。然后将不能可靠发现的内容合并成一次问题：

1. 本地 WSL 或 SSH 集群；集群必须明确 host、username、port、密钥路径引用及跳转，不询问或复制密钥/密码内容。
2. 选择软件内服务商 Codex、Kimi、Qwen 或 DeepSeek。安装 Agent 可以是 Claude Code。Codex、Kimi、Qwen 使用各自的登录方式；DeepSeek 用户从「账号与 API」选择 DeepSeek 并输入 API Key，密钥保存在本机加密凭据库。由用户在认证界面输入凭据，安装配置与日志只记录验证结果。
3. 需要验收的模块和短例；首版提供 worker、CPU reference-md、实际 PyDyn CUDA pydyn-md。默认验收这三项。用户明确只选 CPU 时保留实际选择范围，不宣称 GPU/PyDyn 验证通过。
4. 核对已有目标 Python 和引擎路径，或选择独立安装前缀、清单中的科学工具及所需依赖版本。优先复用已登记环境，新增环境放独立目录。
5. GPU、队列/partition、CPU、内存、时限，以及集群登录节点是否允许安装依赖。只读发现后仅补问无法可靠判定的字段。未知调度系统、LSF 内存按 slot/按 job 语义和 GPU 选项要与用户确认；不猜测站点参数。

配置保存在忽略的 .studio/installation/config.json。复制样例后填真实值。不要把连接、代理、账号、密钥或日志写入源码、共享报告或对话摘要。

## 本机 Agent CLI：先发现，缺失时由用户选择下载

桌面安装包不再内置 Kimi/Qwen。只检查用户选定的服务商：保留有效手动路径，检查 `STUDIO_KIMI_CLI` / `STUDIO_QWEN_CLI` 和本机 `PATH` / `PATHEXT`，再复用已校验的 AIMatterLab 专用安装。发现程序后核对当前 checkout 的兼容版本和真实 ACP 初始化；版本不兼容时显示实际版本，不自动升级或替换本机程序。Windows npm/pnpm 包装入口解析到已核对的真实程序，不通过 shell 执行包装脚本。

用户在同一安装 profile 中点击对应登录或连接入口，CLI 缺失或不兼容时显示下载界面，可重新检测、选择本地程序、下载兼容版本或取消。只有用户选择下载后，才下载锁定的官方 npm 包，校验完整性，在该 profile 的独立版本目录安装；界面显示下载、校验、安装与接口检查进度。保留原有本地 CLI、有效手动配置和登录凭据，不运行包安装脚本。下载成功只代表 CLI 就绪，用户仍需完成登录，真实模型回复另行验证。集群端不安装 Agent CLI。

`reuse-existing` 模式继续跳过下载和安装。缺少所选 CLI 时记录 blocked，先通过独立的用户安装入口处理，再重跑审核；不能把按需下载写成复用审核已完成的新安装验收。

## 执行安装

使用 Python 运行 scripts/one_prompt.py，所有 state 放 .studio/installation 或 checkout 之外的私有目录。依次：

1. plan：审查配置与选定范围，不连接、不安装、不提交。
2. configure：仅在用户需要新环境时启用 bootstrap；只在带本安装标记的专用前缀创建 venv 和 pinned GitHub 源码。读取私有 configure.json，将返回的 environment 合并回用户配置，再重新 plan / target-probe。不要改系统 Python、已有 venv 或源码分支。
3. target-probe：通过所选连接实际探测目标 Python 路径/import 来源、引擎可执行文件、版本及 dirty 标记、PyTorch/CUDA/LibTorch 和 pyGAS 来源；保留真实结果与未检查项。SSH 全部强制显式用户名，不回退 Windows 用户。对已有环境只探测与测试，不额外安装。登录节点 probe 只证明发现；GPU、偏置加载、邻居/容量、力与 virial 检查仍需在调度分配的计算节点完成。
4. smoke：执行版本化短例。WSL 使用独立 worker；SSH 先生成任务草稿与批脚本。让用户在 AIMatterLab 审阅后提交，或在用户明确授权了这一份短例脚本及资源后使用 --approve-submit。不重提 unknown。等待真实退出收据，并检查短例实际产物。
5. desktop：锁定依赖安装、构建、独立 profile 的实际 Electron 验收；实际读取所选 provider 账户和模型目录，并完成一条真实模型回复。存有 API Key、目录请求成功或窗口可见都不能替代真实模型回复。实际模型访问需要认证时，以相同 STUDIO_PROFILE_DIR 启动正常 AIMatterLab 窗口，让用户在本次安装的独立 profile 登录后重跑 desktop；不要拷贝其他安装的凭据文件。账户元数据与实际调用能力分列，字段缺失或认证提示不能替代真实模型回复。本地测试服务不能替代真实调用。
6. finalize：只有当前源码和配置对应的 desktop、target-probe、全部选定 smoke 均 passed 才输出 installation_success=true。旧收据、缺失检查、排队/unknown、未运行模块都不能冒充成功。

命令形式：
python scripts/one_prompt.py ACTION --config .studio/installation/config.json --state-dir .studio/installation

该入口会生成独立 profile 启动文件，保留本机其他安装。桌面正常任务默认普通聊天；用户开启任务规划模式后，才生成中央流程与参数页。一个会话通常更新一个流程。先完整定义科学流程（输入结构/势、MD 引擎、热力学参数、CV/Bias、输出）；之后在独立部署模块选择已有计算连接、版本化环境、工作目录、队列和资源。辅助训练、主动学习、结构生成和分析仅按用户需要启用。MetaD / WTMetaD 默认一个任务、一个 walker；多 walker/replica 必须由用户明确要求且目标实现实际支持。正式科学任务由用户审阅实际输入及部署脚本后点击执行。

Windows 桌面验证和启动均使用共用的 `scripts/start.mjs` 入口；可先执行 `node scripts/start.mjs --preflight-only`。受限令牌返回 blocked 时，申请正常桌面执行权限或让用户从普通桌面启动，不直接重试解包 EXE、禁用 Electron sandbox、放宽仓库 ACL 或修改执行策略。普通非管理员上下文可用。安装器生成的 `Launch-AIMatterLab.cmd` 是 Windows 优先启动文件，保留同一验收 profile；PS1 兼容文件不作为修改系统执行策略的理由。启动检查失败、进程非零退出或旧报告未更新时，不得宣称安装成功。

## 集群适配

只读检查实际 LSF / Slurm、队列、资源约束、Python/CUDA/modules/引擎路径。复用用户已配置的环境，协作解决探测中真实缺失的信息。参照 docs/ssh-cluster-management.md，在私有 connection 配置登记 scheduler、queue、remote_root、activation、limits、lsf_memory_scope 和 read_roots。SSH 提交配置保存版本，任何修改只在审阅配置保存后生效。PyDyn-pyGAS 与 GPUMD GPU-Sampling 分别检查实际注册能力；不能用另一条路线的通过记录替代。工作目录是注册 remote_root 下的安全目录名前缀，由 worker 附加 Run ID，不能接受任意远端写路径。

远端输入仅从明确登记的 read_roots 导入不可变快照，核对大小与 SHA；缺少路径授权先让用户在连接设置中调整，不由 MCP 扩权。提交后保留同一 Run/调度 ID，queued、running、unknown、终态分别报告；断线不自动重提。终态后按版本支持的回收接口取回退出收据、环境/验证报告、日志和实际采样输出，确认本地文件与远端 SHA 一致。传输成功不能冒充科学验证或收敛。

如果站点禁止登录节点安装/编译，不绕过政策：将安装 runtime 与 bootstrap recipe 放进用户审阅的调度脚本，使用已有基线 Python，在分配的计算节点创建环境，保存安装收据，再 probe 和 smoke。远端仅收到环境 recipe/单次任务 helper，不部署 Agent CLI，也不携带本机 SSH/模型凭据。

NEP / HotPP / pyGAS / GPUMD / sampling 等模块需要对应版本的模型、数据、偏置和短例验收。首版安装器未内置这些额外 fixture；选择未提供 fixture 的模块会 blocked。不要取消选定模块来制造成功，也不将 ASE 参考 MD 标成 PyDyn/GPUMD。`scripts/science-smoke.py` 是独立的科学验收入口，仅在明确授权后用 `--config` 指定用户自己的私有路径和新运行目录；安装器不自动调用它。

## 第三方工具

如用户选择接入第三方工具，安装后从「工具与资源 → 第三方工具包」检查并登记开发者交付目录。开发者 ZIP 和生成示例的命令见[开发者快速开始](developer/README.md)。0.1.8 提供固定 CPU `installation.check` 适配器；按所选计算项目和环境记录实际安装、测试及产物。第三方工具验收独立于上面的安装器短例。

## 可迁移 skill 与本机沉淀

发行携带 agent/builtin-skills 下公开的计算、工作流编写及安装验收技能及其通用 references；桌面安装包中的物理位置是 resources/studio-skills，默认显示于技能库。原有本机 skill 保持原位置，不能打包其内容。DeepSeek 等 API 服务商选择技能后，主进程仅注入用户选定的、已登记的技能内容；凭据仍留在本机。

按 docs/portable-skills.md 与公开 profile schema，将明确选定的连接 ID、环境 ID、版本及必要路径写入忽略的私有 JSON，再运行 scripts/localize-skill.mjs --profile <private-profile.json> --repo <checkout-root>，生成 .studio/local-skills/<profile-id>。将该目录登记为额外技能根目录。本机 overlay 是未验证的指导配置，不能授予项目授权或替代实际探测；后续运行证据另存忽略目录。local_skill_refs 仅保存用户选中的路径引用，脚本不读取或复制用户级 skill 全文。

不要把开发者的连接、端口、代理、用户名、私有路径或特化 skill 复制给新用户。目标机器重新发现、重新配置自己的 overlay；远端作业不接收本机 overlay、SSH 或模型凭据。完整 checkout 的本地化脚本和发布包内 resources/studio-tools/localize-skill.mjs 是同一个通用工具，执行时均显式指定用户选定的 Git checkout，不写 Electron 安装资源目录。

## 交付给用户

交付启动文件、私有证据目录，以及脱敏的安装结果：选定模块，passed / failed / blocked / not_run，真实模型调用与真实科学运行的范围。保护连接信息。未达到成功门槛时给出具体修复步骤，并继续可完成的部分；不要仅因为构建完成或窗口打开就称安装成功。


## 用户要求沿用本机环境时

使用公开 `studio-install-readiness` skill 和命名的 `reuse-existing` action。读取实际命令接口后，选择全新的控制端 state-dir 和 worker.root；把配置保存在审计目录外，设置 bootstrap.enabled=false 和明确的 desktop.source_ids（模型回声可为 []）。此模式强制跳过下载、科学环境配置和依赖安装，仍实际探测所选环境、运行选定短例、启动独立桌面 profile 并取得真实模型回复。不得把已有生产 worker 根目录当安装目录，不拷贝其注册、授权或凭据。

第一次验收不得使用旧短例收据。重入只有同一审计所有权标记才可写；环境身份变化时换用新目录，不重提原有 unknown 作业。报告保持 installation_success=false，仅在真实选定检查通过时标 reuse_readiness_success=true，并注明历史收据、skipped/not_run 与科学验收边界。详见 docs/one-prompt-install.md。新机器完整安装仍采用原 configure/probe/smoke/desktop/finalize 链路。
