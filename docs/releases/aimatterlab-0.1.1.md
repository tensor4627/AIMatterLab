# AIMatterLab 0.1.1 验收记录

2026-11-14 · Windows x64 · [六项更新](../../CHANGELOG.md)

| 范围 | 结果 | 验证 |
| --- | --- | --- |
| SSH 终端与作业服务 | passed | 201 项定向测试通过。Windows ConPTY 和 WSL OpenSSH 回环实测一个登录连接、两个独立会话终端、跨会话读取拒绝、切回与超时唤醒、复用同一远端作业服务及退出清理。超时场景使用可控时钟。 |
| 空闲设置 | passed | 隔离 Electron 实例默认 60 分钟。界面保存为 75 分钟后重启，设置读回一致。 |
| 工具调用显示 | passed | 隔离 Edge 验证 7 个场景，含窄栏、键盘、流式追加、操作按钮和阅读位置。13 项相关 Node 测试通过。 |
| Markdown | passed | 16 项解析测试通过。隔离 Chromium 和 Electron 的实时、历史消息渲染共 4 项通过。 |
| 项目技能工作区 | passed | 91 项定向检查通过。五类服务商经实际 MCP 读回项目技能，修改、重启、隔离、冲突和中断恢复通过。官方 DSH 子进程使用模拟模型响应验证工具转发。 |
| 集群增量更新和位置登记 | passed | 173 项 Node、22 项 Linux 测试通过。回环服务首次安装、两次零 worker 字节重连，以及单文件修改、新增、删除通过。SQLite 重开后读回位置，并在 Chromium 和隐藏 Electron 中核对设置页。[传输字节与验证范围](../development/ssh-service-delta-validation.md)。 |
| Git 源码启动 | passed | 37 项 Node 检查、6 项隐藏 Electron 场景通过。版本号变化仅重构，另经真实子进程验证并发和中断恢复。首次准备、重复启动、改源码重构、改锁文件重装、设置读回、与便携版共用 profile 的互斥均已验证。[源码启动指南](../source-desktop.md)。 |
| Windows 发行文件 | passed | 从 ZIP 实际解压启动，界面版本 0.1.1。新配置将终端空闲时长从 60 改为 75 分钟，便携 EXE 使用同一配置读回 75，打开五个工具的克隆命令和安装指南，然后正常退出。两个 EXE 的九档图标均与深紫双峰 ICO 逐个一致。ZIP 完整性、开发者工具包和五项 SHA-256 校验通过。 |
| 安装入口 | passed | 单 prompt 安装说明从发布标签解析完整 Git 提交，校验产品、版本和源码引用。示例配置的安装计划通过。 |
| 独立科学引擎、真实集群和付费模型 | not_run | SSH 和传输采用真实回环服务。本轮未提交科学作业或发起付费模型请求。 |

## 2026-11-16 本地源码安装修复验证

本节随 PR !2 保留原作者的历史报告，引用的运行日志未随 Git 分发。当前合并的独立验证见 [0.1.5 记录](aimatterlab-0.1.5.md)。

本节是 Windows 11、系统 Node.js 24.22.1 / pnpm 11.28.5 的新增证据，不替代上表的历史验收。保留 pnpm 默认隔离依赖布局，不启用 `shamefully-hoist`，不关闭严格构建检查，不生成发行包。

- 经用户明确批准，在[工作区依赖策略](../../pnpm-workspace.yaml)中允许四个原待审批依赖的安装脚本；安装与定向重建均退出 0。
- 修复[DSH 运行时暂存脚本](../../scripts/stage-dsh-runtime.mjs)与[运行时检查脚本](../../scripts/package-runtime.mjs)对间接依赖的根目录解析：现在沿 `electron-builder → app-builder-lib → semver` 的声明关系定位模块，不执行 builder 入口，不新增或提升依赖。

