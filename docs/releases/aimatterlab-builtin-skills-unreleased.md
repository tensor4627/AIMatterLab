# AIMatterLab 内置技能同步核对（待发布）

2026-11-19。核对基线为本仓库 `v0.1.20`（`340ffd9`）及本次修改。对照对象包括 11 份内置技能、随包引用、科学功能目录、普通聊天与工作流逐轮提示、桌面控件、MCP 工具和 worker 引擎契约。发布标签继续使用各自版本的检查结果。[标签发布流程](../development/windows-update-release.md#核对内置指导)

| 内置技能 | 核对结论与同步内容 | 对照实现 |
| --- | --- | --- |
| 计算资源与作业 | 已托管资源直接申请会话租约。新建 SSH 指向「登录完成，交由 AIMatterLab 管理」，共享可见终端有单独的交接操作。修正基础工作区、Python 设置入口、可选站点模板，以及 prepare 返回 `id`、后续请求传 `run_id` 的用法。个人笔记和源码 overlay 各有实际保存入口。 | [托管资源](../../backend/main/compute/managed-compute-resources.mjs) · [作业工具](../../agent/tools/managed-compute-tools.mjs) · [连接编辑器](../../frontend/features/compute/ComputeConnectionChooser.tsx) |
| 安装与就绪 | 区分安装包首启与源码安装审计。普通桌面用户可直接进入账号或资源页面。明确五种服务商当前入口，Kimi 使用本地 CLI，Qwen 使用 API 配置，DeepSeek 使用随包 DSH。 | [首启向导](../../frontend/features/onboarding/SetupAssistant.tsx) · [CLI 入口](../../frontend/features/settings/CliRuntimeDialog.tsx) · [运行时打包](../../scripts/stage-agents.mjs) |
| 主 Agent | 协调入口已有普通聊天、既有工作流和个人技能冲突处理。配套的编写指引改用可调用的 CV 功能 ID，并标明从选定资源复制二进制和文本输入的工具。 | [输入复制](../../backend/main/workspace/copy-project-inputs.mjs) · [功能目录](../../agent/skills/scientific-skill-map.json) |
| 工作流编写 | 使用当前工作流的项目 ID 和 `sources` 清单复制指定文件。区分构建产物、消费阶段和已有本地整图执行能力。 | [消费阶段](../../backend/main/workspace/task-consumer-stage.mjs) · [整图端口](../../backend/worker/studio_worker/workspace/roadmap_tools.py) |
| 计算流程图 | 给出「按流程图执行 → 核对执行快照 → 确认并执行整张图」及生效条件。核对本地 GPUMD MD 与轨迹原子数密度的端口。 | [执行面板](../../frontend/features/workflows/RoadmapExecutionPanel.tsx) · [快照与执行](../../backend/main/workspace/roadmap-execution.mjs) |
| 结构、数据与预览 | 补齐 Materials Project 的搜索、候选选择、授权导入和缺少密钥时的入口。修正 Three.js 已能显示晶胞边框、元素计数并重置视角的说明。已有的 `trajectory.density` 现在有对应的内置指导。 | [搜索与导入](../../backend/main/tools/materials-project.mjs) · [结构查看器](../../frontend/ui/heavy/structure.tsx) · [密度脚本](../../backend/worker/studio_worker/tools/trajectory_density.py) |
| 分子动力学与采样 | 修正跨路由引用和 PyDyn/GPUMD 源码回执，核对原生输入、输出和 OPES 配置。示例中的检查点间隔保留在示例范围内，实际任务沿用所选策略。 | [引擎契约](../../contracts/tools/engine-contracts.json) · [原生输入指导](../../agent/builtin-skills/studio-md-workflow/references/gpumd-native-input.json) |
| NEB | 原文把人工点击 Execute 列为所有任务的必经步骤。现分别说明工作流审阅与普通聊天中明确委托的独立作业。核对 GPUMD 的端点、控制文件和路径检查，PyDyn NEB 仍属规划参考。 | [NEB 输入校验](../../backend/worker/studio_worker/tools/neb_checks.py) · [会话执行约束](../../agent/tools/managed-compute-tools.mjs) |
| CV 与 Bias | 补齐公式讨论的 `pygas.custom-cv` 入口。纯讨论可在聊天完成，保存后的私有定义通过任务面板确认公式、审阅实现并授权指定数值检查。保留当前版本共享和目标产物验证。 | [草案参数](../../agent/tools/custom-cv-tool-schema.json) · [自定义 CV 面板](../../frontend/features/custom-cv/CustomCvWorkbench.tsx) |
| OPES 分析 | 说明仅编写 YAML 与明确授权后走 `pygas.opes-reweight` 的两个入口。保留源数据身份、原生权重、ESS 和空箱说明，包内检查覆盖与上游 pyGAS 组合使用的引用。 | [OPES 参考](../../agent/builtin-skills/studio-opes-analysis/references/cli-contract.json) · [worker 适配器](../../backend/worker/studio_worker/tools/adapters.py) |
| 训练与评估 | 核对内置 NEP/HotPP 与外部工具声明。按版本登记的 TorchNEP 源码修正新训练的 CUDA FP32、CUDA Graph 默认值，区分文本权重重启和完整检查点续训。删除未进入任何功能路由、重复保存旧默认值的训练汇总文件。 | [版本登记](../../installation/tool-sources.json) · [TorchNEP 参考](../../agent/builtin-skills/studio-training-workflow/references/torchnep.json) · [内置引擎](../../contracts/tools/engine-contracts.json) |

模型新收到的附件标题、功能读回和会话上下文使用 AIMatterLab。既有 `studio-*` 技能 ID、资源路径和会话字段继续解析，恢复对话时识别两代内部标题。内置参考中的 17 条产品源码回执按真实实现重新核对。发布源码标记的外部参考保留具体版本与文件摘要，读取工具按实际登记源码返回 `source_evidence`，目标环境兼容性另行验证。[消息解析](../../contracts/agent/user-message.mjs) · [源码回执](../../agent/skills/public-rule-evidence.mjs)

## 验证范围

| 项目 | 结果与范围 |
| --- | --- |
| 源码与操作指引 | `passed`。审查 11 份技能、40 条目录路由、16 个内置引擎和 17 条产品源码回执。接口、工具参数、返回字段、权限和界面入口见上表。 |
| 定向回归与构建 | `passed`。305 项定向 Node 测试全部通过。标签 CI 配置的 36 项用例也在本机单独通过。覆盖新对话与恢复、普通聊天与工作流、技能发现和共享、资源租约、材料查询、流程图及项目技能。OPES CLI 的源码检查使用真实 pyGAS 源码和隔离的参数观察，不执行数值分析。TypeScript、前端构建、工具契约和文档链接通过。 |
| Windows 成品读回 | `passed`。对本次隔离构建的展开程序和便携 ZIP 单独提取后的资源各检查一次。23 项包内指导与读取模块同源码一致。实际用包内读取器读通 35 条含内置技能的路由，覆盖全部 36 份正文和引用，其中 8 条是混合路由。未共享和显式测试共享两种状态均验证。旧测试包与修改后的源码不匹配时检查按预期失败。技能文件清单 SHA-256 为 `75f45e1d2b2b8fe49e33cd4c05de1197b1fcc166f7801929d631964d67f093c8`。 |
| 原生交互 | `passed`。用新建空配置启动打包的 Electron，实际从技能库搜索 `trajectory.density` 并选中「用于下条消息」，打开 Agent 配置与 Materials Project 数据源。在「管理计算资源 → 添加或配置连接」保存虚构的离线 SSH 条目，从其编辑页打开 Python、基础工作区和作业服务维护入口。 |
| 外部参考的版本适用性 | `passed`。向隔离的读取器登记本机五个公开源码目录，40 条目录路由全部可读。在 16 份带源码回执的引用中，14 份与本机文件完全匹配。PyDyn 的两份手册和驱动、TorchNEP 的交付声明与版本登记不同，两份引用正确返回 `reference_only`。用发布登记的 PyDyn `2ac6915` 与 TorchNEP `4c3474b` 的对应文件再读，均返回 `source_matched_reference`。 |
| 发布与科学执行 | `not_run`。本次为待发布源码审计，Windows 测试包沿用基线版本号。未构建本次修订的正式 NSIS、推送标签或触发线上 CI。在线模型、真实集群和科学计算未运行。标签发布时还需核对该标签的实际安装器与 ZIP。 |

## 与 v0.1.22 会话资源分配的集成验证

本次合并以技能审计提交 `6a335f27f340` 和本地发布标签 `v0.1.22`（`8b38b18`）为父提交。已发布安装包的验收见 [0.1.22 发布记录](aimatterlab-0.1.22.md)。

| 范围 | 合并源码与隔离验证包的结果 |
|---|---|
| 内置指导 | `passed`。源码及 Windows 展开包均核对 11 个内置 skill、17 项产品源码依据。实际读取器遍历 35 条包含内置技能的路由，其中 8 条混合路由，覆盖全部 36 份正文与引用。 |
| 聊天选择与会话隔离 | `passed`。官方 DeepSeek Harness 在隔离的回环模型下验证聊天点名、恢复对话、错误资源 ID 纠正和服务租约。合并包通过两个隔离 SSH 目标及一个本地 WSL worker 的端到端验证，核对队列读取、独立终端以及向测试调度器提交一次独立作业的回执。 |
| 契约与界面 | `passed`。42 个定向 Node 测试文件中 612 项通过，2 项因 Windows 文件链接能力跳过。13 项 worker 路线图用例在 Ubuntu WSL 通过。Electron 宽屏和窄屏资源管理用例均通过。TypeScript、前端构建、文档链接和工具契约检查通过。 |
