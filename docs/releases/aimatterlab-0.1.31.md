# AIMatterLab 0.1.31 源码验收

2026-11-23 · Windows 桌面源码

桌面改版从 0.1.29 的 `eea5bbb` 开始开发，合入远端 0.1.30 的 `5137873`。会话的队列、历史与证据入口和新版布局一同交付。[逐区块评审与开发计划](../development/frontend-design-review.md) · [0.1.30 验收记录](aimatterlab-0.1.30.md)

## 本版发布范围

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| SSH 资源页状态核验 | passed | 40 项定向 Node 测试及 TypeScript 检查通过。模拟连接覆盖状态查询超时、清单不完整、原连接恢复和已确认退出。结果见 `validation/local/ssh-console-status-tests.txt` 与 `validation/local/ssh-console-inventory-tests.txt`。 |
| SSH 资源页原生窗口 | passed | 隔离 Electron 窗口的桌面和紧凑布局两项均通过。用本地模拟回执点击「刷新状态」，核对待核对期间保留选中连接和终端、恢复在线，以及确认失联后出现重连入口。结果见 `validation/local/managed-compute-20261119/native-resource-console/results.json`。 |
| SSH 登录、终端和会话恢复 | passed | 桥接测试 48/48，重连集成测试 9/9。原有 5 个失败用例已按需调用 `openShell`，覆盖登录回执丢失、重复查询、终端所有权和关闭后查询。记录见 `validation/local/ssh-console-bridge-tests.txt` 与 `validation/local/ssh-console-relogin-tests.txt`。 |
| 本机 OpenSSH 核验超时与关闭 | passed | Windows 和 WSL 客户端分别登录本机临时 sshd，每台仅认证一次。暂停 Windows PTY 输出使真实状态探测超时，恢复读取后核对原连接 ID、Shell ID 和会话变量；明确关闭该连接后，另一条 WSL 连接仍能执行命令。记录见 `validation/local/ssh-console-loopback.txt`。 |
| 合并后的前端 Node 回归 | passed | `frontend-031-final.txt` 中 1,132 项全部通过。修复了合并首轮出现的规划控件重复、终端草稿传递、重复轮次 ID 夹具及翻译遗漏。 |
| Agent、IPC 与技能定向回归 | passed | `contracts-agent-031.txt` 中 100 项全部通过，覆盖草稿归属、队列、证据权限、历史、设置持久化契约和技能读取。 |
| 布局、提示与 SSH 交接 | passed | `layout-031/results.json` 中 7 个原生 Electron 用例通过。另用实际桌面检查 13 个布局操作，包括 640 像素窗口、设置取消、保存和重启恢复，见 `priority-xKnQl1/result.json`。SSH 用例使用本地模拟回执。 |
| 0.1.30 会话功能的合并回归 | passed | `chat-031/results.json` 中 8 个原生 Electron 用例通过，覆盖附件解析及草稿交接、引导和排队、历史分页与归档、活动定位、证据选择与回看。 |
| 窄栏会话与停止反馈 | passed | `compact-031-final/results.json` 中 6 项通过，其中 3 项为新增场景。在 320 像素对话栏、28 像素文字下保留完整输入行，浅色主题的停止按钮在可用与悬停时分别达到 7.77∶1 和 10.15∶1。 |
| 0.1.31 桌面启动 | passed | `validation/local/chat-turn-desktop-pZT2e0/result.json`。隔离配置下核对窗口显示的应用版本、沙箱、上下文隔离及渲染器无 Node 访问。 |
| 0.1.31 桌面会话与附件 | passed | `validation/local/chat-turn-desktop-UsLFb9/result.json`。真实主进程与 DSH 通过本机端点完成 4 回合、5 次请求，核对文字、图片原始字节、后台排队、前台草稿、停止续发、仅附件消息及重新加载后预览历史。前两轮分别记录了冷连接超时和窄栏新建会话入口缺失，最终复验通过。 |
| 源码指导与构建 | passed | TypeScript、Vite、文档链接、9 份契约副本和 12 个开发者包文件通过。内置指南核验 11 个技能及 37 份正文和引用、41 项科学功能与 16 种引擎、17 项产品源码引用和 36 条读取路由，含 8 条混合路由。 |
| 随包运行时的构建输入 | passed | `runtime-031.json` 核对 0.1.31 版本标识、CLI 安装组件、Windows x64 原生终端模块和固定版本 DSH 的 30,540 份暂存文件。 |
| Windows 签名更新和版本标签 | blocked | 当前 Windows 帐户缺少项目固定证书的签名私钥。正式成品的签名、两种成品提取和发行源仍待核验。 |
| 真实模型、站点和科学数值 | not_run | 本次合并验证桌面处理、IPC、会话归属和已授权证据入口，相关界面使用隔离配置和本机回环数据。 |

