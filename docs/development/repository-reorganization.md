# AIMatterLab 仓库代码重组方案

依据 [软件规范](../software-specification.md) 和 2026-11-04 工作树设计；初始审查版本为 `0.18.9-dev.44`。现已从修复后的 `e8ba66a` 在 `codex/v1.0` 分支完成本次代码重组，实际架构见 [代码架构](../architecture.md)，闭包与验证见 [v1.0记录](../v1.0.md)。以下保留原设计及实施顺序；通用科学工具扩展不因源码归位而自动成为已验证能力。

目标是让前端、后端和 Agent 的职责在代码中可定位，并让后端围绕工具组、计算资源、工作空间组织。沿用现有 React、Electron、Node 和 Python 技术栈，先拆依赖和状态归属，再迁移目录。

## 初始清点与重组依据

| 初始位置（链接至当前实现） | 已观察到的职责或依赖 | 重组方向 |
| --- | --- | --- |
| [src/App.tsx](../../frontend/app/App.tsx)、[src/Agent.tsx](../../frontend/features/conversations/Agent.tsx) | 界面组合与会话、连接、消息、流程等状态集中；组件直接使用通用 invoke/api | 按界面功能分组，将状态协调放入对应 controller/hook，形成有类型的调用入口 |
| [desktop/main.mjs](../../desktop/main.mjs) | 同时装配 Electron、Agent、worker、连接、工作区和 IPC 处理器 | 保留启动装配和安全边界，将业务处理器交给各域注册 |
| [desktop/task-records.mjs](../../agent/sessions/task-records.mjs) | 任务记录模块直接导入 Agent 的终端提示指令 | 工作空间提供结构化上下文，Agent 负责将其编排为模型上下文 |
| [src/types.ts](../../frontend/api/studio.ts)、[shared/engine-contracts.mjs](../../contracts/tools/engine-contracts.mjs) | 类型与调用混在一起；共享模块直接引用 worker 内部 JSON 文件路径 | 提取稳定的跨进程契约，客户端调用与类型定义分开 |
| [worker/studio_worker/server.py](../../backend/worker/studio_worker/transport/server.py)、[worker/studio_worker/service.py](../../backend/worker/studio_worker/compute/service.py) | 路由、权限、工具操作、环境和作业生命周期汇集在总入口 | 按工具、计算、工作空间拆服务，传输层保留认证和分派 |
| [desktop/scientific-skills.mjs](../../agent/skills/scientific-skills.mjs)、[desktop/skill-context.mjs](../../agent/skills/skill-context.mjs)、[worker/studio_worker/runtime_guides.py](../../backend/worker/studio_worker/compute/runtime_guides.py) | 已有来源授权、阶段限制、有界读取、哈希及环境收据；技能读取分布在多条入口 | 复用现有保护，补齐统一的交付、配置、执行及封存生命周期 |

已有能力可以作为基础：持久 worker、任务输入快照、环境登记、来源和文件身份、会话租约、人工执行门、共享终端授权。标准工具包登记、流程中的通用输入输出匹配、真实配置生成执行 skill、封存后的读取隔离，需要分别落成明确模块；目录搬迁本身不完成这些能力。

## 目标目录

以下是最终源码布局目标；实施过程中允许旧入口通过兼容转发逐步过渡。

