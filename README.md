# GPU Sampling Studio

面向 PyDyn、GPUMD、pyGAS、NEP 和 HotPP 的中文 Agent 科学计算桌面工作台。Electron + React + TypeScript 自定义前端，Codex app server 与 Kimi / Qwen 官方 ACP CLI 负责 Agent，独立 Python/WSL 服务负责 GPU 作业。

## 启动

Windows 安装包位于 `release/v0.10.0/GPU Sampling Studio 0.10.0.exe`。首次启动：

1. 点击「连接 WSL」。设置中选择已安装的发行版，默认 Ubuntu。
2. 在「计算环境」登记 Linux 绝对路径的 Python、GPUMD、NEP、HotPP 等可执行文件及源码目录，点击探测。Python 必须指向对应虚拟环境的 **bin/python**；保留符号链接路径。
3. 新建项目，设置输入根目录、环境 ID、GPU、并发和时间上限。这些授权仅由桌面用户修改。
4. Agent 顶部选择 Codex / Kimi / Qwen，点击「登录 / 账户」；登录后连接并检查模型目录，再描述目标。Qwen 使用百炼或 Coding Plan 密钥。
5. 确认 Agent 显示「科学工具已就绪 · 26」。账户连接与科学工具连接分别检查；未就绪时点击「修复工具连接」。
6. 开启 Agent 的「任务规划模式」后，创建草稿才会打开中央流程及对应模块审阅页。在同一会话流程中直接改参数，使用缺项定位并点击「复核」。参数和输入完整后点击「执行」，由 worker 验证与提交。日志、结果文件、曲线和轨迹在任务记录中打开。

作业输入复制到 WSL Linux 文件系统。桌面退出只停止聊天与交互终端，已提交的作业继续运行。作业服务源代码部署到持久化 Linux runtime，便携包退出不会删除运行依赖。系统/WSL 停止后只能按引擎 checkpoint 能力续算；未知进程不会自动重提。

开发运行（Node 22.19+，pnpm 11）：

```powershell
pnpm install
pnpm dev
pnpm build
pnpm start
pnpm run pack
```

使用 PATH 中的 pnpm；安装器也支持在 desktop.pnpm 中登记可执行文件路径。

最新三轮改进与范围：[完整审查](docs/audit-20261017.md)、[0.7](docs/v0.7.md)、[0.8](docs/v0.8.md)、[0.9](docs/v0.9.md)。本机未保存修改可恢复并重试；SSH、凭据与真实作业记录保留。

## 已实现

- 石墨/紫色工作区，深浅主题，多工作区标签，布局记忆，可调整 Agent/底部面板，命令搜索。
- 本地 Monaco 编辑器，xterm WSL PTY/OpenSSH 终端，ECharts 原始列图，Three.js 分帧结构预览。
- Codex stdio JSONL 桥接：初始化、账户、模型、流式消息、工具结果卡片、审批、补充问题、恢复、中断及技能发现。
- WSL SQLite 持久化权威队列，单一调度进程锁，同 GPU 串行，项目并发/时限授权，幂等提交，取消、退出收据、日志续读。
- GPUMD/PyDyn MD；pyGAS 四种距离 CV 模板（MetaD、WTMetaD、umbrella、固定墙）；两条采样路线。
- 保存后 bias ABI 验证、实际邻居、CUDA 有限差分及可选 CV 参考值；动态 bias 可传验证历史。
- NEP/HotPP 训练、测试、导出；NEP 回归统计和原有 `nep-regression-rmse` 绘图 skill。
- WTMetaD / OPES 重加权工具接口；输出图片、表格与原始日志预览。
- 输入哈希、版本与本地修改标记、执行命令、环境探测、checkpoint、可复现输入 ZIP。超过 32 MiB 的输入在 ZIP 中列明来源和哈希。
- SSH 使用显式远程用户名及凭据引用；支持 LSF/Slurm 草稿、审阅提交、监控、文件与终端。真实集群科学短任务需要独立验收。

## 科学约定

`succeeded` 表示真实计算进程退出码为 0；科学验证结果另行记录，不能据此宣称收敛或模型准确。具体输入和续算方法见 [任务契约](docs/contracts.md)，实际证据见 [验收记录](docs/acceptance.md)。

普通 PyDyn 与 sampling PyDyn 使用独立环境，应用不会切换、同步或修改上游源码分支。PyDyn 使用匹配原子编号语义的 HotPP `ase-*` 导出。

默认 TorchScript `.pt`。AOTI `.pt2` 的显式构建请求当前阻止在未经验证的工具链上执行；现有 `.pt2` 的部署必须通过 pyGAS manifest/目标容量检查，失败保留原错误，绝不替换后端。AOTI 完整双产物构建和 OPES 动态 checkpoint 验收仍需匹配环境。

