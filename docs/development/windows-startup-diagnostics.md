# Windows 原生启动异常与启动边界

## 已确认的故障

Electron 44.5.1 在创建界面前，以当前进程令牌派生一个低完整性受限令牌，并检查其能否读取发行目录的 `icudtl.dat`。本轮 `0x80000003` 弹窗对应该检查失败后的 fatal 路径；离线转储以精确匹配的符号恢复了 `CheckSandboxedProcessesCanReadInstallDir → LogMessageFatal → HandleFatal` 调用链。调试器继续执行断点后记录的 `ud2 / C000001D` 是同一 fatal 出口的下一条指令。

同一程序、文件安全描述符、参数和独立空配置的对照确认：普通非管理员桌面上下文能打开界面；受限执行上下文的派生令牌读取被拒绝。独立只读探针中，两边原令牌都可读取该文件，受限上下文再次派生后的 restricting SID 集合收窄，读取返回拒绝；普通上下文的派生令牌仍可读。这不是凭弹窗错误码或启动时间作出的判断。

[Electron 的对应源码](https://github.com/electron/electron/blob/v44.5.1/shell/browser/win/install_dir_access.cc)实际检查访问结果，没有枚举文件 ACL 中的 AppContainer SID。其 fatal 文案关于特定 ACL 条目的说明是固定推断，不能直接当作本机权限事实。[Windows CreateRestrictedToken 文档](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)说明：父令牌已经受限时，新 restricting SID 集合取交集。

## 统一启动入口

- 源码启动使用 `node scripts/start.mjs`，也就是 `npm start`；开发入口在启动 Vite 前运行同一检查。
- `node scripts/start.mjs --preflight-only` 只检查上下文。允许时返回 JSON 和退出码 0，阻断时返回退出码 2，不加载或启动 Electron。
- Windows 探针只读取自身令牌。受限上下文或无法完成检查时，输出具体的 blocked 原因，再由调用方选择正常桌面执行上下文；不要求管理员账户，不自动提权。
- 安装预检、桌面验证和生成的启动器使用同一入口。Windows 优先使用生成的 `Launch-Studio.cmd`；PS1 保留兼容，但不调整系统执行策略。固定探针通过命令标准输入运行，不传入外部脚本内容，不覆盖执行策略。
- 探针限制为 10 秒、64 KiB 输出。安装阶段在依赖安装与构建前检查上下文；进程失败或未产生新报告时，已有成功报告不能覆盖本次失败。

桌面程序应在普通交互式桌面上下文启动。Agent 获得正常桌面执行权限后再调用该入口，或由用户从正常桌面启动。不要从同一个失败的受限上下文反复直接运行 Electron、旧 smoke 脚本或解包 EXE。计算作业仍按 worker 的项目范围独立管理。

## 验证与排障

本轮启动器 11 项定向 Node 测试及安装器 23 项定向软件测试通过；后者使用模拟子进程，不代表完整安装验收。真实受限上下文的 start/dev/preflight 均在 Electron 启动前阻断，独立配置未创建；普通非管理员上下文检查通过，实际 renderer 到达当前首页。原生首失败、修复前探针问题、调用栈与只读权限对照分别保存在忽略的证据目录。

后续原生错误先记录确切启动收据及 Windows System/Application Popup 事件，再核对进程、模块、异常与线程栈；Application Error/WER 中没有记录不代表没有弹窗。转储和原始环境信息只保存在私有忽略目录，使用匹配符号离线分析。遇到同类问题，不通过禁用 Electron sandbox、修改整个仓库的 ACL、清空用户配置或重装科学环境来掩盖失败。

本次没有修改 ACL、进程令牌、系统调试器或执行策略，没有运行科学引擎或提交集群作业。旧的通用应用异常仍须按实际来源诊断，不能将所有 `0x80000003` 自动归为本原因。


## 诊断收尾

转储收集器退出、失败进程消失或一份“计划清理”的记录，都不能证明 Windows 系统错误框已关闭。收尾需实际读取残留对话框，以异常和既有事件/转储核对来源，只关闭已确认的诊断残留，再核对原生窗口列表和正常工作台交互。不要仅凭产品标题把旧错误框归因于当前开发版，也不要为清理旧框修改无关启动代码。
