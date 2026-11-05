# GPU Sampling Studio 代码架构

产品要求见 [软件规范](software-specification.md)，迁移依据见 [重组方案](development/repository-reorganization.md)，实现与验证范围见 [v1.0 记录](v1.0.md)。本页描述当前源码所有者，不表示所有科学引擎均已通过新的工具配置路线。

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

桌面 Catalog 保存会话、任务草稿、版本引用和索引。worker Store 保存权威 Run、不可变输入、配置和流程事实；JSON 镜像可重建，不能代替 Store 判定作业状态。关闭桌面不会结束已提交任务；未知运行只观察和核对，不自动新建尝试。

Agent 从后端取得结构化事实，再生成模型上下文。MCP 和模型回复不能修改授权，也不能将计划、安装说明或推断变成真实运行结果。人工审阅执行门保留在真实来源和当前版本上。

## 工具、配置与流程

工具包保留作者 Git 仓库布局，交付说明和重定向位于外层 `工具名-package`。包登记、安装验证和实际执行分别记录；新版本采用独立快照，旧任务保留原版本。开发者入口见 [developer](../developer/README.md)。

用户配置依据已登记环境及工具声明完成真实安装和逐功能测试，激活绑定具体版本与环境的执行 skill。日常选择、手动读取、MCP 和引用展开共用封存规则；封存判断发生在文件读取之前。精确故障修复或重新安装只开放所需前置材料。

工具组定义包含端口、依赖、参数默认值和最终产物，并保存精确不可变版本。工作空间选定组与配置后，worker 建立流程/执行/步骤/Run 目录。准备产生真实草稿与输入回执，审阅确认后提交同一个 Run；状态查询和作业返回导航不会推进步骤。

新的完整配置与逐步执行参考路线目前限定固定串行 CPU `installation.check` 工程示例。通用资源边执行、其他第三方工具安装及现场科学适配需要各自实现和验证；既有引擎路线继续保留其真实支持范围。

## 分发与证据

源码 worker 位于 `backend/worker`，目录包继续映射到 `worker` 并解包，以保持已部署启动协议。宿主向源证据读取器传入实际 worker 资源根；固定清单之外、缺失或错误来源均拒绝。公共指导从 `agent/builtin-skills` 单独映射到 `studio-skills`；私有工具包、配置、凭据和运行证据不进入发布源。

引擎和工具 JSON 契约由 `contracts` 维护，构建同步到独立 worker；安装器、运行时标识、独立 wheel 和桌面包核对相同资源。源码迁移不搬用户数据库、连接、环境、授权或真实作业，也不改兄弟引擎仓库。

工程测试按实际变更层选择。`pnpm test` 递归发现 Node 工程测试，`node scripts/test-node.mjs --list` 只列清单；worker 测试从 `scripts/test-worker.mjs` 进入。原生验收与科学检查使用独立显式入口，保留 `passed / failed / blocked / not_run` 及原始证据，不将组件夹具或工程 CPU 进程当作科学验证。
