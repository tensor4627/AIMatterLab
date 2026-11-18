# AIMatterLab 本地测试库

本目录测试 AIMatterLab 自身的组件、接口、权限和持久化行为。相邻科学引擎、工具包内的测试及其通过标准由各工具维护，不在本库的整理范围内，也不会被以下默认入口执行。

## 按改动选择入口

| 层次 | 入口 | 证明什么 |
| --- | --- | --- |
| 全部 Node 工程检查 | `node scripts/test-node.mjs` | 发现并执行 `tests/` 下全部 `.test.mjs`；不按版本或历史批次过滤 |
| 受影响领域 | `node scripts/test-node.mjs --suite=frontend,contracts` | 按目录选择，重复选择不会重复运行同一文件 |
| 精确回归文件 | `node scripts/test-node.mjs --file=tests/frontend/agent-send-lifecycle.test.mjs` | 仅运行指定的本库测试；可重复 `--file`，可与 suite 取交集 |
| 查看选择结果 | `node scripts/test-node.mjs --suite=frontend --list` | 只列文件，不执行；未知领域、外部文件、空选择均报错 |
| Worker 生命周期 | `node scripts/test-worker.mjs --pattern=test_launch_protocol.py` | 在明确的 Linux/WSL 环境执行 AIMatterLab worker 测试；不切换引擎环境 |
| Worker 目录与预检查 | `node scripts/test-worker.mjs --list` / `--preflight-only` | 分别查看本库文件、核对实际可用的执行环境 |
| 全部 Worker 检查 | `node scripts/test-worker.mjs` | AIMatterLab worker 的完整工程测试；不等于科学引擎验收 |
| 浏览器渲染回归 | `node scripts/frontend-regression.mjs` | 真实组件、布局和输入事件，服务请求为隔离替身 |
| 桌面新手引导 | 构建后运行 `node scripts/setup-guide-native.mjs` | Windows Electron 实测首次配置、重启续接、升级、主题及字号、教程与工作页往返。使用独立配置，截图和结果在 `.studio/setup-guide-native/` |
| 会话侧栏定向交互 | `node scripts/conversation-sidebar-regression.mjs` | 当前 App、悬浮菜单、项目层级和键盘／主题／边缘布局；隔离模拟 IPC。设置 `STUDIO_SIDEBAR_ELECTRON=1` 使用实际 Electron 自动输入；证据写入 `.studio/conversation-sidebar-20261112/` |
| 已暂存运行时校验 | `node scripts/package-runtime.mjs --validate` | 只读核对已存在构建资源、依赖、平台文件与版本；不安装、不打包 |

Node 领域为 `agent`、`backend`、`contracts`、`desktop`、`frontend`、`integration`。文件按受测责任归属；涉及多层契约的测试保留在 integration。Node 自身的过滤选项继续支持，例如 `--test-name-pattern="history"`。文件数和源代码中的 test 定义数不等于执行用例数，参数化测试以运行日志的统计为准。

浏览器测试可按行为选择，证据留在忽略目录：

```powershell
$env:STUDIO_FRONTEND_FILTER = 'review-fixes-|experience-settings-'
$env:STUDIO_FRONTEND_OUTPUT = '.studio/local-checks/renderer'
node scripts/frontend-regression.mjs
Remove-Item Env:STUDIO_FRONTEND_FILTER
Remove-Item Env:STUDIO_FRONTEND_OUTPUT
```

筛选没有匹配用例会失败，不能将“零项运行”报告为通过。真实 Electron 模式另有启动身份要求；浏览器通过不能改称原生窗口通过。真实模型、SSH、MP、工具安装、科学计算使用单独隔离场景和显式授权，不自动附带在工程测试后运行。

## 需要显式环境的补测

默认运行中的 `skipped` 不代表通过。以下 AIMatterLab 自有用例需要单独满足前置条件；不修改跳过条件或断言来消除跳过记录。

| 测试文件 | 前置条件 / 开关 | 实际范围 |
| --- | --- | --- |
| `agent/scientific-opes-analysis.test.mjs` | `STUDIO_TEST_PYGAS_SOURCE` 指向现有 pyGAS 源码；可用 Python 标准库 | 只读核对源码 receipt、CLI 参数、权重表达式与 AIMatterLab adapter；不运行科学分析或引擎测试 |
| `agent/workspace-materialize-transport.test.mjs` | Windows 设置 `STUDIO_TEST_WSL_DISTRIBUTION` 为已存在的发行版 | 真实 WorkerClient、Python dispatch 和原子创建；独立临时数据库与服务，不接生产 worker |
| `backend/tool-package-registry.test.mjs`、`integration/managed-tool-context.test.mjs` | 平台允许创建真实文件符号链接；Node 支持 `node:sqlite`，Git 可用 | 真实相对链接、迁移和越界拒绝；Linux 通过不能写成 Windows 原生链接通过 |
| `integration/terminal-session-native.test.mjs` | Windows、已有 Electron/ConPTY 依赖，`STUDIO_TEST_TERMINAL_NATIVE=1` | 独立终端服务、真实 shell、交接隔离和退出码；不连接已有终端 |

设置环境后使用精确文件入口，例如 `node scripts/test-node.mjs --file=tests/agent/workspace-materialize-transport.test.mjs`。开关仅用于本次测试进程，不写入产品配置；用后清除。不同平台的补测结果单独记录，不改写原全库统计，也不将重复执行的普通用例累计成新增覆盖。

## 测试组织与合并规则

- `helpers/` 存放测试底座和领域模拟服务，`fixtures/` 存放合成输入；二者不直接注册测试。
- 发送、准备取消、历史恢复和迟到回执统一在 `frontend/agent-send-lifecycle.test.mjs`。原 `agent-send-blocked.test.mjs` 和 `agent-experience.test.mjs` 的有效断言保留；resume/read 两种恢复失败共用参数化场景。草稿持久化与问答各自保留专门文件。
- 设置页入口与保存回归共用 `helpers/settings-page-hooks.mjs`，执行实际 SettingsPage 的 hooks，避免各文件自建过期 React 桩。
- 结果页与审阅页回归共用 `helpers/run-detail-hooks.mjs`；保留未挂载后写入检测、迟到返回和时间推进能力。
- 工具包与工作流面板共享组件执行底座，各自保留模拟服务、版本/授权/归属数据与业务断言。这些是 AIMatterLab 集成测试，不是工具包自带测试。
- 不因标题相近或同时涉及同一函数就删除用例。组件、接口、安全拒绝、真实渲染分别验证不同边界，不能相互替代。候选合并要先列出旧场景到新场景的对应关系，再确认断言与失败可见性保留。
- 不为了减少统计数量删除晚到响应、不同 owner、重复点击、部分生效、unknown 不重提等独立风险用例。不按发布版本新增一份整套相同矩阵。

## 结果记录

按受影响层次先做定向回归；修改测试发现/共享底座后，复核相关选择范围并运行完整 Node 基线。共享前后端契约两端均测。科学数值验证只在执行或数值受影响且工程契约不足以验证时单独选择路线。

原始日志、临时数据库、截图、真实服务记录放 `.studio/` 等忽略目录。发布文档写明命令、范围和 passed / failed / blocked / not_run；初次失败与修复后的结果分别保留。不得把旧证据算作本轮新运行，或把合成服务通过写成真实后端/科学通过。

本轮整理的对应关系及验证结果见 [1.0.2-dev.2](../docs/releases/v1.0.2-dev.2.md)。
