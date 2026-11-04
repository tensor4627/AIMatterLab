# GPU Sampling Studio 开发者接入指南

本目录保存面向其他软件开发者的接入说明和 Agent skill。工具接入以 [软件规范](../docs/software-specification.md) 为依据：满足 GPU Sampling Studio 的工具定义，能够完成安装并通过测试用例。

## 工具接入 skill

入口：[studio-tool-integration](skills/studio-tool-integration/SKILL.md)。

这份接入指导 skill 指导 Agent 与软件开发者协作，保留原软件的仓库布局，在工作空间中生成一个 `工具名-package` 交付包。包内包含原软件的 Git 仓库、用于操作该工具的交付 skill 和标准测试重定向入口。交付格式见 [交付指南](skills/studio-tool-integration/references/deliverables.md)。

它用于开发者的软件接入工作，与 Studio 中用于日常计算规划和执行的科学 skill 分开存放。可直接分发整个 skill 目录或 [ZIP](skills/studio-tool-integration.zip)；完整 schema、纯声明校验器、注册约束和小型 CPU 工程示例均在目录内，不需要访问 Studio 仓库才能理解交付格式。

## 开发者接入与用户配置

| 阶段 | 面向谁 | 工作与产物 |
| --- | --- | --- |
| 工具接入 | 软件开发者及其 Agent | 保留原仓库布局，验证声明流程中的可用性，生成可迁移的工具交付包和交付 skill |
| 工具配置 | 工具使用者及其 Agent | 在用户真实计算资源上安装、配置环境并完成对应测试，生成真实环境的执行 skill |
| 日常执行 | 工具使用者及其 Agent | 使用执行 skill 操作已配置的工具，读取实际任务进度和结果 |

交付 skill 包含如何安装、测试和操作工具，使用包内相对路径及通用环境要求；开发者的验证结果不代替用户环境的真实配置。执行 skill 根据用户现场的安装、环境及测试结果生成，保存在用户私有运行配置中。

后端依据真实 worker 激活事实封存相应版本的交付、安装和配置指导，日常读取自足执行快照。明确的 configure/repair/update 人工操作才可按当前 owner、lease、版本、revision、资源和期限开放必要前置材料；失效配置仍保持封存。当前真实自动配置闭环仅支持固定串行 CPU worker 工程 reference，通用科学工具的安装/运行适配须另行实现验证；受控读取门不等同任意 shell 的全局文件系统隔离。

## 使用方式

将整个 `skills/studio-tool-integration` 文件夹提供给 Agent，保留 `references`、`scripts` 和 `assets`，让 Agent 先读取 `SKILL.md`。Agent 读取开发者指定的软件仓库，将接入材料写入交付包中原仓库之外的位置，通过相对路径引用原有接口、说明、测试和资源。

接入指导 skill 是生成工具交付包的指南；生成的交付 skill 是包内的 `SKILL.md`，用于指导后续 Agent 安装、使用和测试该工具。两者用途不同。

可以使用以下请求，并填写实际仓库、功能和授权范围：

```text
请读取 studio-tool-integration/SKILL.md，将我指定的软件整理为 GPU Sampling Studio 工具。
软件仓库：填写实际位置或来源。
交付包位置：填写工作空间中用于保存工具名-package 的位置。
接入功能：填写本次需要纳入工具的功能；请先核对现有实现。
安装和测试：填写允许使用的环境、资源及执行范围。
请保留原仓库的源码和文件布局，生成 tool.json v1、交付 skill 和工具名-tests 测试重定向目录，
并记录安装及各项功能的测试结果、未通过原因和剩余缺项。
```

`工具名` 为占位名称。原软件不必按 Studio 的目录示例重新组织文件。`工具名-tests` 提供统一总介绍和各功能测试入口，重定向到包内原仓库的实际位置；缺少的说明或最小测试可以在交付包中补充。所有测试资源须在整个交付包内可取得，允许位于原仓库中。

机器字段、默认值、额外文件约束和注册方式见 skill 内的 [注册与版本契约](skills/studio-tool-integration/references/registration.md)。模型或大型测试数据可放包外层并声明 resources，不要求原作者将它们放进 Git。声明校验命令只需支持 JSON import attributes 的 Node 22.13+；示例生成器另需 Git，实际执行示例才需 Python 3。

## 仓库更新

源码、原有测试和资源继续按原作者的 Git 仓库维护。交付 skill 记录对应仓库提交和文件映射；同步仓库后核对这些映射、安装说明和环境要求，再运行相应测试并记录结果。原仓库中的路径或接口改变时，更新包内重定向和交付说明。

接入材料可以独立维护，不要求原作者将它们写入源码目录。Studio 不自动 pull；候选仓库更新后同步 tool.json 中的真实提交、重定向和指导，再检查/测试并显式注册更新。包版本是源码提交、manifest 与资源闭包的内容身份；已登记快照与旧任务保留，不能原地替换其程序。

## 验收范围

工具定义和测试材料齐备，与开发者实际安装、功能及声明流程测试通过分别记录。`schema_checked` 和 Studio `definition_checked` 分别证明声明检查、真实 Git/文件闭包检查；注册记录的安装及测试仍为 `not_run`。若缺少测试环境或资源，保留 failed/blocked/not_run 及原因，不把文档/注册完成视为接入通过。开发者接入通过与用户真实环境配置通过分别记录。

将软件整理为合格工具，不会自动为 Studio 新增运行适配器或界面入口。如还需要修改 Studio 的工具注册、worker 或前端，应依据其实际接口另行实施和验证。
