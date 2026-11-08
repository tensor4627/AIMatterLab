# 工具生态与任务关系

本工作台以任务为入口、以工具为能力、以数据资产为连接、以队列为执行底座。Agent 准备流程和各模块参数；用户可提供已有模型、结构、数据集或中间结果。每个计算草稿都必须由用户审阅并点击执行。任务计划与已提交 Run 分别记录，保存计划不意味着提交计算。

## 工具视角

| 工具 | 负责什么 | 输入与输出 | 本版状态 |
| --- | --- | --- | --- |
| MD 引擎 | 自研 PyDyn、修改的 GPUMD / GPU-Sampling；传统 MD、pyGAS 增强采样、NEB（gpumd.neb） | 结构、势、MD 参数、Bias、NEB 初末态 → 轨迹、热力学、CV、checkpoint、NEB 路径与能垒 | MD / 采样 / NEB 适配器已接入；NEB 科学短例与势垒收敛 not_run |
| 力场训练器 | HotPP、TorchNEP、GPUMD 原生 NEP | 已审计与划分的数据 → checkpoint、测试报告、部署模型 | HotPP / 原生 NEP 已接入；TorchNEP 待接入 |
| 主动学习 | NEPMaker 对应 NEP，ActiveMiao 对应 HotPP；调用 MD 主动探索，再选帧、请求 DFT、回收标签和复训 | 初始势、探索域 → 待复核构型 → 新标签 → 新势版本 | 关系和计划入口已建立；两套适配器及 DFT 回收待接入 |
| pyGAS 插件 | 独立仓库和 PyDyn 内置版本分别登记；定义 CV / Bias、轨迹 CV 分析、FES 重建与重加权 | CV / Bias 定义、结构、轨迹、偏置历史 → 部署产物、CV、FES、验证报告 | Bias、验证和已有重加权路线已接入；任意 CV 分析接口继续扩展 |
| 数据资产与请求 | 管理结构、MD / 采样输出、训练集、模型、Bias、主动学习待 DFT 构型及来源；提出处理请求 | 原始资产 → 版本、哈希、来源；请求 → 目标模块与期望产物 | 资产登记已接入；跨模块请求作为持久化计划草稿；DFT 自动流转待接入 |
| 前置 Viewer | 查看结构、轨迹与选帧；辅助初末态检查、用户结构输入和后续拼接 | 结构 / 轨迹资产 → 预览与选择 | Three.js 分帧预览已接入；OVITO 集成、拼接和高级编辑待接入 |
| 队列与监视 | 本机、服务器、集群资源管理；运行、监视、取消和恢复 | 已审阅 Run → 真实进程、日志、退出收据、产物 | WSL 持久化队列已接入；SSH 文件 / 终端已接入；远程作业与调度器待接入 |

“已接入”表示工作台存在对应接口，不表示任意用户环境通过科学验收；每次运行都需要检查实际注册环境。

~~~mermaid
flowchart LR
    User["任务目标 / 用户已有输入"] --> Agent["Agent：计划与参数草稿"]
    Agent --> Review["用户审阅各模块草稿"]
    Review --> Queue["本机 / 集群队列与监视"]
    Queue --> MD["PyDyn / GPUMD\nMD · pyGAS 采样 · NEB"]
    Queue --> Trainers["HotPP / TorchNEP / 原生 NEP"]
    Assets[("数据资产与请求\n结构 · 轨迹 · 数据集 · 模型 · Bias · 构型")] --> MD
    Assets --> Trainers
    MD --> Assets
    Trainers --> Assets
    Assets <--> Viewer["前置 Viewer\n结构 / 轨迹 / 选帧"]
    Assets --> GAS["pyGAS\nCV / Bias · 轨迹分析 · FES"]
    GAS --> MD
    GAS --> Assets
    AL["NEPMaker / ActiveMiao\n主动学习闭环"] --> MD
    MD --> AL
    AL --> Assets
    Assets -. "DFT 复算请求" .-> DFT["外部 DFT 托管\n后续接入"]
    DFT -. "回收标签" .-> Assets
    Assets --> AL
    AL --> Trainers
    Trainers --> AL
~~~

实线描述工具之间的职责与数据关系，不宣称所有连接已实现。实际接入范围以上表和界面状态为准。

## 任务视角

增强采样的核心依赖是：可用势模型、已检查初始结构、MD 引擎与参数、CV / Bias 与采样参数、试运行与正式运行的审阅门、结果资产记录。模型可以由用户直接提供，也可以从数据集训练。主动学习、结构拼接、预平衡、结果分析与自由能重建可按目标选用；某种科学问题确实需要的分析或准备步骤不能因界面标为可选而省略其科学条件。

~~~mermaid
flowchart TD
    Goal["增强采样目标"] --> Model["势模型准备"]
    ExistingModel["用户提供已有模型"] --> Model
    Dataset["用户提供数据集"] --> Train["HotPP / TorchNEP / NEP 训练与评估"]
    Train --> Model
    Train -. "可选" .-> Learning["主动探索 → 选帧 → DFT 请求 → 复训"]
    Learning -.-> Model
    UserStructure["用户提供结构 / 结构资产"] --> Structure["初始结构检查\n可选拼接、准备与预平衡"]
    Model --> MD["选择 PyDyn 或 GPUMD；设置 MD 参数"]
    Structure --> MD
    MD --> Bias["pyGAS：CV、偏置、历史容量和目标环境验证"]
    Bias --> Pilot["准备短试运行草稿"]
    Pilot --> Review["用户审阅并点击执行"]
    Review --> Production["试运行合格后准备正式采样草稿\n再次审阅并执行"]
    Production --> Assets["轨迹、CV、历史、checkpoint 与来源资产"]
    Assets -. "按目标选用" .-> Analysis["pyGAS 分析、重加权与 FES"]
    Analysis --> Assets
~~~

工作台提供七类任务卡：

- 增强采样模拟：力场、结构、MD、Bias、队列、结果分析。
- 分子动力学模拟：力场、结构、MD、队列、数据资产。
- 力场训练与测试：数据、标签与划分、训练、独立评估、导出。
- 主动学习力场：MD 探索、不确定性与选帧、DFT 请求、标签回收、复训。
- 轨迹与自由能分析：来源资产、适用条件、CV / 重加权、图表与 FES。
- NEB 路径模拟：模型、初末态和映射、NEB 参数、路径与能垒分析。
- 数据处理与复算请求：来源资产、目标模块、处理参数、期望产物。

## 界面组织与计划契约

中央工作区首页展示任务卡。左侧“工具”提供七类工具，每类工具列出已接入功能、待接入能力和参与的任务；“工具关系图”可以从关系总览进入任一工具或任务。任务页可启用辅助步骤，指定“由 Agent 准备”或“使用我提供的输入”，填写资产 ID、路径、参数及约束。

计划保存在桌面 SQLite 的 workflow-plan 中，只有 draft 状态；任务计划名称、步骤、来源和用户输入通过共享契约校验。核心步骤不可关闭、步骤不可重复或新增任意命令。Agent 接收明确的计划文本，尚待接入的步骤必须标为 blocked。计划尚不具备自动依赖调度或 DFT 回收；计算仍由独立 worker 的真实 Run 状态负责。

“交给 Agent 准备”把计划放入当前服务商的对话输入框，供用户检查和发送，不直接提交任何计算。当前工具适配器返回的 Run 草稿继续自动打开模块审阅页。

设置 → 工作区布局提供两种布局：任务居中 / Agent 右侧，或 Agent 中间大窗 / 任务选项卡右侧。切换保留当前对话组件、任务选项卡与输入，保存后下次启动继续使用。
