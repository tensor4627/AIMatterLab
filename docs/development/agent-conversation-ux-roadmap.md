# AIMatterLab Agent 会话优化计划

**实施进度**　本计划的五个阶段及后续提出的文件和图片上传已在独立开发分支实现。下文保留规划时的对照基线。当前交付、验证方法和已知边界见[实施验收表](../releases/aimatterlab-chat-workspace-unreleased.md)。

2026-11-22。对照对象为 Codex 的 VS Code 扩展、Windows 桌面端和公开 App Server。AIMatterLab 以 0.1.29 加本分支会话修复 `0fbdad6` 为基线。

**优先解决“我离开这段对话，它还能不能可靠地继续工作”。** 现在可以边回复边引导、排队，也可以中断后在原会话续发。例如，在 A 对话排两条消息，再去 B 对话看日志，A 的当前回复会完成，队列要等用户回到 A 才会推进。其次值得做的是从工作区选中一段输入或日志，带着准确位置提问，并能从回答回到同一份材料。[本次验证](../releases/aimatterlab-chat-turn-followups-unreleased.md) · [队列实现](../../frontend/features/conversations/follow-ups.mjs) · [聊天输入与发送](../../frontend/features/conversations/Agent.tsx)

## 两个客户端各自值得借鉴的地方