结构预览的使用指导同步了总数、元素图例、悬停与键盘帮助，并核对合并后的运行详情文件与帧选择。其余内置正文及运行时指导沿用 0.1.30 的审阅记录，源码读取在本版重新验证。原始日志留在 `validation/local/design-review/` 与 `.studio/`。

## 合并前的改版验收

本节保留从 0.1.29 开始改版和修复阶段的原始记录。

从 Git 基线单独提取源码，在 1366×768 深色与 1024×768 浅色大字号下采集了原生工作台对照截图。一次试采遇到 Electron 的空白启动页未发出 Playwright 窗口事件，改用独立静态启动文档和有时限的等待后取得基线。实现阶段的首次组件集成也检出了测试用 React 替身缺少 hook、字段帮助与旧展示结构不一致等问题。

验收分为独立配置启动的实际桌面程序，以及带合成回执的隔离 Electron 窗口。前者检查正常入口和操作，后者覆盖需要已有记录、错误和等待状态的页面。截图、测试目录和原始日志位于本地忽略目录 `validation/local/design-review/` 与 `.studio/setup-guide-native/`。

## 验收范围

| 检查 | 结果 | 证据与界限 |
| --- | --- | --- |
| 改版前工作台 | passed | 两个原生窗口保留了同一 Git 基线的原始 PNG，见 `validation/local/design-review/baseline-source/validation/local/captures/`。 |
| 最终桌面工作台 | passed | `product-qw7BmD/result.json` 记录 19 个检查点。独立新配置从引导进入首页、工具、数据资产、运行记录与算力，保存浅色大字号设置。在 1366×768、1024×768、640×720 的实际窗口分别验收；640 下可用键盘输入对话草稿。渲染器错误为零。 |
| 解释、焦点和动效 | passed | `help-release/results.json` 两个原生用例均通过。中英文、深浅色分别验证悬停、Tab 聚焦、Enter 重开、Esc 先关帮助再关弹窗、提示位置与辅助技术描述关联。实际桌面也测得设置弹窗正常动画 120 ms，开启减少动态效果后关闭动画。 |
| 桌面导航、对话与菜单 | passed | `shell-chat-final/results.json` 与 `shell-chat-native-rerun/results.json` 合计 25 个不同用例均取得原生通过回执。首轮 4 个失败的用例逐项完成复测。 |
| 英文大字号与窄窗资产 | passed | 英文界面在 24 px 下的深、浅主题两项均通过，见 `shell-chat-extra-final/results.json`。640 px 的资产补测见 `shell-chat-asset-final/results.json`，覆盖空列表、当前项目过滤、登记行与生成和搜索入口的顺序，以及切换对话后保持选择。 |
| 设置、算力、SSH 与结果预览组件 | passed | 3 份 `resources-settings-…component.txt` 分别记录 312、50、7 个通过用例。含保存和重试、项目授权、独立通道与旧预览不能覆盖新选择。 |
| 设置与资源窗口交互 | passed | `resources-settings-native/results.before-download-rerun.json` 首轮 11 项中 6 项通过，另 5 项在最终原生渲染器中全部复测通过，见 `resources-integrated/results.json`。覆盖首次选资源、API 配置、文件切换、下载与断连维护。 |
| 大字号三栏 SSH 托管 | passed | `resources-settings-native-handoff/results.json`。1240×800、24 px 实际输入合成验证码，点击托管，确认工作区；原人工终端和未发送的草稿仍可使用。夹具已按 v0.1.29 的工作区确认入口更新。 |
| 首次设置、恢复与操作教学 | passed | `.studio/setup-guide-native/run-m7P5CO/result.json`。真实主进程和预加载层、隔离用户配置，检查跳过、重新打开、保存、键盘聚焦与不同主题字号。 |
| 科学流程图 | passed | `.studio/workflow-roadmap-ZZ61QK/receipt.json` 的 11 项原生检查。短流程的首尾节点在启动、1366 和 1024 宽处可点击；另测浅色 24 px、键盘缩放和详情、长达 32 次调用的图、平移、固定标题与阶段参数定位。使用离线规划数据。 |
| 流程编辑与对话的组合布局 | passed | `science-en-integrated/results.json`。英文 24 px 下，右侧对话深色和居中对话浅色两种布局的步骤均可点开。进度文字可折行，输入框和发送按钮可见，按键发送使用模拟事件。 |
| 科学工作区界面 | passed | `science-native/results.json` 首轮 29 项中 15 项通过。另 14 项在最终原生渲染器中全部通过，见 `science-integrated/results.json`。覆盖草稿隔离、资产登记和预览、结构与帧切换、自定义 CV、未知写入后只读核对、作业筛选与技能发现。 |
| PyGAS 组合器 | passed | `science-pygas/results.json` 中深色通过，浅色 360 px 用例等待真实输入焦点后复测通过，见 `science-pygas-light-retry/results.json`。检查定位缺项、单位、编辑数值、从库中添加和展开节点。使用合成图。 |
| 窄栏远端文件下载 | passed | `resources-settings-native-narrow/results.json`。在宽 521 px 的工作区点中真实下载按钮，核对取消、错误、成功及 SHA256 三组模拟回执。修正了旧版保存栏遮挡按钮的问题。 |
| 改版首次全量前端 Node 测试 | failed | 基线和首次改版均为 1093 项中 1084 通过、9 项失败。失败名称逐项一致。基线证据为 `baseline-source/validation/local/captures/tests.txt`，改版证据为 `frontend-audit.txt`。 |
| 修复后的全量前端 Node 测试 | passed | `frontend-repairs-final.txt`：1096 项全部通过。原有失败的行为均有相应断言，诊断修复补验了目标身份不一致、项目切换与延迟返回。 |
| 居中布局、保存与恢复 | passed | `priority-6bYqYA/result.json` 记录修复前实际窗口中菜单勾选与面板位置不一致。修复后 `priority-YSdx0q/result.json` 的 13 个检查点涵盖首页、运行、工具、已收起的对话、640 像素单栏、设置取消和保存、两个页面组分别重启恢复。另见 `layout-regression/results.json` 的草稿、键盘和拖动分隔条检查。 |
| 类型、构建与源码指导 | passed | TypeScript、Vite 生产构建、文档链接、`git diff --check` 和 `node scripts/check-bundled-guidance.mjs --source` 通过。可视化指导随结构预览、运行详情和源码依据更新。 |
| 科学引擎和模型 | not_run | 此轮修改交互与展示。引擎、数值计算、线上模型和集群作业不在验收范围内。 |
| 发布安装包 | not_run | 本轮交付开发工作区改动。 |

