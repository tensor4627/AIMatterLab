# AIMatterLab 0.1.13 内置报错审计与改进清单

**发布基准为 `v0.1.13`（`4341744`），旧规范最后一次修改为 `v0.1.12` 的 `c113f32`。** 可搜索索引固定在发布源码，因此能够查到修正前的消息、函数和触发条件。新版规范与本轮修正位于审计分支。验证及交付状态另有记录。[逐项诊断索引](diagnostics-0.1.13.html) · [新版软件规范](../software-specification.md) · [本轮验证](../releases/aimatterlab-0.1.13-diagnostics.md)

报错的作用范围通常只有一次调用。例如，同样看到“不能继续”，可能是缺少实际解释器、当前会话没有这个项目的作业权限，也可能是上一次提交尚无回执。前一种可以在配置时发现，第二种需要已有授权或可信用户操作，第三种应查询原作业。把三者统一处理为“重试”或“申请更多权限”都会给用户错误的下一步。

共扫描 **595 个第一方源文件**，在其中 408 个文件定位 **7,200 处诊断相关代码**，涉及 5,317 种源码表达式。6,783 处可直接给出语法分支，其余保留函数、调用位置或文案查找键。独立复点发布源码的 2,337 处 JS/TS 显式 `throw` 和 1,470 处 Python 显式抛出点（含非成功或动态退出），均能在索引定位。不同入口复用同一消息时按位置计数，计数不表示用户实际遇错频率。

| 触发条件的性质 | 源码位置数 | 阅读方式 |
| --- | ---: | --- |
| 实际运行前提 | 2,579 | 核对当前步骤使用的输入、协议、平台与执行环境。 |
| 主动产品约束 | 1,736 | 核对身份、授权、文件边界、不可变性与副作用的所属方。 |
| 运行前提与约束并存 | 1,368 | 例如原回执丢失既影响观察，又触发防止重复提交的规则。 |
| 观察、状态或转述 | 1,504 | 区分原错误、展示层及可能仍可用的能力。 |
| 需读取原调用回执 | 13 | 每处附单独判读。如私有 SSH 汇总异常，上游 HTTP 非成功状态，或更新页面的通用失败提示。 |

对通用规则无法判定的 548 处，逐项核对了消息与所在分支，并把判断绑定到该发行提交的行列。其中 535 处可进一步归类，其余 13 处在索引中说明还需要哪项证据。[逐项复判记录](../../scripts/diagnostics/reviewed-0.1.13.json)

## 规范更新的依据

| 版本差异 | 值得固定的设计原则 | 对报错边界的影响 |
| --- | --- | --- |
| 0.1.12 已把个人与内置技能分库，首轮提供个人目录，冲突时由用户选工作方式。旧 spec 已写明此点。 | 能力指南、个人偏好和执行授权有各自来源。 | 没有 worker 仍能查指南和讨论。保存技能按所属库与文件修订核验，skill 无权新增项目授权。[0.1.12 记录](../releases/aimatterlab-0.1.12.md) |
| `69b9744` 补充私有源码标签与 Windows 交付记录。 | 发布基准取可定位的 Git 版本。 | 历史验证注明版本、条件和平台；文档变更本身没有引入运行门槛。[发布记录](../releases/aimatterlab-0.1.12.md) |
| `5123ef2` 加入桌面托管资源、按会话持有的连接与可撤回租约；同一会话可同时使用多个平台。 | 认证、资源发现、终端使用权、作业服务和项目授权分别记录。 | 终端仍可用时，把服务缺项准确报在服务操作上。跨项目、跨会话、来源改变或别名有歧义时，禁止猜测目标。[资源管理](../../backend/main/compute/managed-compute-resources.mjs) · [项目授权](../../backend/main/compute/managed-project-access.mjs) |
| 同一提交引入独立的会话运行时以及原生 Windows 托管 SSH 路径。 | 切换前台只影响查看位置。每个会话的在途轮次和每条 SSH 子通道独立。 | 一个会话忙或一个资源失联只限制其自己的操作。Windows 客户端按实际能力显示状态。四个会话通道是每条 SSH 主连接的容量，服务有独立通道。[会话运行时](../../agent/providers/conversation-agent-hub.mjs) · [SSH 子通道](../../desktop/platform/terminal-service/managed-ssh-shells.mjs) |
| `5ecc605` 接入有限次巡检、调度子作业、原会话唤醒、到限提醒和手动核对。关闭窗口可进托盘。 | 服务委托有用途、父任务、原服务、轮数、截止时间、单轮时限和独立回执。 | 额度耗尽结束自动派发；原父作业状态仍取原服务。用户可单次读取。脚本、唤醒、停止和新提交各受其委托约束。[worker 计划](../../backend/worker/studio_worker/compute/managed_schedules.py) · [托盘](../../desktop/platform/managed-tray.mjs) |
| `421e0c2` 将 worker 子进程的启动目录固定到已核验运行时，`4341744` 记录成品验收。 | 运行时身份要落实到实际进程的解释器、模块来源和工作目录。 | 从另一份源码 checkout 启动也能加载登记的分发版本。保留身份检查，把误加载消除在启动流程中。[启动入口](../../backend/worker/bootstrap.py) · [0.1.13 发布验收](../releases/aimatterlab-0.1.13.md) |

