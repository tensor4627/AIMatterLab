# AIMatterLab

AIMatterLab 0.1.28 是基于 GPU Sampling Studio 的科学计算桌面工作台。用户与 Agent 共同编写可检查的输入，在明确选择的计算环境中执行，并从作业记录回看结果。除了已有的 PyDyn、GPUMD、pyGAS、NEP 和 HotPP 工作流，第三方开发者也可以通过版本化工具包扩展工作台。

[更新日志](CHANGELOG.md) · [0.1.28 本地测试版](docs/releases/aimatterlab-0.1.28.md) · [软件规范](docs/software-specification.md) · [代码架构](docs/architecture.md) · [第三方开发者接入](developer/README.md)

要安装 GPU-Sampling、pyGAS、PyDyn、TorchNEP、HotPP 或 HotHam，可以在「工具与资源 → 第三方工具包 → 已验证工具的源码仓库」复制克隆命令，再按工具仓库提供的说明安装。源码和桌面版都随附这份[工具仓库清单](installation/tool-sources.json)。

HotHam 的交付入口为 `aimlab-tools/SKILL.md`。安装与文档测试已有开发者按上游 Markdown 自行测试通过的报告。通过 AIMatterLab 完成安装、测试和结果核对的完整流程仍待验收。

开发者交付固定 Git 版本的源码、工具声明、操作指南和测试入口。用户在「工具与资源 → 第三方工具包」检查并登记交付包，在已有执行适配支持的范围内配置环境、运行检查。外部作者可使用独立的[开发者工具包](developer/skills/studio-tool-integration.zip)和[接入示例](developer/README.md)。

## 启动

本地测试版 `v0.1.28` 提供 Windows x64 安装包和便携 ZIP，位于 `release/v0.1.28/`。本版支持在 Windows SSH 私有终端手选登录节点后交接，并改进工作区核对和会话命令通道。[试用与验收记录](docs/releases/aimatterlab-0.1.28.md)