| 范围 | 结果 | 证据与限制 |
| --- | --- | --- |
| 修复前复现 | failed（预期复现） | 新增四项布局回归中，隔离布局两项报 `MODULE_NOT_FOUND`，提升布局两项通过。见[修复前日志](../../.studio/local-checks/source-install-fix-20261116/resolution-before-fix.log)。 |
| 定向 Node 回归 | passed | 五个测试文件共 76 项通过，0 failed / skipped。覆盖两种依赖布局、运行时完整性与边界检查、源码缓存和启动上下文。见[测试日志](../../.studio/local-checks/source-install-fix-20261116/targeted-tests-after-fix.log)。 |
| 官方入口安装与构建 | passed | 使用未修改的[官方 CMD 启动器](../../Launch-AIMatterLab.cmd)，完成锁定依赖安装、类型检查、前端构建、CLI 资源准备和运行时暂存；未使用额外启动参数。见[入口日志](../../.studio/local-checks/source-install-fix-20261116/official-launch-after-fix.log)。 |
| 已暂存运行时只读检查 | passed | `node scripts/package-runtime.mjs --validate` 退出 0；核验 2 个终端运行时包、197 个 DSH 包和 22,696 个 DSH 文件，以及 191 个应用模块。此命令不打包。见[验证日志](../../.studio/local-checks/source-install-fix-20261116/runtime-validation.log)。 |
| 修复前 GUI 与手动双击 | failed（已复现） | 独立 `--version` 探针退出 `0x80000003`，Node `spawn` 收到 2147483651；用户确认正常桌面双击也仅控制台一闪而逝。原 CMD 入口使用 `if errorlevel 1`，漏掉以负数表示的原生退出码。保留原始[栈探针](../../.studio/local-checks/source-install-fix-20261116/native-stack.log)。 |
| 原生原因定位 | passed | 精确匹配的 Electron 44.5.1 符号将异常定位到 `Sandbox::Initialize` 的隔离窗口站创建检查。[符号解析](../../.studio/local-checks/source-install-fix-20261116/resolved-native-frames.log)与单步探针确认 `CreateWindowStationW` 错误 5、`CreateAltWindowStation` 结果 12。研究目录低完整性标记被 EXE 继承，实际主进程令牌为低完整性但不受限；不是仅凭错误码推断，也不是此前 `icudtl.dat` 读取失败。见[根因与对照记录](../../.studio/local-checks/source-install-fix-20261116/native-root-cause.json)和[排障说明](../development/windows-startup-diagnostics.md)。 |
| 本地运行文件位置修复 | passed | 从缓存的同版本官方 ZIP 将运行文件重新解压到当前用户的正常程序目录；EXE SHA-256 前后一致。保留旧低完整性目录，以目录连接将原依赖 `dist` 指向新位置。原依赖路径的 `--version` 退出 0，无需全局环境覆盖，不改权限、所有者、系统策略、profile 或科学环境。该本机连接不随 Git 分发，重装依赖后需复核。 |
| 启动器定向回归 | passed | 源码启动与桌面启动两个测试文件共 33 项通过，0 failed / skipped；新增真实 CMD 检查覆盖 1、7、`0x80000003` 的错误提示、暂停与原退出码保留，原带空格和 shell 字符的 profile 参数测试仍通过。[回归日志](../../.studio/local-checks/source-install-fix-20261116/source-launch-tests-after-fix.log)。 |
| 修复后官方入口 GUI | passed | 原快捷方式目标保持为官方 CMD，未加参数或持久环境覆盖。实际窗口标题 AIMatterLab、版本 0.1.1、可响应，沿用原 profile；主进程完整性正常，renderer 以 `--enable-sandbox` 运行且无 `--no-sandbox`。正常关闭一次后再次经相同入口启动，窗口保留供继续测试。见[窗口收据](../../.studio/local-checks/source-install-fix-20261116/official-window-receipt.json)、[窗口截图](../../.studio/local-checks/source-install-fix-20261116/official-window.png)和[保留窗口收据](../../.studio/local-checks/source-install-fix-20261116/retained-window-receipt.json)。 |
| 修复后手动双击快捷方式 | not_run | 快捷方式目标、空参数和工作目录已核对，与上述通过的官方入口一致；自动化调用 Windows Shell 打开 LNK 时自身挂起，未创建应用进程，已取消该调用。不能将此调用记为手动双击通过；待用户后续确认。 |
| 科学功能与发行打包 | not_run | 未发起模型请求、SSH 连接或科学计算，未生成任何发行包。 |

复现定向检查：

```powershell
node scripts/test-node.mjs --file=tests/integration/build-tool-resolution.test.mjs --file=tests/integration/stage-dsh-runtime.test.mjs --file=tests/integration/package-tooling.test.mjs --file=tests/integration/source-start.test.mjs --file=tests/integration/desktop-launch.test.mjs
node scripts/package-runtime.mjs --validate
```
