# GPU Sampling Studio 代码架构

产品要求见 [软件规范](software-specification.md)，迁移依据见 [重组方案](development/repository-reorganization.md)，实现与验证范围见 [v1.0 记录](v1.0.md)。本页描述当前源码所有者，不表示所有科学引擎均已通过新的工具配置路线。

自 `1.0.1` 起，本文描述的源码所有者边界（前端 / 后端主进程 / Python worker / Agent）作为正式 Studio 本体设计基线冻结；后续变化必须同步更新本页与版本记录，并遵守 1.0 起的向后兼容与版本化迁移约定。

## 源码入口

```text
frontend/
  app/                    React 入口、工作台装配和导航
  features/               会话、流程、工具、计算、工作区、运行和专业编辑界面
  api/                    renderer 的类型化 IPC/worker 客户端
  ui/                     通用组件、文本、主题和展示辅助
backend/
  main/
    tools/                工具包、Git 版本、流程定义和来源
    compute/              连接、配置、执行协调、终端和 worker 传输
    workspace/            桌面索引、草稿、资产、审阅及流程实例协调
  worker/
    studio_worker/
      tools/              引擎适配、测试判据和工具操作
      compute/            环境登记、运行与调度生命周期
      workspace/          输入快照、文件布局、产物与流程事实
      transport/          HTTP/MCP 的认证、路由和序列化
      infrastructure/     Store、文件、进程及独立资源清单
    tests/                worker 工程测试
agent/
  providers/              模型服务适配
  sessions/               会话、请求生命周期和后端事实到会话的组合
  context/                模型上下文装配
  skills/                 指导选择、受限读取和封存策略
  tools/                  对后端和共享终端的受限调用
  builtin-skills/         Studio 自带公共指导
contracts/                DTO、schema 与无特权的跨边界验证规则
desktop/                  main/preload 启动和桥接
  platform/               原生进程、凭据、对话框和系统适配
developer/                外部作者的独立接入 skill 与交付说明
installation/             安装与环境就绪检查
tests/                    frontend/backend/agent/contracts/integration 工程检查
```

旧 `src`、`shared` 和一次性内部转发入口已由实际消费者替换。Python 保留 `studio_worker` 包名及必要的旧模块/CLI 入口；它们转发同一实现和模块命名空间，避免破坏独立服务、既有进程协议及测试注入。

## 请求与状态归属

前端只拥有展示和未发送的编辑状态，通过 `frontend/api` 请求主进程。`desktop/main.mjs` 保留启动装配、可信 sender 校验与 IPC 注册；业务委托对应后端或 Agent 所有者。原生能力通过宿主适配器传入，后端不反向引用前端或 Agent 提示词。

桌面 Catalog 保存会话、任务草稿、版本引用和索引。worker Store 保存权威 Run、不可变输入、配置和流程事实；JSON 镜像可重建，不能代替 Store 判定作业状态。关闭桌面不会结束已提交任务；未知运行只观察和核对，不自动新建尝试。交互式 SSH/本地终端属于本次桌面生命周期，正常退出会有界关闭；保存的连接配置保留，下一次建立新终端。旧终端缓存仅作历史诊断，不用于恢复本次操作权限。

首次连接与只读恢复共用 WSL stdio relay：每个请求先证明 Linux 已接受的连接属于同用户、同 root/port 的 worker，再在同一 socket 发送原权限令牌；桌面不向未经证明的 Windows localhost 监听者发送 worker 凭据。连接接受前核对 name/root/runtime/execution_policy；relay 失效清理桥接、来源与 Agent 租约，不停止 worker 或作业。

本地启动通过 Store 的 compare-and-set 在创建 supervisor 前保存唯一 `launch_claim`，未确认启动使用既有 `unknown` 状态。`compute/launch_protocol.py` 为 supervisor 提供排他认领、持久化身份/载荷校验及取消与子进程创建的 SQLite 排序门。恢复先核对既有启动证据，不重新派发；旧格式任务与回执保持兼容，数据库 schema 及公开状态枚举不变。

集群提交在归档后于共同 Store 锁内重新核对当前授权、输入和本地/集群并发数，持久保存 `unknown` 占位后才发送 SSH 请求。独立校验和草稿修订不能把已提交父任务改回可提交状态。本地启动最终认领时检查项目修订号，授权变更后留待重新校验。集群查询使用可选的观察标识拒绝旧回复和旧错误，终态与完成回执不因迟到查询或提交回复退化；旧记录按首次新查询获得标识，不扫描或迁移真实作业。