## 按用户操作分析

下表给出完整索引中需要不同处置的典型路径。“阻断”指该行对应的操作。能否继续聊天、读记录、编辑或操作其他资源，须看各自的前提。索引可按消息全文、错误码和源码所有者查看同族的其余分支。

| 入口与代表消息 | 触发条件与实际影响 | 工作流程与约束取舍 |
| --- | --- | --- |
| Windows 启动与安装，`Existing prefix is not this installation` | 选中的前缀已有另一份安装；受限启动上下文也可能在创建窗口前失败。属于真实安装或进程前提。 | 配置时识别目录标识、依赖和桌面上下文，保留既有安装，给出可用目录。只读预检可以先运行，文件覆盖和来源校验继续严格执行。[安装运行时](../../installation/runtime.py) · [Windows 启动诊断](windows-startup-diagnostics.md) |
| 桌面 IPC、HTTP、MCP，`MCP credential is restricted to /mcp` | 请求使用错误角色、来源、路径或结构。即使底层程序能够运行，这条调用也未获许可。 | 在工具发现与类型化入口给出匹配接口。可信桌面的授权、部署与文件操作保留在相应通道。[传输策略](../../contracts/transport-policy.mjs) · [worker HTTP](../../backend/worker/studio_worker/transport/http_handler.py) |
| 模型账户、CLI 与上下文，`A turn is already active` | 缺运行时或登录影响该服务商；原轮次活动或超时未结束时，并发操作可能归错会话。 | 先复用配置并核对原轮次。容许其他会话并行，保留该会话草稿；重连应有明确的原上下文。[会话运行时](../../agent/providers/conversation-agent-hub.mjs) · [CLI 管理](../../backend/main/compute/cli-runtime.mjs) |
| SSH 资源，`managed_compute_resource_choice_required`、`terminal_session_limit` | 多份租约缺少目标时应消歧；新 shell 达到连接容量或被站点拒绝时确实无法分配。 | 首次使用核对用户选定目标；已有准确租约优先复用。可释放该资源的空闲租约或使用其他已获准资源。别名、认证窗口和终端输出均不能授予作业权。[资源入口](../../backend/main/compute/managed-compute-resources.mjs) |
| 托管作业服务，`managed_compute_project_grant_required` | 项目列表成功返回且未授权，与列表请求失败、原服务尚未配置，是不同事实。发布版部分路径把它们归为同一拒绝。 | 缺服务只提示核对原登记或明确配置；权限拒绝才回项目设置。按所需的具体能力核验旧 worker，保留已有终端、运行读取及索引操作。[服务查询](../../backend/main/compute/managed-compute-services.mjs) · [Agent 入口](../../agent/tools/managed-compute-tools.mjs) |
| 项目与 CPU 任务，“所选 GPU 不在项目的资源范围内” | 部署预检对本地 CPU 阶段也查 GPU 授权，而 worker 的固定安装检查、轨迹数密度阶段本来就不分配 GPU。 | 项目可显式授予零个本地 GPU。保留 GPU 型引擎的编号检查、CPU 阶段的环境和输入检查，以及集群队列配额。[部署预检](../../contracts/compute/deployment-authorization.mjs) · [实际 GPU 分配](../../backend/worker/studio_worker/tools/adapters.py) |
| 技能、文件与私有 CV，`Skill revision changed; read before saving` | 读取后的并行编辑改变修订，或文件、目标 provider 超出已分享范围。 | 重读旧稿再合并本人改动；项目、个人、会话和私有 CV 的范围分别验证。对可选指南的加载失败保留讨论与其他材料。[技能读写](../../agent/skills/project-skills.mjs) · [私有 CV](../../agent/tools/private-cv-access.mjs) |
| 工具接入、环境与声明，`Tool declaration required for engine …` | 实际适配器依赖的接口、命令或运行时不存在；或只登记了来源，尚无组合验证。 | 登记、配置与已验证能力分别展示。只在消费者使用的接口上阻断。引擎来源按提交核对，不能仅凭声明、库名或示例给出通过结论。[执行适配器](../../backend/worker/studio_worker/tools/adapters.py) · [联用要求](tool-dependency-groups.md) |
| 流程草稿与复核，`LOCAL_REVIEW_UNSUPPORTED_OPES` | 人工本地复核器没有实现该组合的检查；缺少目标输入、图有环、端口引用不成立则各有影响。 | 允许未完成的图继续保存和讨论。复核方式超出范围时说明替代入口；整图冻结时必须核对图、真实输入和来源。复核意见过期可提示，实际输入身份冲突须阻断。[复核入口](../../contracts/workflows/local-review-eligibility.mjs) · [流程图](../../contracts/workflows/roadmap.mjs) |
| 输入导入、复制、快照与复现 | 根目录不匹配、符号链接越界、复制中内容改变、产物未生成或超过读取预算。复制的哈希等标识是不可变输入的证据。 | 使用获准来源的副本，读取大文件按观察或分页处理。明确缺失或截断；内容不一致不写成一次成功交接。[输入副本](../../backend/worker/studio_worker/workspace/input_copies.py) · [运行产物](../../backend/worker/studio_worker/workspace/run_artifacts.py) |
| PyGAS/CV、MD 和科学检查，`AOTI needs explicit dual export and target-toolchain preflight` | 选择的产物、维度、原子索引、单位或目标工具链不兼容，可能直接改变计算或导致加载失败。 | 提前读取真实结构和模型，并在目标环境加载序列化产物。显式选择 AOTI 时禁止自动降级。科学检验失败保留其数值和范围；程序的退出回执独立保存。[消费端适配器](../../backend/worker/studio_worker/tools/adapters.py) · [科学检查](../../backend/worker/studio_worker/tools/science_checks.py) |
| 本地和集群运行，“请核对原提交，不要创建重复作业” | 已有启动认领、待确认提交、取消中或旧快照。程序可能已经运行，重发可能产生第二份作业。 | 使用原服务、run ID、提交 nonce 或调度号核对。保留独立草稿和已确认的终态；同号、不同来源的作业不能互换。[桌面部署](../../backend/main/workspace/task-deployment.mjs) · [启动认领](../../backend/worker/studio_worker/compute/launch_protocol.py) · [集群记录](../../backend/worker/studio_worker/compute/cluster.py) |
| 定时计划、脚本、唤醒和停止，`managed_schedule_task_delegation_required` | 当前任务缺某种委托、次数已用完、父任务身份变化，或原服务没有回执。它们分别是授权、有限执行或观察问题。 | 固定用途、执行次数、父任务及子作业；手动核对独立记账。按发起方处理离线停止，旧授权不明时由用户在原计划核对。[委托](../../backend/main/compute/schedule-delegation.mjs) · [计划索引](../../backend/main/compute/managed-schedules.mjs) |
| 运行面板与诊断文案，`unknown`、`原服务记录待核对` | 列表过期、网络读取失败或另一次查询正在进行，均不能证明父作业失败。 | 保留最近状态及观察时间，单独展示本次读取结果。错误详情保留原来源，让用户能从同一作业继续核对。[运行面板](../../frontend/features/runs/ManagedScheduleRecords.tsx) · [诊断摘要](../../frontend/features/diagnostics/ui-diagnostics.mjs) |