## 九项失败的根因与修复

| 原失败项 | 原因及复验 |
| --- | --- |
| 定向修复草稿（1） | 旧测试要求会话 B 等待 A 的回复结束。现核验 B 的选择已确认后可写入草稿，A 的回执不会重复追加或自动发送。 |
| 诊断返回原会话、迟到或不匹配的选择（2） | 旧测试抽取 App 函数片段，遗漏了真实依赖。改从部署诊断进入 App，同时修正从有项目的会话进入无项目会话时沿用旧项目的问题。原生复验覆盖确认追加、草稿隔离与零发送，见 `shell-chat-diagnostic-repair/results.json`。 |
| 命令面板和会话选择的忙碌保护（2） | 旧断言假定 Agent 回复会全局锁住会话。现验证独立会话可选，进行中的模态操作继续持有自己的锁。 |
| 渲染端路径与引擎名称（1） | 路径断言通过。预期引擎清单漏了已有的 `trajectory.density`，已补齐名称与顺序。 |
| 从运行详情返回流程（1） | 旧测试把其他会话的回复视为拒绝导航的条件。现验证取消替换未保存编辑、拒绝和过期回执均保留当前视图，收到原会话的选择确认后才定位步骤。原生复验见 `conversation-navigation-native/results.json`。 |
| 中英文历史产物（2） | 两个语言用例把 React 的内部 key 当作裸记录 ID。现核对用户看到的顺序、本地和集群同 ID 记录各自的导航、未知产物的只读展示。 |

结果预览的两个测试选择器在首次改版验收阶段已经修正，保留其原始复验记录。

表内没有以前缀标明的本地证据均相对于 `validation/local/design-review/`。产品启动验收和带模拟回执的渲染检查使用各自的配置与证据目录。