本地 skill 从原目录读取，不复制到工作台。设置 `skillRoots` 可添加 `pygas/agents/skills` 等非标准目录；通过 Codex 标准 skill 输入引用原路径。

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

真实科学验收脚本：`scripts/science-smoke.py`。它使用单独 WSL 环境和合成 EMT Cu 数据；不得把它的短训练或 FES 当作物理结果。验收环境安装清单与命令见 [验收记录](docs/acceptance.md)。

协议固定为 Codex CLI **0.162.0-alpha.17.2**，生成类型在 `desktop/generated`。升级 CLI 时先重新生成类型并完成协议验收，再调整桥接版本。参考 [官方 app server 文档](https://learn.chatgpt.com/docs/app-server)。

## v0.2：对话设置与审阅工作流

右侧对话面板可以选择模型和该模型实际支持的 reasoning effort。「上下文」支持 token 预算及自动压缩阈值，留空继承默认配置；应用设置会重连本应用的 app server 并恢复当前会话，不修改全局 Codex 配置或停止计算。实际有效窗口与用量来自服务器回报，预算不会扩大模型容量。

Agent 的 prepare_run/resume_run 会打开 MD、Bias、增强采样或 NEP/HotPP 的独立任务标签。参数与文本输入可以修改；点击「确认并执行」生成新快照，重新验证后提交。MCP 无法验证或提交计算，后续依赖任务也必须审阅。

「设置」按外观、语言、Agent、计算连接、技能目录分类。界面字体/字号、代码/终端字号即时预览；中文和 English 即时切换。保存后下次启动保留；用户内容与科学日志保留原文。

本轮新增验收见 [v0.2 改进记录](docs/v0.2.md)。

## v0.3：任务与工具生态

首页按任务开始，左侧按七类工具浏览能力；任务计划支持核心 / 可选步骤和用户已有输入。设置 → 工作区布局可将 Agent 改为中间大窗、任务标签放右侧。

关系图与任务分析见 [工具生态](docs/architecture-workflows.md)，功能及验证边界见 [v0.3](docs/v0.3.md)，每代记录见 [CHANGELOG](CHANGELOG.md)。本地 Git 从 v0.3 开始跟踪，不自动推送；运行目录、科学输入、原始证据与便携包不入库。

## v0.4：可读界面与 SSH 集群

外观设置现在可以调整所有小字下限和 Agent 对话字号。登录窗口支持真实账户状态与自动完成刷新；开启任务规划模式后，对话请求才会打开中央计算流程和参数页。

SSH 集群页可以导入已有连接，选择 LSF / Slurm，协作探测环境、审阅版本化 SKILL.md、准备和预览批脚本、查看队列与日志以及回收文件。集群无需部署 Agent CLI；正式作业仍需点击审阅提交。实际科学短任务验收尚未执行。

见 [v0.4 功能与验证](docs/v0.4.md) 和 [SSH 可行性与管理链路](docs/ssh-cluster-management.md)。连接信息保持私有，不进入仓库或报告。

## v0.5：规划、SSH 修复和安装入口

Agent 默认普通对话，开启「任务规划模式」才自动生成中央流程页。SSH 提供主机、用户名、端口独立设置，以及保存前连接测试。

将 [INSTALL_AGENT.md](INSTALL_AGENT.md) 交给通用本地 Agent，从完整 checkout 开始自动配置与短例验收；公开 GitHub URL 尚待登记。详见 [安装说明](docs/one-prompt-install.md) 和 [本代验证](docs/v0.5.md)。

## v0.5.1：前端修复与独立复核

保留参数编辑、失联状态和未确认请求身份，修复输入法、设置取消、弹窗焦点与产物展示；复核额外修补了切换运行草稿后的状态隔离。便携包与验证范围见 [v0.5.1](docs/v0.5.1.md)。

## v0.6：会话流程与可视化审阅

左侧项目与对话同时恢复聊天和流程。同一会话可持续用自然语言或步骤菜单调整参数；红绿点提示缺项，手工修改后点击“复核”，准备当前版本草稿后点击“执行”。详见 [本代功能与验证](docs/v0.6.md)。


DeepSeek API：在 Agent 面板选择 **DeepSeek API → 登录 / 账户**，输入 DeepSeek 开放平台 API Key。主进程通过系统加密保存密钥，连接后从官方 `/models` 读取目录；已知当前模型默认关闭思考，也可选择 low / high / max。无需安装 DeepSeek CLI；支持流式回复、科学工具、当前会话流程更新与复核，计算仍由你审阅后执行。真实账户推理需自行配置 Key 后验证；尚未进行 TPS 对比。[接入与验证说明](docs/v0.10.md)。
