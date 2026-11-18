# AIMatterLab 0.1.14

2026-11-19 · Windows x64 · [更新日志](../../CHANGELOG.md)

本版在本地 0.1.13 `4341744` 上整合南大 [PR !3](https://git.nju.edu.cn/Tensor4627/AIMatterLab/-/merge_requests/3)（`5ebcf81`），以及经评审的 Codex 首次使用修改（`65c4f38`）。

## 使用变化

- 安装器、源码启动器和桌面优先采用显式代理。Windows 也可发现已启用的静态系统代理，向下载和 Agent 子进程传递代理设置。桌面保留显式绕过项和本机回环；含凭据的代理地址在 Chromium 路由中只保留服务器地址。[代理与 Electron 下载](../network-and-electron-install.md)
- 首次连接 Codex 时，新用户可直接进入 ChatGPT 登录。已有配置的用户可选择代理设置、整份 `.env` 或全局默认模型和推理强度。已有独立文件会保留。模型和档位在登录后逐页核对，缺少任一项时由用户确认可用配置。[Codex 首次使用](../source-desktop.md#首次使用-codex)
- “计算与建模”提供机器学习哈密顿量入口，列出数据准备、模型训练、独立评估、哈密顿量重构和能带分析。计算后端仍待接入。

## 验证记录

| 状态 | 范围 | 结果 |
| --- | --- | --- |
| passed | 协议、状态与安装 | 279 项定向 Node 测试和 10 项 Python 桌面安装器测试通过，覆盖 Codex 登录、首次选择、模型分页、并发取消、代理发现与工具目录。 |
| passed | 代理路由 | 在 Windows 上使用真实 Electron 和本地测试代理。确认请求经过代理、worker 走回环直连，短主机名遵循显式绕过设置，Chromium 的路由规则中不含代理凭据。 |
| passed | 桌面交互 | 在原生 Electron 中完成 8 项交互检查。覆盖新用户登录、可选迁移、模型及推理档位的匹配与手动确认，以及哈密顿量规划页。模型目录及发送回执使用测试数据。 |
| passed | 新用户与打包应用 | 实际 Windows 成品使用空白临时资料和 Codex CLI `0.169.0-alpha.11.1`。从“连接 Codex”到达浏览器和设备码登录选项，账号状态为未登录。成品可打开五阶段哈密顿量页并正常退出。 |
| passed | 构建与分发文件 | TypeScript、Vite、Windows CLI 解包与包内资源核对通过。核验签名更新清单、安装包和块索引 SHA-512，以及交付清单中 7 项 SHA-256。核对包内 135 个前端及 CLI 文件和 36 份内置技能文档。便携 ZIP 与开发者 ZIP 的全部条目通过 CRC 校验。 |
| not_run | 外部服务和科学计算 | 未使用用户账号完成真实授权或模型调用，未提交集群作业或进行引擎数值验证。 |

Windows 安装包 `AIMatterLab-0.1.14-win-x64-setup.exe` 为 158,413,096 字节，SHA-256 为 `96379417e8dcb4eb5f47c9088c4f06ba21f827ed936c4cd67582eeb63e0ab6ac`。便携包 `AIMatterLab-0.1.14-win-x64.zip` 为 211,346,808 字节。项目签名者匹配，验收机的 Windows 信任链报告自签根证书未受信任。交付物位于 `release/v0.1.14/`。

原始验证记录保存在集成工作树的忽略目录 `.studio/validation/release-0.1.14/`。