| 表面 | 实际设计与证据 | 适合 AIMatterLab 的用法 |
| --- | --- | --- |
| VS Code 扩展 | 本机 `openai.chatgpt` 版本 `26.1021.22027`。清单把聊天注册为 Webview 侧栏。宿主的 `chatgpt.addToThread` 读取活动编辑器、文件和选区，计算起止行，选区恰好止于下一行开头时会减去该行。`chatgpt.addFileToThread` 也走同一附件入口。用户能在看代码的位置发起问题。[官方扩展指南](https://learn.chatgpt.com/docs/codex/ide) | 在工作流输入编辑器、作业日志和结果预览提供「加入对话」。输入框显示来源、范围和版本，用户可以预览、移除或继续输入。最小可交付对象是一段输入文件和一段日志。 |
| Windows 桌面端 | 本机包版本 `26.1117.4957.0`。排队项显示在输入框上方，支持调整顺序、编辑、发送或移除。快捷键可选默认跟进行为。桌面另有查找对话、对话内查找、未读、跳到下一段需要处理的会话及旁聊入口。[跟进行为](https://learn.chatgpt.com/docs/prompting#steering-and-queuing) · [桌面导航](https://learn.chatgpt.com/docs/app/commands) | 长时计算时，用户可以在左侧找需要处理的会话，在中间读本轮发生了什么，在底部修改下一条消息。流程图、文件预览和作业日志继续在工作区打开。 |
| 两者的审阅方式 | IDE 在编辑器旁显示变更摘要和修改行。桌面审阅面板可在具体行留言，随后将意见作为跟进发回聊天。审阅对象和讨论的位置有明确关联。[IDE 就地审阅](https://learn.chatgpt.com/docs/codex/ide) · [桌面行内审阅](https://learn.chatgpt.com/docs/code-review?surface=app) | 把「这里的步长改为 0.5 fs」绑定到输入版本和参数字段。模型改好后可以在原位查看差异，已提交作业的原始输入仍可追溯。 |

扩展发行包的 `queued-follow-ups-store` 和 `queued-message-list` 分别包含排序、恢复被中断队列、发送待核对提示等操作和呈现逻辑。桌面 `app.asar` 中，前端块 `202338.33802c2827.js` 有重新排序、恢复和立即发送动作，`808817.d75c3e0f28.js` 有未确认投递和恢复提示，`911644.eaf037cac0.js` 同时含有分页方法、游标及按回合分支的参数。上述本机核对针对发行包的清单和可执行 JavaScript。具体 UI 行为同时以对应产品文档交叉核实。下列 Rust 链接固定在公开提交 `cf3ff153`，用于解释协议和回归测试，两个已安装客户端各有自己的发行版本。[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)

## 三条从界面到底层的链路

**1. 引导、停止与下一条消息是三次不同的操作。** 上游 `turn_steer_inner` 取得原线程，校验服务商、输入和 `expectedTurnId`，再把内容和客户端消息 ID 交给当前回合。成功回执返回同一个 turn ID。上游中断测试分别检查错误 ID、有效停止、终态 `Interrupted` 和迟到的审批请求。一次点击停止、控制请求收到回执、原回合已经结束，发生在不同时间。这解释了为什么界面先显示「等待停止确认」，收到终态后才恢复普通发送。[引导实现](https://github.com/openai/codex/blob/cf3ff1530d821ec2d26452da4971d8e3e7d18d25/codex-rs/app-server/src/request_processors/turn_processor.rs#L1151) · [引导回归](https://github.com/openai/codex/blob/cf3ff1530d821ec2d26452da4971d8e3e7d18d25/codex-rs/app-server/tests/suite/v2/turn_steer.rs#L258) · [中断回归](https://github.com/openai/codex/blob/cf3ff1530d821ec2d26452da4971d8e3e7d18d25/codex-rs/app-server/tests/suite/v2/turn_interrupt.rs#L42)

本分支已做到按服务商、会话和回合关联回执。Codex 走原生 `turn/steer`，DSH 通过受限的父子进程通道调用当前原生 Agent，Kimi 的 ACP 适配器提供下一轮排队。队列有本地持久化和发送前标记，重开后待核对的消息不会自动重发。主进程已经可以管理多个运行中的会话。实际启动排队消息的动作仍由当前 React 会话负责，这也是切走后队列要等待的原因。修复中断无需重建线程，下一步接管队列也可以复用这套会话所有权。[会话所有权](../../agent/providers/conversation-agent-hub.mjs) · [DSH](../../agent/providers/dsh.mjs) · [发送入口](../../agent/sessions/requests.mjs)

**2. 历史记录需要同时支持“读过去”和“看刚发生的事”。** 上游的新分页历史把已持久化的启动、完成、中断和条目完成事件投影成回合或条目的变更，再用游标读取列表及详情。客户端可先显示最近一页，用户展开工具时再取详情。当前 AIMatterLab 已经使用稳定条目 ID、合并流式文本并保留阅读位置，恢复时仍用 `thread/read(includeTurns:true)` 读取整段历史，渲染器随后将条目铺成消息列表。长对话首屏和精确回到某一轮都受这条读取路径影响。[历史投影源码](https://github.com/openai/codex/blob/cf3ff1530d821ec2d26452da4971d8e3e7d18d25/codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs#L21) · [分页协议](https://learn.chatgpt.com/docs/app-server#list-thread-turns) · [本项目消息映射](../../frontend/features/conversations/message-mapping.mjs) · [消息分组](../../frontend/features/conversations/ConversationMessages.tsx)

**3. 看过哪条消息、从哪一轮另开讨论，都需要稳定的位置。** 上游已读状态更新携带预期修订号，这能避免旧窗口覆盖新状态。分支测试检查按指定回合截取历史时只复制到该边界。AIMatterLab 已有置顶、分组、重命名、工具折叠、流式阅读位置和原作业入口。侧栏搜索目前匹配会话名称与项目名称，作业提醒有自己的数据来源。给单条消息建立可定位的 `threadId / turnId / itemId`，可以复用于未读跳转、证据引用、搜索命中和另开讨论。[已读状态更新](https://github.com/openai/codex/blob/cf3ff1530d821ec2d26452da4971d8e3e7d18d25/codex-rs/app-server/src/request_processors/thread_read_state.rs#L158) · [分支边界测试](https://github.com/openai/codex/blob/cf3ff1530d821ec2d26452da4971d8e3e7d18d25/codex-rs/app-server/tests/suite/v2/thread_fork.rs#L623) · [当前搜索](../../frontend/app/workspace-shell.mjs) · [会话菜单](../../frontend/features/conversations/ConversationMenu.tsx)

## 功能差距与取舍

| 用户要做的事 | AIMatterLab 当前覆盖 | 建议补齐 |
| --- | --- | --- |
| 边工作边跟进 | 同会话排队和引导，排队项可取消、转为引导或移回草稿，快捷键可对调，重开后可恢复。 | 支持后台按序出队、原位编辑和排序。明确区分服务已接收、尚待发送、投递结果待核对三种状态。 |
| 从几个并行项目中找到需要我的那一个 | 已有会话活动图标、资源徽标、下次唤醒时间和作业提醒。提问和审批出现在所属会话内。 | 左栏增加「等你回答」「结果未读」，点击直达原问题。模型在等用户与调度器在等待资源分别展示。[现有资源状态](../../frontend/features/conversations/ConversationResourceStatus.tsx) |
| 找回上周讨论过的温区或参数 | 标题和项目搜索可用，上翻时会保留阅读位置。 | 加入会话内查找、跨会话正文搜索和命中跳转，支持中文、作业号和文件名。区分编辑器查找与聊天查找。 |
| 告诉模型“就是这几行” | 可附加技能，工作流和诊断页可发起讨论，已有输入审阅、产物选择和工具结果入口。 | 支持显式的选区、日志区间和产物引用。发送前看得到对象和范围，回答中可回跳。大轨迹优先传选择范围和来源。[输入审阅](../../frontend/features/workflows/LocalInputReview.tsx) · [产物选择](../../frontend/features/workflows/ConsumerArtifactPicker.tsx) |
| 了解这一轮做到了哪里 | 有流式回复、工具状态与详情、工作流规划模式、作业回执和上下文用量。 | 展示服务商明确提供的本轮计划和阶段，提交成功后连到调度器作业。压缩发生时显示历史中的边界，帮助用户理解上下文用量变化。[上游事件语义](https://learn.chatgpt.com/docs/app-server#turn-events) · [现有工具卡](../../frontend/features/conversations/ToolActivity.tsx) |
| 审阅一处修改后继续讨论 | 工具结果可指向流程或作业，部分变更能显示文本，输入文件已有独立审阅入口。 | 第一版支持输入参数和文本文件差异、版本与行内批注。结构和轨迹的差异另用科学视图呈现，保留原始文件。[消息与变更呈现](../../frontend/features/conversations/ChatMessage.tsx) |
| 从已有结论试另一种假设 | 当前有新对话、会话恢复和工作流讨论。聊天菜单和允许的 RPC 中尚无从所选回合分支的完整入口。 | 提供引用到新草稿、从此轮另开讨论和返回原文。支持原生分支的服务商按指定回合复制。其他服务商显示将传递的摘录。计算作业继续使用原身份。 |
| 在长对话里快速切回现场 | 已有回底、流式滚动、恢复失败重试、重复条目归并，以及部分 API 的本地历史回读。 | 历史分页、可定位的回合、工具详情懒加载，随后可做单轮书签和可恢复归档。本仓库已有生成的分页与分支类型，新入口仍需对应的类型化 IPC、权限范围和适配器实现。[分页类型](../../desktop/generated/v2/ThreadTurnsListParams.ts) · [允许的传输方法](../../contracts/transport-policy.mjs) |

## 实施顺序与验收

优先级按用户遇到的频率、可能丢失或重复的工作，以及对后续功能的依赖排列。每个阶段可独立交付。以下数字都是拟议验收条件。

### P0 · 让原会话接管队列

把排队记录逐步迁到主进程已有的本地目录索引。每项保存客户端消息 ID、所属服务商和会话、必要的项目与资源绑定、前驱回合及投递状态。由对应会话收到确切终态时领取下一项。渲染器负责显示、编辑、排序和取消。客户端断线后优先用同一消息 ID 对账。已有调度通知提供了按原会话投递的实例，人工跟进需要自己的记录和回执。先开发普通文字路径，再接入已准备的工作流与技能引用。[主进程会话](../../agent/providers/conversation-agent-hub.mjs) · [定向通知投递](../../agent/sessions/wake-delivery.mjs)

验收用两个聊天 A、B。A 排三条后去 B 输入草稿，A 的前驱完成时仅在 A 启动一项，B 的输入和焦点不动。分别在入队、发出、收到回执后重开程序，检查队列顺序与原生调用数。停止 A 时保留其余条目。临时断线且缺少可核对回执时，用户可以在原聊天处理该条。排序只影响尚未投递的条目。

### P1 · 能带着科学证据提问，也能回到证据

先在输入编辑器和作业日志做两个入口。附件显示项目、文件或作业、行段及版本。主进程按该资源现有授权解析引用，发送时只组装选中的内容。输出引用返回同一版本和范围。用已有参数输入审阅作为第一种差异视图，先支持字段前后值、单位和针对该字段的批注。复用原有工作流审阅与执行入口。[输入审阅](../../frontend/features/workflows/LocalInputReview.tsx) · [私有会话范围](../../agent/sessions/private-conversation-context.mjs)

验收让用户从日志第 120–135 行发起讨论，核对首个模型请求的正文、模型回答中的回跳及原日志版本。排队期间切换项目或更换文件版本，旧引用应清楚显示来源变化。测试在任务绑定聊天和已授权的普通聊天各走一次。用户提出「把温度从 300 K 改成 350 K」后，应能审阅输入版本，再决定是否启动新计算。

### P1 · 显示哪一轮需要用户，以及哪些进度已经证实

主进程按原会话发布待答问题、待审批请求和未读完成回执。侧栏提供一个「下一条待处理」入口。会话顶部仅在有活动时显示本轮当前步骤。对支持计划事件的服务商消费 `turn/plan/updated` 或最终计划项，对其他服务商展示实际工具调用与结果。运行状态继续从 worker 读取。[本地提问控件](../../frontend/features/conversations/ComposerQuestion.tsx) · [终端授权控件](../../frontend/features/conversations/TerminalWorkspaceApproval.tsx) · [作业提醒](../../frontend/features/runs/MonitorAttention.tsx)

验收同时制造 A 等用户选择、B 模型回复结束但作业仍排队、C 已断线且提交状态未知。三者应显示不同状态。处理 A 后回到 B，草稿、阅读位置和未读锚点都能恢复。过期的审批与问题不能通过旧 UI 回答。一次已授权的普通队列查询仍能直接完成。

### P2 · 加载、搜索并定位长会话

先给不同服务商提供统一的分页读取结果。支持分页协议的 Codex 走原生游标，本地 DSH 历史可在主进程按稳定 ID 适配，旧历史沿用现有兼容映射。渲染器先显示最近一页，保留阅读锚点，按需取旧页和工具详情。对允许留存的展示文本建立项目范围内的索引，搜索结果附命中片段和目标回合。[本地 API 历史](../../agent/providers/api-model-bridge.mjs) · [阅读位置](../../frontend/features/conversations/reading-position.mjs) · [历史投影](../../frontend/features/conversations/message-mapping.mjs)

验收使用 2,000 轮合成聊天，首屏只读取最近 30 轮，测试首屏请求大小和时间。前插旧页时，同时流入新消息，原阅读锚点保持可见。搜索「350 K」和作业号都能跳到原条目，删除会话会清除其搜索结果。回归同时使用新历史和带重复旧条目 ID 的历史。

### P2 · 从某一轮分支，保留原实验

在消息操作区先加入「引用到草稿」，再加入「从此轮另开讨论」。原生分支能力可用时传递明确的回合边界和新的会话 ID。仅支持文本历史的服务商可用选中内容建立新讨论，并在发送前展示摘录。新聊天记录来源链接。已有作业、SSH 会话、待审批请求和待发送队列均有各自的所有者，分支创建只处理对话历史。[分支协议类型](../../desktop/generated/v2/ThreadForkParams.ts) · [会话绑定](../../agent/sessions/workflow-context.mjs)

验收从第 4 轮提出另一种计算假设。新聊天显示第 4 轮的出处，第 5 轮以后的用户输入只在原聊天可见。分支创建前后计算提交次数相同。需要复制输入时，沿用已有产物选择或输入复制流程，让用户看到实际采用的输入版本。

建议第一批先交付后台文字队列，再把「从日志选区提问」做成完整纵向样例。前者解决现有交互的可靠性，后者能直接检验借来的设计是否减少科研用户来回复制、解释出处和寻找结果的操作。
