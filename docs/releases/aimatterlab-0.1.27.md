# AIMatterLab 0.1.27 本地测试版

2026-11-22 · Windows x64 · [更新日志](../../CHANGELOG.md)

安装包名为 `AIMatterLab-0.1.27-win-x64-setup.exe`，便携包名为 `AIMatterLab-0.1.27-win-x64.zip`。在 `release/v0.1.27/` 中打开安装包即可试用。

## 试用会话与历史

- 新建会话，围绕一个主题聊到第 4 轮。模型可结合讨论保留原题或提出新题，此后每 8 轮复评一次。手动命名后，标题由用户控制。[会话标题行为与开发验收](aimatterlab-conversation-titles-unreleased.md)
- 从侧栏打开已有的 Qwen 或自定义 API 会话，可在模型服务离线时查看本机历史。续发时，工作台会核对原服务配置。已有会话的标题复评可从读出的完整历史接续计数。[离线历史与工作流修复](aimatterlab-workflow-repairs-unreleased.md)

本版包含 WSL 1 作业恢复、Slurm 和 LSF 提交回执、集群草稿的输入来源、本地复现包和材料技能路由的修复。开发阶段的 Linux 与调度器夹具结果保存在原验收记录中。[运行与恢复的开发验收](aimatterlab-workflow-repairs-unreleased.md)

## 内置指导

与 0.1.26 逐份比对了 11 个内置技能及其引用。主 Agent 的技能和运行时说明补入 Materials Project 与 ASE 入口。已有 MD 流程中，显式查找材料和创建结构分别选择对应的输入工具。Slurm 与 LSF 参考重新对应 worker 中的提交、恢复和退出回执。[材料工具与返回字段](../../backend/main/tools/materials-project.mjs) · [技能路由](../../agent/skills/scientific-context.mjs) · [调度器实现](../../backend/worker/studio_worker/compute/cluster.py)

普通聊天、已有工作流与显式共享终端的测试覆盖了能力范围、来源读取和旧会话的恢复。恢复提示在登录核验超时时保留原尝试。确认断线后，桌面按原身份和工作区恢复符合条件的会话。新标题提示使用本次复评 ID，模型通过 `review_conversation_title` 提交题目，主进程在成功结束本轮后写入。安装、数据、MD、CV 与偏置、训练、NEB、OPES、输入编写和流程图指导沿用上一版核过的引擎及工具契约。[托管资源提示](../../agent/sessions/resource-routing.mjs) · [标题工具与回执](../../agent/sessions/conversation-title-reviews.mjs) · [上版核对](aimatterlab-0.1.26.md#发布前核对)

## 本版验证范围

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 会话、资源与技能 | passed | 199 项定向 Node 用例及 1 项独立 DSH 回环用例通过。首轮发现科学指导测试缺少标题服务依赖，且 SSH 恢复提示遗漏核验超时的语义。修正后验证了身份核实后的租约恢复，也在旧会话的新一轮请求中读到了当前提示。 |
| 本机 Linux worker | passed | WSL 中的 56 项用例覆盖存储与并发、集群草稿输入传输和已记录的执行检查导出。使用临时数据库和传输夹具。 |
| 源码与开发者分发 | passed | 引擎契约副本一致，开发者 ZIP 的 12 个成员与源码匹配，文档链接通过。科学目录含 41 项功能、16 种引擎和 17 项产品源码引用。通过 36 条路由读取了 37 份内置正文及引用，其中 8 条混合路由核对了上游技能的共享范围。 |
| Windows 成品对话 | passed | 用独立配置启动 0.1.27 的成品 EXE，以随包 DSH 连接本机脚本化模型。20 轮对话中，第 4 轮改为「铜晶体的热膨胀」，关闭桌面并令模型端点离线后，重开旧会话读到了同一标题，端点收到 0 次请求。恢复服务后第 12 轮改为「铜晶体的空位扩散」。手动改名后续聊到第 20 轮，侧栏与聊天页保留手动标题。 |
| 两种 Windows 包 | passed | 分别提取安装器和便携 ZIP，核对程序、ASAR、12 个应用源码文件、7 个 worker 文件和 140 个构建产物。两份包的实际读取模块均通过 36 条路由读回全部 37 份正文与引用，25 份运行时指导文件与源码一致，包括新增的标题提示与契约。 |
| 完整性和签名 | passed | 7 项 SHA-256、签名更新清单、安装器与分块表的 SHA-512 均匹配，安装器签发者符合项目固定证书。Windows 系统信任状态为 `UnknownError`，原因是本机未信任该自签名根证书。 |
| 生产集群、真实模型与原位升级 | not_run | 本次为本地测试包。实际站点作业、在线模型的命名质量和现有工作区的升级另行验证。 |

## 成品校验

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `AIMatterLab-0.1.27-win-x64-setup.exe` | 158581872 | `ca8964ac146bc2ab3fcd182939187aa7033ff70b37ef37f5a487fb159ce2e9d7` |
| `AIMatterLab-0.1.27-win-x64.zip` | 211535920 | `0e9f5197e978ff027b302debdf2372881df4b7cbb5cea7c23468854732cac043` |