已保存的交互 SSH 连接可将已有共享终端绑定为当前计算资源，引用精确的 profile/version/session。Agent 按该资源的明确交接使用 Terminal MCP，已有本地 worker 不抢占这条路由；人工接管立即撤销终端读写权限。绑定不重开 SSH、不自动交接，也不改变 worker 或项目授权。终端通道状态与 SSH 认证、托管 Run 状态分别记录。

`agent/sessions/terminal-handoff.mjs` 协调显式首次交接：没有真实 thread 时调用已有会话入口创建空会话，再授予同一终端权限。主进程校验 provider、终端 epoch、连接版本、资源及会话修订；前端采用返回的真实会话并迁移尚未发送的草稿。终端节点及 PTY 在面板切换时保留。宽屏首页与普通会话不再强制隐藏内容栏。

Agent 从后端取得结构化事实，再生成模型上下文。MCP 和模型回复不能修改授权，也不能将计划、安装说明或推断变成真实运行结果。人工审阅执行门保留在真实来源和当前版本上。

外部 Agent CLI 的版本探测、能力检查、隔离初始化、正式启动及登录使用统一环境白名单，保留系统、用户目录、语言、代理及证书配置；服务商配置和当前 MCP token 只通过该服务商的显式字段传入。Codex 保留已有登录目录。任意宿主环境变量、其他服务商密钥和代码加载开关不再隐式继承；此行为不改写已保存凭据或登录文件。

## 工具、配置与流程

工具包保留作者 Git 仓库布局，交付说明和重定向位于外层 `工具名-package`。包登记、安装验证和实际执行分别记录；新版本采用独立快照，旧任务保留原版本。开发者入口见 [developer](../developer/README.md)。

用户配置依据已登记环境及工具声明完成真实安装和逐功能测试，激活绑定具体版本与环境的执行 skill。日常选择、手动读取、MCP 和引用展开共用封存规则；封存判断发生在文件读取之前。精确故障修复或重新安装只开放所需前置材料。

工具组定义包含端口、依赖、参数默认值和最终产物，并保存精确不可变版本。工作空间选定组与配置后，worker 建立流程/执行/步骤/Run 目录。准备产生真实草稿与输入回执，审阅确认后提交同一个 Run；状态查询和作业返回导航不会推进步骤。

新的完整配置与逐步执行参考路线目前限定固定串行 CPU `installation.check` 工程示例。通用资源边执行、其他第三方工具安装及现场科学适配需要各自实现和验证；既有引擎路线继续保留其真实支持范围。

科学联用配置的责任位于 Studio：从开发者交付的 `aimlab-tools` 接口声明和使用指导解析所选组，区分产物阶段与同进程运行组件，为每个必须共同运行的完整依赖闭包配置兼容的版本化环境，并验证实际产物及完整组合。预置接口类型覆盖已声明支持的力场—MD 和增强采样—MD 联用；三者组合须有对应的完整组证据。这是待实现的通用配置能力，不改变上述固定 CPU reference 的当前边界；开发者声明、skill 文本和单工具测试都不能直接激活科学组。详细要求见[依赖组审查](development/tool-dependency-groups.md)。

## 分发与证据

源码 worker 位于 `backend/worker`，目录包继续映射到 `worker` 并解包，以保持已部署启动协议。宿主向源证据读取器传入实际 worker 资源根；固定清单之外、缺失或错误来源均拒绝。公共指导从 `agent/builtin-skills` 单独映射到 `studio-skills`；私有工具包、配置、凭据和运行证据不进入发布源。

引擎和工具 JSON 契约由 `contracts` 维护，构建同步到独立 worker；安装器、运行时标识、独立 wheel 和桌面包核对相同资源。源码迁移不搬用户数据库、连接、环境、授权或真实作业，也不改兄弟引擎仓库。

工程测试按实际变更层选择。`pnpm test` 递归发现 Node 工程测试，`node scripts/test-node.mjs --list` 只列清单；worker 测试从 `scripts/test-worker.mjs` 进入。原生验收与科学检查使用独立显式入口，保留 `passed / failed / blocked / not_run` 及原始证据，不将组件夹具或工程 CPU 进程当作科学验证。