```text
frontend/                              前端，只运行 renderer 代码
  app/                                 工作台装配、布局、导航
  features/                            conversations workflows tools compute workspace agent
  api/                                 类型化 IPC 客户端、事件订阅
  ui/                                  通用组件、主题、国际化
backend/
  main/                                主进程内的后端应用服务
    tools/                             工具定义、交付包、工具组模板与输入输出匹配
    compute/                           连接、环境配置、配置记录、终端、执行准备
    workspace/                         流程实例、草稿、资产、工作目录、桌面任务索引
  worker/                              独立可分发的 Python 服务
    studio_worker/
      tools/                           既有引擎适配、产物与工具测试检查
      compute/                         环境探测、本地与集群作业生命周期
      workspace/                       输入快照、资产、布局和结果文件
      transport/                       HTTP MCP 路由、认证和序列化
      infrastructure/                  持久化、文件与进程基础设施
    tests/                             worker 的工程测试及固定夹具
agent/
  providers/                           模型服务商桥接和实际能力适配
  sessions/                            会话、回复生命周期及恢复
  context/                             会话上下文、功能指导、工具调用作用域
  skills/                              阶段选择、执行 skill 装配、封存读取策略
  tools/                               对后端及共享终端的受限 Agent 工具入口
  builtin-skills/                       应用自带的公共科学与编排指导
contracts/                             跨进程 DTO、schema 和纯验证规则
desktop/                               Electron 宿主与平台支持
  main.mjs                             启动、装配、关闭
  preload.cjs                          白名单桥接
  ipc/                                 sender 校验、路由注册
  platform/                            系统凭据、原生对话框、Windows WSL 路径等
  generated/                           按生成流程维护的外部协议类型
installation/                          AIMatterLab 安装与分发入口
developer/                             外部软件开发者的接入指导
docs/                                  spec、架构方案、开发及版本记录
tests/                                 按 frontend backend agent contracts integration 分组
scripts/                               开发、测试、构建和分发入口
```

`desktop`、`contracts` 和构建设施支撑三块产品职责，不新增产品功能分区。后端在主进程和 worker 中分别实现其职责，保持现有权限与进程边界。worker 内继续使用 `studio_worker` 包名；迁移期间保留必要入口转发，避免把包名和所有调用路径同时改动。

`Agent.tsx` 属于前端的 Agent 面板；模型桥接和上下文管理属于 `agent/`。`AgentTaskPage.tsx` 属于前端流程界面；其名称不决定业务归属。

## 职责、状态与依赖

| 模块 | 拥有的内容 | 调用边界 |
| --- | --- | --- |
| 前端 | 展示、表单与未发送草稿、用户操作反馈 | 通过类型化 IPC 请求服务，不导入主进程、worker 或 Node 能力 |
| 工具域 | 五项工具定义、交付包及版本、功能和测试映射、工具组模板 | 向流程和配置提供契约，不自行修改项目权限或提交作业 |
| 计算域 | 连接、真实环境配置、验证记录、执行 skill 激活事实、调度和运行状态 | 真实检查由目标环境完成；执行受项目授权及人工执行门约束 |
| 工作空间域 | 流程实例、输入输出上下文、文件布局、任务与版本引用 | 桌面保存草稿和索引；worker 保存权威运行记录和输入输出快照 |
| Agent | 服务商、会话、模型上下文、指导选择和受限工具调用 | 从后端读取结构化事实，不把提示词或模型结论变成授权、安装成功或作业状态 |
| Electron 宿主 | 平台能力、可信 sender、IPC 装配 | 注入凭据库、文件选择等受控能力，统一保留权限检查 |
| contracts | 传输对象、版本字段和边界验证 | 只包含可跨边界使用的契约，不吸收业务状态、文件访问或安装逻辑 |

先把契约中的事实与模型上下文分开。例如 TaskRecords 返回终端、流程和环境的结构化信息，由 Agent context 生成提示文本；后端不依赖 Agent 指令。现有跨域调用通过明确接口注入，不以相互导入服务实例解决。

跨语言共用的 JSON 契约保持单一源码，构建时复制或生成到 Node 资源和独立 worker 包并核对一致性。worker 获取契约不依赖桌面源码目录；调整资源清单时同时更新安装哈希及分发检查。

执行状态继续由 worker 负责。源码目录重组不移动用户的 SQLite、SSH、凭据、已登记环境、授权、队列记录或真实运行目录。1.0 前可明确调整一次性开发数据，但不能据此重置真实配置和作业。

## 工具与 skill 的生命周期

### 核心对象

以下对象是目标设计，优先复用现有字段，只有实际需要时才增加版本化契约。

