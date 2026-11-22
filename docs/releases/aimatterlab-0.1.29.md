# AIMatterLab 0.1.29 Windows 本地测试版

2026-11-22

Windows 原生 SSH 使用实际的 ConPTY 控制台与 `xterm`。启动时向网关报告 `100×30`，随后同步登录终端的尺寸。使用 Windows OpenSSH 连接远端集群无需在本机安装 WSL。

## 试用

1. 退出旧版后，可在原工作区安装 Windows x64 测试版，或把便携版解压到单独目录试用。进入计算资源，选择保存的连接，确认显示「Windows OpenSSH」并点击「交互式登录」。
2. 在私有终端完成密码、验证码和网关的资产、节点选择。看到进入节点后的命令提示符，再点击「登录完成，交由 AIMatterLab 管理」。
3. 核对原远端工作区路径。核对成功会显示远端解析后的目录，确认后完成交接。

「未找到记录」出现在网关的资产选择阶段。回环测试复现了 0.1.28 向网关报告 `0×0` 的问题。本版已纠正该行为，真实网关的资产列表仍待用户复测。[Windows OpenSSH 终端说明](https://github.com/PowerShell/Win32-OpenSSH/wiki/TTY-PTY-support-in-Windows-OpenSSH)

如果 Windows OpenSSH 不可用，登录诊断的「详情」会提示从 Windows 可选功能安装，或在连接设置中选择已有的 `ssh.exe`。[Microsoft OpenSSH 客户端说明](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse)

## 内置指导

核对了 11 个内置技能、37 份正文和引用、科学功能目录、运行时指令和逐轮提示。本版更新安装技能与计算发现参考，说明 Windows SSH 的本机依赖及资产和节点交接时机。对照了设置入口、登录按钮、工具作用域、回执字段与现有引擎契约。其余 35 份内置文档和 25 份运行时指导与 0.1.28 的通过范围相同。旧对话的远端资源路由由逐轮提示和工具测试核对。[计算资源选项](../ssh-cluster-management.md) · [工具及授权](../../backend/main/compute/managed-compute-resources.mjs) · [逐轮提示](../../agent/sessions/resource-routing.mjs)

## 验证范围

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 定向源码回归 | passed | 167 项 Node 测试覆盖 Windows SSH、终端运行时、登录回执、WSL SSH 兼容、重新登录和客户端选择。1 项远端 Linux 中继测试覆盖输出、退出回执和并行取消。TypeScript 构建通过。 |
| 扩展 SSH 回归 | failed | 756 项中 746 项通过。其余 10 项在 `v0.1.28` 基线上同样失败，涉及旧登录 Shell 回执夹具和主进程切换处理器的测试装配。 |
| 源码与内置指导 | passed | 契约副本、开发者工具包 12 个文件、文档链接、61 项技能及契约测试通过。源码技能读取覆盖 41 项功能、16 种引擎、17 项源码引用、36 条路由和 37 份文档，其中 8 条混合路由检查了外部技能共享。 |
| Windows 桌面入口 | passed | 三项隔离 Electron 用例覆盖手选节点后的目录重试与原连接状态恢复。另用成品保存和打开模拟连接，核对 Windows 客户端标记、编辑页的 WSL 提示和缺失 `ssh.exe` 的诊断详情。 |
| 随包 SSH 运行时 | passed | Windows 10 x64 上，用成品 Electron 44.5.1 和系统 Windows OpenSSH 9.5.4.1 连接本机模拟网关。收到 `xterm` 与 `100×30`，调整窗口后收到 `108×36`。通过私有密码与二步验证、手选节点、显式交接和工作区回执。两条独立无终端命令及按需终端通过，32 KiB 输出逐字节一致。Windows 客户端路径未调用 WSL，模拟远端 Linux 由本机 WSL 提供。 |
| 安装器与便携包 | passed | 分别隔离解包并检查程序、ASAR、4 个变更的应用源码文件、140 个构建产物和 16 个终端服务文件。实际 `read_scientific_skill` 在每份包中通过 36 条路由读回 37 份正文及引用，25 份运行时指导与源码一致。 |
| 完整性与签名 | passed | 7 项 SHA-256、签名更新清单及安装器和块索引的 SHA-512 均匹配。安装器签名者与项目固定证书一致，本机 Windows 的证书信任检查为 `UnknownError`。 |
| 真实站点与安装升级 | not_run | 真实网关的资产列表、用户原工作区的安装升级、实际调度作业和科学计算待各自场景验证。 |

## 成品校验

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `AIMatterLab-0.1.29-win-x64-setup.exe` | 158584056 | `c5e503a69368662add4be2d0e704632e10badabf0e9eb982c9af1cf1984c70f4` |
| `AIMatterLab-0.1.29-win-x64.zip` | 211539196 | `6f1b5c42e2e498603828706c4293cbb4c8c7ca741e0f092d8934002d0705fd33` |
