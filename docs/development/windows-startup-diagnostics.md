# Windows 原生启动异常与启动边界

## 已确认的故障

Electron 44.5.1 在创建界面前，以当前进程令牌派生一个低完整性受限令牌，并检查其能否读取发行目录的 `icudtl.dat`。本轮 `0x80000003` 弹窗对应该检查失败后的 fatal 路径；离线转储以精确匹配的符号恢复了 `CheckSandboxedProcessesCanReadInstallDir → LogMessageFatal → HandleFatal` 调用链。调试器继续执行断点后记录的 `ud2 / C000001D` 是同一 fatal 出口的下一条指令。

同一程序、文件安全描述符、参数和独立空配置的对照确认：普通非管理员桌面上下文能打开界面；受限执行上下文的派生令牌读取被拒绝。独立只读探针中，两边原令牌都可读取该文件，受限上下文再次派生后的 restricting SID 集合收窄，读取返回拒绝；普通上下文的派生令牌仍可读。这不是凭弹窗错误码或启动时间作出的判断。

[Electron 的对应源码](https://github.com/electron/electron/blob/v44.5.1/shell/browser/win/install_dir_access.cc)实际检查访问结果，没有枚举文件 ACL 中的 AppContainer SID。其 fatal 文案关于特定 ACL 条目的说明是固定推断，不能直接当作本机权限事实。[Windows CreateRestrictedToken 文档](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)说明：父令牌已经受限时，新 restricting SID 集合取交集。

## 低完整性可执行文件：另一种已确认原因（2026-11-16）

本次本地源码安装出现相同的 `0x80000003`，但精确匹配 Electron 44.5.1 的符号将调用栈定位到 `sandbox::policy::Sandbox::Initialize` 中创建隔离窗口站的检查，并非上节的 `icudtl.dat` 读取检查。独立 `--version` 探针的 `CreateAltWindowStation` 返回 `SBOX_ERROR_CANNOT_CREATE_WINSTATION`（12），Windows 错误为 `ERROR_ACCESS_DENIED`（5）。

研究目录的低完整性标记被 Electron EXE 继承。实际读取子进程令牌确认：父终端为高完整性，Electron 主进程却是低完整性 `S-1-16-4096`，且 `IsTokenRestricted` 为 false，因此现有启动前检查不会拦截。按 [Windows 完整性控制规则](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)，新进程取启动者和 EXE 文件完整性等级的较低者；从正常桌面双击也不能消除 EXE 自身的低完整性标记。[Chromium 对应检查](https://github.com/chromium/chromium/blob/152.0.7977.130/sandbox/policy/sandbox.cc#L49-L74)在应用 JS 执行前完成。

本机对照使用缓存的同版本官方 Electron 压缩包，在当前用户的正常程序目录重新解压运行文件，不复制旧安全描述符；两份 EXE 的 SHA-256 完全相同。新位置的 `--version` 退出 0，经原源码启动器打开的实际窗口可响应，renderer 保持 `--enable-sandbox`。本地将依赖的 `dist` 目录接到该位置，旧目录保留为备份；未修改研究目录权限、所有者、系统策略或 profile。这个目录连接是本机安装修复，不是随 Git 分发的自动修复；如果依赖重装替换了连接，需重新检查运行文件的实际存放位置与完整性等级。[本轮证据与范围](../releases/aimatterlab-0.1.1.md#2026-11-16-本地源码安装修复验证)。

另修复 [CMD 源码入口](../../Launch-AIMatterLab.cmd) 的退出判断：`if errorlevel 1` 只覆盖大于等于 1 的值，而 `0x80000003` 在 CMD 中是负数。入口现在保存原退出码，按“不等于 0”判断，打印数值并暂停；1、7 和 `0x80000003` 的真实 CMD 子进程回归均通过。

## 源码运行文件别名导致本地终端拒绝启动（2026-11-16）

Electron 依赖的 `dist` 经目录连接指向实际程序目录时，桌面可正常启动，但 `process.execPath` 仍保留连接路径。终端运行时会逐级拒绝源路径中的链接，因而返回 `terminal_runtime_invalid_source`，界面将其显示为“终端运行文件暂不可用”。直接从实际 EXE 路径启动时，同版本资源准备通过，PTY 所需文件均齐全。

[源码启动器](../../scripts/desktop-launch.mjs)现在在正常上下文预检后解析 Electron 的真实路径，再启动桌面；不放宽终端运行时的防链接校验，不改 ACL 或进程令牌。源码版用户更新后关闭并用原入口重新打开即可，不需要自行修改目录连接或重新配置 SSH。若已发布版本存在相同问题，需要由开发者更新入口；不能把反复重启旧版当作修复。

## 统一启动入口

- 源码启动使用 `node scripts/start.mjs`，也就是 `npm start`；开发入口在启动 Vite 前运行同一检查。
- `node scripts/start.mjs --preflight-only` 只检查上下文。允许时返回 JSON 和退出码 0，阻断时返回退出码 2，不加载或启动 Electron。
- Windows 探针只读取自身令牌。受限上下文或无法完成检查时，输出具体的 blocked 原因，再由调用方选择正常桌面执行上下文；不要求管理员账户，不自动提权。
- 安装预检、桌面验证和生成的启动器使用同一入口。Windows 优先使用生成的 `Launch-AIMatterLab.cmd`；PS1 保留兼容，但不调整系统执行策略。固定探针通过命令标准输入运行，不传入外部脚本内容，不覆盖执行策略。
- 探针限制为 10 秒、64 KiB 输出。安装阶段在依赖安装与构建前检查上下文；进程失败或未产生新报告时，已有成功报告不能覆盖本次失败。

桌面程序应在普通交互式桌面上下文启动。Agent 获得正常桌面执行权限后再调用该入口，或由用户从正常桌面启动。不要从同一个失败的受限上下文反复直接运行 Electron、旧 smoke 脚本或解包 EXE。计算作业仍按 worker 的项目范围独立管理。

## 验证与排障

本轮启动器 11 项定向 Node 测试及安装器 23 项定向软件测试通过；后者使用模拟子进程，不代表完整安装验收。真实受限上下文的 start/dev/preflight 均在 Electron 启动前阻断，独立配置未创建；普通非管理员上下文检查通过，实际 renderer 到达当前首页。原生首失败、修复前探针问题、调用栈与只读权限对照分别保存在忽略的证据目录。

后续原生错误先记录确切启动收据及 Windows System/Application Popup 事件，再核对进程、模块、异常与线程栈；Application Error/WER 中没有记录不代表没有弹窗。转储和原始环境信息只保存在私有忽略目录，使用匹配符号离线分析。遇到同类问题，不通过禁用 Electron sandbox、修改整个仓库的 ACL、清空用户配置或重装科学环境来掩盖失败。

本次没有修改 ACL、进程令牌、系统调试器或执行策略，没有运行科学引擎或提交集群作业。旧的通用应用异常仍须按实际来源诊断，不能将所有 `0x80000003` 自动归为本原因。


## 诊断收尾

转储收集器退出、失败进程消失或一份“计划清理”的记录，都不能证明 Windows 系统错误框已关闭。收尾需实际读取残留对话框，以异常和既有事件/转储核对来源，只关闭已确认的诊断残留，再核对原生窗口列表和正常工作台交互。不要仅凭产品标题把旧错误框归因于当前开发版，也不要为清理旧框修改无关启动代码。