| 对象 | 内容与归属 |
| --- | --- |
| 工具交付包 | 工具域登记包位置、原 Git 提交、交付 skill、重定向测试和接入验证范围；原仓库保留布局 |
| 工具组定义 | 工具域定义步骤、输入输出端口及匹配；工作空间保存用户选定的流程实例和实际资源引用 |
| 真实环境配置 | 计算域记录连接、环境、工具版本、实际安装及对应测试结果 |
| 执行 skill | 根据真实配置和工具操作契约生成，绑定具体环境及版本；日常操作所需内容在此可取得 |
| 流程与 Run | 工作空间保存流程实例、每次执行目录及其关联；worker 的 Run 保留实际版本、环境和权威状态 |

工具组流程统一表达步骤、依赖、输入来源、输出标识和工具版本。工具域核对输入输出契约，工作空间生成执行目录和资源绑定，计算域准备及观察实际运行。先将已有可执行路线接入节点接口；新增多工具执行语义单独验证，不能把现有界面中的步骤列表当作通用流程执行器。

### 三阶段读取规则

1. **开发者接入**：外部作者运行 `developer` 中的接入指导，形成可迁移的 `工具名-package` 与交付 skill，并证明声明流程中的可用性。接入材料位于包内原仓库之外。
2. **用户配置**：Agent 在用户授权范围内读取交付和安装指导，实际安装、配置并跑完对应测试。计算域核对环境与测试记录后激活执行 skill；环境或版本在检查期间变化时，旧结果不能激活新配置。
3. **日常执行**：Agent 按当前任务选择对应环境的执行 skill。前置指导从日常发现、选择、读取和上下文注入中封存，仅在 bug 修复或软件更新需要重装时重新开放所需材料。

封存策略必须在读文件之前生效，覆盖技能目录、自动路由、手动选择、MCP 读取和引用文件展开各条入口。仅从提示词删除安装文字不足以满足该约束。正常任务可以读取运行事实和输入输出，但不能借执行 skill 的引用重新载入交付或安装指导。

执行 skill 的文档装配可放在 Agent 模块；配置是否通过及当前激活版本由后端的真实记录决定。现有 RuntimeGuides 的探测和哈希收据可复用，但单次环境 probe 不能代替安装、逐功能测试及完整执行 skill。

仓库更新在候选包或隔离副本中进行，源码与原测试使用同一 Git 提交，重定向和交付材料核对后再验证。新的已验证配置供新任务或明确升级的流程使用；原版本和环境保留给既有任务，未知作业先核对原记录。

## 现有文件的迁移映射

表中路径是目标位置，先拆模块并提供窄接口，再迁移文件；不按文件名前缀直接整批搬运。