## 本轮改进清单

| 决策 | 本轮落实 | 验收边界 |
| --- | --- | --- |
| 放宽无关资源门槛 | 固定 CPU 路线从部署、工具参考任务到 worker 使用一致判据。空 GPU 列表表示没有本地 GPU 授权。 | CPU 可准备；GPU 型任务仍须命中授权。非法 GPU 输入不能转成空授权。 |
| 放宽非依赖能力的前置检查 | 确切终端租约可继续使用。读取项目目录失败、缺少服务登记、权限不足各有对应结果。已有索引可读；发起有限次服务操作须验证该能力。 | 不完整服务不会触发新的项目授权、安装、切换集群或提交。 |
| 收紧停止和读取计划的权限 | 受限 Agent 请求与可信桌面停止各沿本通道。计划回执须吻合原来源、计划、种类及会话作用域。明确的人工离线停止可恢复。 | 授权收回、同号异源、迟到回复、在途并发及旧格式停止记录均有单独处理。 |
| 收紧自然语言委托的解释 | 明确要求、询问操作方法、限制某种动作分别判断。多候选时核对完整运行标识。 | 一般聊天、询问和否定不能新授予受限副作用。原有明确委托仍按其实际范围处理。 |
| 收紧状态证据 | 区分已观察、在途、未确认与最近已知状态。同一手动请求绑定其原回执。 | 旧记录缺少当时证据时保持未确认；只读核对不补充自动轮次。 |
| 修订规范与开发文档 | 对齐托管资源、会话隔离、有限次计划、托盘退出、CPU 资源判定、Agent 执行边界与运行时启动身份。 | Git 标签固定历史索引；修正和验证另记为发布后的工作。 |