正式版 `v0.1.26` 可从两个发行页下载。[南大 GitLab 发行页](https://git.nju.edu.cn/Tensor4627/AIMatterLab/-/releases/v0.1.26) · [GitHub 发行页](https://github.com/tensor4627/AIMatterLab/releases/tag/v0.1.26)

首次安装时选择一个可写目录，升级时选择原工作区。完成后可从桌面快捷方式或工作区根目录的 `AIMatterLab.exe` 启动。源码放在 `sources/`，用户缓存和技能默认放在 `user-cache/`。[项目提示词和用户技能](docs/project-skill-workspace.md)

从源码安装 0.1.28 时，可让本机 Agent 按安装说明核对本地仓库标签、依赖锁和选定的计算环境。[单 prompt 安装说明](docs/one-prompt-install.md)

Windows 工作区版可以在设置右侧点“检查更新”。发现正式新版后，点击高亮的“更新”即可下载并重启。默认先查南大 GitLab，备用源为 GitHub。私有发行页使用更新面板中的“私有仓库访问”。[分发与升级说明](docs/releases/aimatterlab-0.1.16.md)

1. 普通对话可直接连接服务商；进行本地科学计算时从「连接计算资源 → 本地 WSL」选择已安装的发行版，默认 Ubuntu。
2. 在「工具 → 算力与管理 → 计算环境」登记 Linux 绝对路径的 Python、GPUMD、NEP、HotPP 等可执行文件及源码目录，点击探测。Python 必须指向对应虚拟环境的 **bin/python**；保留符号链接路径。
3. 普通会话可按名称租用已认证的托管 SSH，查询队列或配置环境。明确委托的独立作业按当前项目与资源限制提交。任务规划会建立供编写输入的会话草稿工作区，可在部署页选择执行项目。「设置 → 计算权限」管理项目、输入目录、登记环境和运行限额。
4. Agent 顶部选择 Codex / Kimi / Qwen / DeepSeek，点击「账号与 API」；登录后连接并检查模型目录，再描述目标。Qwen 使用百炼或 Coding Plan 密钥。
5. 确认 Agent 显示「科学工具通道已连接」。这表示工具连接可用；具体环境、输入和执行配置仍须另行核对。连接异常时点击「修复工具连接」。
6. 多步骤计算、需要审阅输入或准备复用配方时，可开启「任务规划模式」。同一会话流程可直接改参数和定位缺项，接着复核实际文件、配置部署、选择项目和环境并执行。worker 记录验证和提交回执。日志、结果文件、曲线和轨迹在任务记录中打开。[托管 SSH 使用方式](docs/ssh-cluster-management.md#托管-ssh-的日常用法)

Kimi/Qwen CLI 单独发现和安装。在需要相应 CLI 的入口，应用先检查本机环境，用户可在缺失时选择下载并查看安装进度。

在「工具与资源 → 第三方工具包」登记声明、配置环境并生成执行技能。「技能库 → 工具包与执行环境」也可打开同一面板。当前内置配置器支持固定 CPU `installation.check` 参考；登记其他工具的定义不代表其安装、测试或执行适配已经通过。

作业输入复制到 WSL Linux 文件系统。桌面正常退出会停止聊天连接并关闭本次交互式 SSH/本地终端，已提交的作业继续运行。重新打开后，选择保存的连接会建立新终端，不复用上次终端缓存；同一次桌面运行内可收起、切换页面和交接终端。作业服务源代码部署到持久化 Linux runtime，桌面程序退出不会删除运行依赖。系统/WSL 停止后只能按引擎 checkpoint 能力续算；未知进程不会自动重提。

日常从 Git 源码启动：双击根目录 `Launch-AIMatterLab.cmd`，或运行 `pnpm run source`。首次自动准备依赖并构建；以后关闭桌面，在同一目录 `git pull` 再启动，沿用同一套 `.config` 设置与缓存。参见[首次启动、增量更新与 profile](docs/source-desktop.md)。

当前源码在全新配置首次启动时打开新手引导，可选择语言、外观、模型服务商及本地或集群算力。完成页提供铜晶胞 MD 操作示例和环境短例入口。已有用户可点击标题栏的「新手引导」，从工作页点击「返回新手引导」可回到上一步。

开发运行（Node 22.19+，pnpm 11）：

```powershell
pnpm install
pnpm dev
pnpm build
pnpm start
pnpm run pack
```

`pnpm run pack` 生成本地发行文件。发布到南大 GitLab 和 GitHub 后的下载验证，以及跳过内测版本的处理，见[Windows 增量更新发布流程](docs/development/windows-update-release.md)。

本地测试的分层入口、筛选方法和合并规则见 [测试库说明](tests/README.md)。默认工程测试不执行工具自带测试或科学计算。

使用 PATH 中的 pnpm；安装器也支持在 desktop.pnpm 中登记可执行文件路径。

打包前由 electron-builder 的 `beforeBuild` 核对前端产物、CLI/PTY 版本、依赖、目标平台文件和应用导入，缺少暂存依赖时运行 `pnpm run stage:agents`。打包后核对成品的系统提示、内置技能和科学路由，并使用成品资源读取科学指导。[内置指导发布检查](docs/development/windows-update-release.md#核对内置指导)

安装版的 `.config/` 保存在选定工作区的根目录，包含连接、授权和作业索引。升级已有 ZIP 或旧版单文件程序时，可选择原 `.config/` 所在目录。源码开发继续使用 checkout 下的 `.config/`，显式 `STUDIO_PROFILE_DIR` 优先。

前身 GPU Sampling Studio 的 [v0.18.3](docs/releases/v0.18.3.md) 修复 Codex 空会话在修改上下文设置或重启后恢复失败：能证明为空的会话自动重连并保留原流程；旧会话记录无法读取时，点击 Agent 面板的“重新建立对话连接”。原流程、参数和作业保留，未确认的消息不会自动重发。

上一代五轮改进见 [v0.18](docs/releases/v0.18.md)，第一轮入口、默认值与工具反馈修复见 [v0.18.1](docs/releases/v0.18.1.md)。第二轮 [v0.18.2](docs/releases/v0.18.2.md) 按[交互设计基线](docs/design/interaction-design.md)重排工作区：侧栏集中展示历史会话，一级入口为工作区、任务和工具，底部默认收起；对话和当前流程可切换优先布局。「任务」统一查看本地和集群保存的记录，并可返回所属会话。断连时保留已读取内容和观测时间，本地参数仍可编辑，重新连接后再复核执行。SSH、凭据与真实作业记录保留。

## 本地源码与结构创建

在「设置 → 科学资源与技能」检查本地 pyGAS/PyDyn/GPUMD/HotPP/TorchNEP 源码；可填写额外绝对路径，保存并重新连接 WSL。源码绑定供 Agent 查询真实 API，不会改动引擎分支或注册环境。状态页区分源码/文件发现与尚未运行的科学验证；TorchNEP/NEPMaker/ActiveMiao 执行适配仍待实现。

在「数据资产」使用 ASE 结构工坊生成 bulk/molecule；Agent 工具还可导入文件、创建表面和显式坐标。结果为保存后重新加载检查的 extxyz 资产，附 ASE 版本、配方、参考默认值及轻量预览。让 Agent 读取本地 pyGAS CV 目录，使用真实图编译器生成可执行代码，并在原会话流程中持续修改；代码构建与计算仍需审阅执行。

「设置 → 数据源」可配置 Materials Project API key，使用系统加密保存。之后在数据资产按化学式/MP-ID 检索、选择目标晶相、经 ASE 校验导入，保留 MP ID/来源/哈希。未配置 key 时真实查询为 blocked，仍可用 ASE。参数建议保留用户条件，标记事实、参考默认值和试算建议；不能从结构确定的科学意图才需要讨论。

两轮改进与验证范围见 [v0.14](docs/releases/v0.14.md)、[v0.15](docs/releases/v0.15.md)。

在「技能库 → 管理资源与公开内容共享」统一登记来源、查看功能地图，并选择允许接收公开项目 skill 文本的服务商。Agent 按任务及阶段载入工作流、CV/Bias 规则和示例，显示来源与载入状态；同一会话按内容哈希去重，源码更新后重新载入。普通计算复用探测后的运行时信息，安装与修复指南仅在明确选择相应阶段时载入。公开 pyGAS 文本共享默认关闭；私有定义按精确版本另行授权，不包含凭据、SSH 或其他项目文件。

流程页面按步骤展示必需参数，细节和有出处的默认值折叠在「高级参数」中；点击模块红点会展开并聚焦缺项。显示默认值不会改写输入或替代必填选择，手改后仍需「复核」。左侧会话旁的垃圾桶可删除会话和附带流程；真实作业与文件保留，删除不改变服务商自身的全局聊天记录。更新与验收见 [v0.16](docs/releases/v0.16.md)。

## 已实现

- 石墨/紫色工作区，深浅主题，随会话切换的单页工作区，布局记忆，可调整 Agent/底部面板，命令搜索。
- 本地 Monaco 编辑器，xterm WSL PTY/OpenSSH 终端，ECharts 原始列图，Three.js 分帧结构预览。
- Codex stdio JSONL 桥接：初始化、账户、模型、流式消息、工具结果卡片、审批、补充问题、恢复、中断及技能发现。
- WSL SQLite 持久化权威队列，单一调度进程锁，同 GPU 串行，项目并发/时限授权，幂等提交，取消、退出收据、日志续读。
- GPUMD/PyDyn MD；注册源码驱动的 pyGAS CV/Bias 参数、图及代码编辑；MetaD、WTMetaD、umbrella、固定墙与两条采样路线。
- GPUMD 原生 NEB 参数、路径及有界运行；已实现路线与待接入适配器在功能地图中分开显示。
- 保存后 bias ABI 验证、实际邻居、CUDA 有限差分及可选 CV 参考值；动态 bias 可传验证历史。
- NEP/HotPP 训练、测试、导出；NEP 回归统计和原有 `nep-regression-rmse` 绘图 skill。
- WTMetaD / OPES 重加权工具接口；输出图片、表格与原始日志预览。
- 输入哈希、版本与本地修改标记、执行命令、环境探测、checkpoint、可复现输入 ZIP。超过 32 MiB 的输入在 ZIP 中列明来源和哈希。
- SSH 使用显式远程用户名及凭据引用；支持 LSF/Slurm 草稿、审阅提交、监控、文件与终端。真实集群科学短任务需要独立验收。

## 科学约定

`succeeded` 表示真实计算进程退出码为 0；科学验证结果另行记录，不能据此宣称收敛或模型准确。具体输入和续算方法见 [任务契约](docs/contracts.md)，实际证据见 [验收记录](docs/acceptance.md)。

普通 PyDyn 与 sampling PyDyn 使用独立环境，应用不会切换、同步或修改上游源码分支。PyDyn 使用匹配原子编号语义的 HotPP `ase-*` 导出。

默认 TorchScript `.pt`。AOTI `.pt2` 的显式构建请求当前阻止在未经验证的工具链上执行；现有 `.pt2` 的部署必须通过 pyGAS manifest/目标容量检查，失败保留原错误，绝不替换后端。AOTI 完整双产物构建和 OPES 动态 checkpoint 验收仍需匹配环境。

对话中创建的个人技能可跨会话复用，存储位置可在「设置 → 科学资源与技能 → 本地用户缓存目录」更改。见[本地技能工作区](docs/project-skill-workspace.md)。

外部登记的 skill 保留在原目录，工作台保存注册信息。设置 `skillRoots` 可添加 `pygas/agents/skills` 等目录；本项目公开科学技能随应用分发。隔离的 Agent 会话按功能地图接收有界规则文本，通过受限科学工具读取已选输入；不直接开放全盘原生技能或文件访问。

## 验证与源码

```powershell
pnpm test
pnpm test:worker
pnpm test:frontend
node scripts/startup-smoke.mjs
# 以下检查会使用真实账户与模型，创建隔离的待审阅草稿，不执行科学计算
node scripts/studio-acceptance.mjs
pnpm protocol
```

Windows 可先运行 `node scripts/test-worker.mjs --preflight-only`，只读核对当前执行上下文能否访问所选 WSL 发行版；`STUDIO_WSL_DISTRO` 仍显式选择发行版，默认 Ubuntu。权限拒绝会报告 `wsl_access_denied` 并停止在 worker 启动之前，不替换为 Windows 测试。WSL 发行版按 Windows 账户登记；正常桌面可以访问而代理宿主被拒绝时，应核对实际进程身份及宿主权限，不能从继承的 `USERNAME`、目录写权限或桌面令牌检查推断 WSL 已可用。预检通过只证明当前账户的枚举能力，不代表 Python、引擎或科学验证通过。

真实科学验收脚本：`scripts/science-smoke.py`。仅在明确授权科学检查时运行，使用 `--config <IGNORED_PRIVATE_CONFIG.json>` 显式选择自己的环境和新运行目录；它没有开发者机器的默认路径。`--help` 不加载科学库或创建运行目录。合成 EMT Cu 短训练和 FES 不代表物理结果。配置字段见 [历史首版验收记录](docs/acceptance.md)。日常回归按改动层选择，不因界面改动或 dev 版本递增重跑科学短例。

Codex 协议生成基线记录在 `agent/providers/codex.mjs`，类型位于 `desktop/generated`。实际连接核对协议响应和严格隔离能力；CLI 版本字符串变化不会单独导致拒绝，也不会跳过能力检查。协议变化时更新桥接与对应类型，并做受影响的协议验收。参考 [官方 app server 文档](https://learn.chatgpt.com/docs/app-server)。

## GPU Sampling Studio 历史 v0.2 · 对话设置与审阅工作流

右侧对话面板可以选择模型和该模型实际支持的 reasoning effort。「上下文」支持 token 预算及自动压缩阈值，留空继承默认配置；应用设置会重连本应用的 app server 并恢复当前会话，不修改全局 Codex 配置或停止计算。实际有效窗口与用量来自服务器回报，预算不会扩大模型容量。

Agent 的 prepare_run/resume_run 会打开 MD、Bias、增强采样或 NEP/HotPP 的独立任务标签。参数与文本输入可以修改；点击「确认并执行」生成新快照，重新验证后提交。MCP 无法验证或提交计算，后续依赖任务也必须审阅。

「设置」按外观、语言、Agent、计算连接、技能目录分类。界面字体/字号、代码/终端字号即时预览；中文和 English 即时切换。保存后下次启动保留；用户内容与科学日志保留原文。

本轮新增验收见 [v0.2 改进记录](docs/releases/v0.2.md)。

## GPU Sampling Studio 历史 v0.3 · 任务与工具生态

首页按任务开始，左侧按七类工具浏览能力；任务计划支持核心 / 可选步骤和用户已有输入。设置 → 工作区布局可将 Agent 改为中间大窗、任务标签放右侧。

关系图与任务分析见 [工具生态](docs/architecture-workflows.md)，功能及验证边界见 [v0.3](docs/releases/v0.3.md)，每代记录见 [CHANGELOG](CHANGELOG.md)。本地 Git 从 v0.3 开始跟踪，不自动推送；运行目录、科学输入、原始证据与分发包不入库。

## GPU Sampling Studio 历史 v0.4 · 可读界面与 SSH 集群

外观设置现在可以调整所有小字下限和 Agent 对话字号。登录窗口支持真实账户状态与自动完成刷新；开启任务规划模式后，对话请求才会打开中央计算流程和参数页。

SSH 集群页可以导入已有连接，选择 LSF / Slurm，协作探测环境、审阅版本化 SKILL.md、准备和预览批脚本、查看队列与日志以及回收文件。集群无需部署 Agent CLI；正式作业仍需点击审阅提交。实际科学短任务验收尚未执行。

见 [v0.4 功能与验证](docs/releases/v0.4.md) 和 [SSH 可行性与管理链路](docs/ssh-cluster-management.md)。连接信息保持私有，不进入仓库或报告。

## GPU Sampling Studio 历史 v0.5 · 规划、SSH 修复和安装入口

Agent 默认普通对话，开启「任务规划模式」才自动生成中央流程页。SSH 提供主机、用户名、端口独立设置，以及保存前连接测试。

该代引入了由本机 Agent 执行的安装与短例验收流程。[历史验证](docs/releases/v0.5.md)

## GPU Sampling Studio 历史 v0.5.1 · 前端修复与独立复核

保留参数编辑、失联状态和未确认请求身份，修复输入法、设置取消、弹窗焦点与产物展示；复核额外修补了切换运行草稿后的状态隔离。便携包与验证范围见 [v0.5.1](docs/releases/v0.5.1.md)。

## GPU Sampling Studio 历史 v0.6 · 会话流程与可视化审阅

左侧项目与对话同时恢复聊天和流程。同一会话可持续用自然语言或步骤菜单调整参数；红绿点提示缺项，手工修改后点击“复核”，准备当前版本草稿后点击“执行”。详见 [本代功能与验证](docs/releases/v0.6.md)。


DeepSeek API：在 Agent 面板选择 **DeepSeek API → 登录 / 账户**，输入 DeepSeek 开放平台 API Key。主进程通过系统加密保存密钥，连接后从官方 `/models` 读取目录；已知当前模型默认关闭思考，也可选择 low / high / max。无需安装 DeepSeek CLI；支持流式回复、科学工具、当前会话流程更新与复核，计算仍由你审阅后执行。真实账户推理需自行配置 Key 后验证；尚未进行 TPS 对比。[接入与验证说明](docs/releases/v0.10.md)。

开发与验收：[A/B/C 开发闭环 skill](docs/development/skills/studio-development-loop/SKILL.md)（开发专用，不自动附加到科学对话）。