| 当前文件或模块 | 目标位置与处理 |
| --- | --- |
| `src/App.tsx`、workspace shell/navigation | `frontend/app`；App 保留界面组合，连接、会话和流程状态分别进入 feature controller |
| `src/Agent.tsx`、消息、账户、工具活动组件 | `frontend/features/agent` 与 conversations；服务商业务逻辑不进入 renderer |
| `AgentTaskPage`、DeploymentPanel、RunReview、RunDetail、JobsPage | 分入 `frontend/features/workflows`、compute 和 workspace；保持原审阅执行链 |
| Compute、Cluster、Workspace、Pygas、CustomCv 等界面 | 按功能进入 frontend/features；领域调用通过 frontend/api 统一定义 |
| `src/types.ts`、`shared/*.d.mts` | 跨进程类型进入 contracts，invoke/api 进入 frontend/api；UI 专属类型留在对应 feature |
| `shared/task-fields`、deployment、review-state 等 | 按实际所有者进入流程/部署契约或对应前端 feature；纯传输契约与 UI 展示逻辑分开 |
| `shared/engine-contracts.mjs` 与 worker 的 engine JSON | 将共用契约置于 contracts，迁移时保留旧导出和 worker 包资源；先保持现有参数语义 |
| `desktop/task-records`、workspaces、task-authoring、输入与资产模块 | `backend/main/workspace`；移出提示词生成及 provider 专属逻辑 |
| `desktop/compute-*`、worker 连接恢复、SSH 与共享终端服务 | `backend/main/compute`；原生平台操作由 desktop/platform 注入 |
| `desktop/task-deployment`、task-execution、review-authority | 计算域负责准备和执行协调，工作空间负责草稿及输入；共同保留版本和复核校验 |
| `desktop/source-projects`、工具来源与产物契约 | `backend/main/tools`；补充标准交付包、功能与测试映射入口 |
| `desktop/agent-hub`、codex、acp、deepseek、compatible-api、providers | `agent/providers`、sessions；凭据加密与原生登录通过宿主能力注入 |
| `desktop/scientific-*`、skill-context、skills、mcp-provider-scope | `agent/context`、skills 和 tools；统一阶段与封存判定，保留来源授权和租约检查 |
| `desktop/terminal-mcp`、terminal-turn | `agent/tools`；计算域拥有真实终端会话，Agent 侧只操作明确交接的会话 |
| worker adapters、engine/software contracts、pygas、NEB 等 | `studio_worker/tools`；先把既有引擎适配独立，保留其实际支持范围 |
| worker runtime/probe、cluster、ssh_auth、runner 与调度 | `studio_worker/compute`；拆连接、配置、调度及监控，保持独立 worker 生命周期 |
| worker workspace、authoring、composition、资产与输入快照 | `studio_worker/workspace`；Store 的运行持久化作为基础设施由相关服务使用 |
| worker server/service | HTTP/MCP 认证与分派进入 transport，Service 缩为服务装配和兼容入口 |
| `agents/skills` | 最终迁至 `agent/builtin-skills`；打包映射与公共来源白名单同步更新，developer 指导仍独立 |

通用模块按职责归属，不创建新的无边界 shared 目录。自定义 CV、图编辑和私有定义等既有能力随其领域迁移，保持实际谱系与分享授权，不能在清理中丢弃。

## 分阶段实施

| 阶段 | 可交付变更 | 完成条件与受影响验证 |
| --- | --- | --- |
| P0 契约与所有权清点 | 列出 IPC/MCP/HTTP 路由、数据所有者、读写授权及打包路径；确定首条迁移路线 | 映射有实际来源，保护配置和运行状态；本阶段不启动作业或连接现场集群 |
| P1 模块边界整理 | 先拆 main 的路由装配、TaskRecords 的 Agent 指令依赖，以及 types 中的调用与 DTO；旧入口转发 | 相关 Node 协议/安全/持久化测试通过；同接口下的 handler、作用域和错误行为一致 |
| P2 后端三域与工具包 | 将既有服务归域，明确流程节点和输入输出匹配；以一条已有路线实现包登记、重定向检查和配置记录 | 逐域 API/状态/持久化及 worker 生命周期检查通过；新增接入及用户配置跑完对应最小测试，纯迁移按影响选择回归 |
| P3 Agent 与 skill 生命周期 | provider/session/context 分层，接通真实配置到执行 skill 的生成与激活，统一封存策略 | 正常执行对前置指导零读取；故障和重装路径可按范围开放；会话、环境及 provider 隔离通过 |
| P4 前端功能模块 | 拆 App 和 Agent 的 feature controller、视图和 API 客户端，统一展示接入、配置及运行状态 | 受影响组件与真实原生交互通过；切换、草稿、参数复核和任务来源保持正确 |
| P5 目录和分发收尾 | 迁至目标目录，更新 import、类型检查、测试发现、安装和打包清单；移除已无消费者的转发 | 构建、包字节和启动/原服务恢复核对通过；与本轮有关的遗留路径均已处理 |

每阶段拆成可独立审阅和回退的提交。先完成一条已有工具的包、配置、执行 skill 和流程调用闭环，再扩展其他工具；其他路线保留既有适配与原证据范围。新能力和单纯文件迁移分别记账。