旧项目中布尔值 `false` 与 GPU 编号 `0` 在 Python 比较时曾相等。用户明确纠正这一字段后，项目编辑现在按实际 JSON 类型保存并推进修订。旧版定时委托若仅存关键词推断的权限，已有远端计划保留；新建、改动或停止计划时只使用有对应人工指示的用途。约束识别覆盖受支持的中英文直接指令、询问和限制表达。复杂条件或指代需明确具体动作和对象。

### 后续工作与验收条件

| 顺序 | 用户仍可能遇到的情况 | 可以减少报错的下一步 |
| --- | --- | --- |
| 1 | 旧路由只返回自由文本，Agent 或界面仍需从文案推测权限、超时和结果未知。 | 优先给提交、取消、更新三个入口增加同一形式的“派发前拒绝／已发待核对”结构化回执。验收时分别模拟发送前失败及回执丢失，核对同一请求不会重复发出。 |
| 2 | 工具组合中，单组件通过后仍可能在消费者加载阶段才发现 ABI、物种或端口不兼容。 | 把目标消费者的有界加载探针移到冻结前。验收包括真正加载所选产物和一个确定不兼容的组合，保留失败证据。 |
| 3 | 老版本 worker、站点限制或混杂的 GPU 查询输出可导致某项能力缺失。 | 把当前能力、最近一次观察和重查入口显示在受影响控件旁。特别核对多卡清单中单行损坏，以及原源失联后另一个源继续工作的情况。[设备清单](../../backend/worker/studio_worker/transport/routes.py) |
| 4 | 单作业的集群提交和监控已支持，SSH/Slurm 整图冻结与上下游消费仍缺完整执行适配。 | 上游运行、文件身份、下游消费、重连后原调度号和交付验收均有证据时再开放该整图路线。目前保留局部门槛。[流程覆盖范围](workflow-io-roadmap.md) |

## 索引口径与复查

索引从发布标签逐文件读取第一方 JS/TS/TSX、Python、CMD、PowerShell、NSIS、受支持的嵌入代码以及带失败原因的 PyGAS 声明。范围覆盖前端、Electron、Agent、主进程、worker、启动、安装、发布入口和开发者随附接入工具。内容包括抛出点、间接拒绝、结构化失败返回、状态、界面诊断目录和上层转发。同一句话在两处触发，保留两项。中英文同一显示键合并查找。生成的类型声明、测试夹具、第三方软件的任意 stderr 及用户脚本没有固定的产品文案。

每条记录保留源文件、行列、所属函数、表达式、可定位分支、原因分类与设计处置。静态语法无法证明全部调用路径、发生频率或所有动态拼接后的最终文本。混合返回值需结合实际回执解释，缺少可独立归因的分支明确指回其调用者。索引内列出动态代码边界。下列命令从标签重建索引，读取该提交的文本；解析过程不导入该提交的产品模块。

```sh
python -B scripts/diagnostics/inventory.py --revision v0.1.13 --output docs/development/diagnostics-0.1.13.html
```