第一批适合先处理 `TaskRecords → Agent 指令` 的反向依赖与 main 的 IPC 注册装配；它们能在保留现有入口的情况下明确接口。不要把目录改名、用户数据格式变更和科学执行逻辑调整合在同一提交。

## 构建、安装与数据保护

路径迁移必须同步核对以下实际消费者：

- `index.html` 的 renderer 入口、Vite 配置、tsconfig include，以及前端对 contracts 的导入。
- `package.json` 的 main/files/asarUnpack/extraResources，特别是 worker、公共 skill、Node PTY 和 Agent 运行时的分发位置。
- `desktop/main.mjs` 的 workerSource，`desktop/worker.mjs` 对 install/bootstrap/relay 的调用，以及 `worker/install.py` 的源码清单和哈希规则。
- `worker/pyproject.toml` 的包发现和 `studio_worker.server:main`，bootstrap 的进程身份识别及现有工作服务恢复。
- `scripts/test-worker.mjs`、`scripts/protocol.mjs`、原生回归脚本和 `tests/helpers/app-worker-hooks.mjs` 等直接依赖路径或提取源码的测试入口。
- 公共 skill 根、科学来源白名单和打包排除规则；真实工具包、执行 skill、配置及证据仍在 ignored 运行目录或用户私有存储中。

初期保留稳定的启动器和资源入口，集中解析资源位置，减少重复路径拼接。涉及 hash 的路径变化会产生新的运行时身份，不能把旧收据改写成新版本通过。

真实 SSH、凭据、环境登记、项目授权和 Run ID 保留。若确需改变持久化结构，提供显式迁移和恢复路径；兼容旧真实记录与保留旧运行服务是独立验收项。兄弟科学仓库、源码分支及生产任务不随本仓库重组而变更。

实际开发代次按 AGENTS 更新 CHANGELOG 和版本记录，保存 passed/failed/blocked/not_run 及原始证据。核对对应安装包后才能建立本地标签，推送沿用用户授权范围。

## 验证安排

| 改动 | 必须建立的行为证据 |
| --- | --- |
| 模块和契约边界 | renderer 不导入 Node/特权模块，业务域无逆向提示词依赖；校验实际 import 图和路由调用行为 |
| 工具包与重定向 | 整包换位置后入口与资源仍可解析；指向包外或缺失目标被明确拒绝；原仓库保持 |
| 用户配置 | 缺环境、安装失败、测试失败不能生成已激活执行 skill；结果绑定实际版本和环境 |
| skill 封存 | 对所有读取入口观测文件访问；正常任务不读交付/安装/配置指导，异常阶段只开放所需材料 |
| 会话和执行门 | 旧请求、错误环境或 provider、过期复核无法改变当前任务或提交作业，MCP 不扩大授权 |
| worker 和真实状态 | 幂等提交、持久化、退出及恢复、关闭桌面后任务独立、unknown 不重提 |
| 前端与分发 | 受影响组件和原生交互；最终资源路径、包内容、安装启动及原运行来源恢复 |

工程测试随其模块分组，Python 测试继续靠近 worker。将当前依赖 App 源码布局的测试逐步改为调用公开 controller/接口，不以新文件名或版本号作为通过条件，也不通过删除失败断言完成迁移。

纯前端变化不重跑 worker 或科学矩阵；纯后端变化检查 API、状态和持久化；共享契约检查两侧。仅当引擎执行或数值行为可能改变且契约测试不足时，选受影响的有界真实案例。首次工具接入和用户配置仍须完成其对应测试，这与产品日常回归的范围选择分别记录。

原生交互沿用统一启动 preflight 和隔离 profile；真实账户、集群和科学运行分别记账。复用证据保留原版本及范围，源码重排、打包通过或模拟测试不升级为新的科学验证。

## 方案与实施记录

方案编写阶段只检查文档结构、链接和格式。用户确认当前 bug 修复完成后开始代码实施，各闭包的代码、失败及修复记录、验证范围和未完成项统一记录在 [v1.0记录](../v1.0.md)，不将原方案检查视为代码或科学验证。
