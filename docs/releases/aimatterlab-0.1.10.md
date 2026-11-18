# AIMatterLab 0.1.10（未发布）

以下为南大 [PR !3](https://git.nju.edu.cn/Tensor4627/AIMatterLab/-/merge_requests/3) 在提交 `5ebcf81` 上的未发布版本记录。最终的首次使用流程和本地验证见 [0.1.14 发布说明](aimatterlab-0.1.14.md)。

2026-11-18 · [更新日志](../../CHANGELOG.md)

Codex 独立 home 首次启动仅补充本机 `.env`，已有文件不覆盖，后续不重复同步；保留已有对话、登录、连接、凭据和运行状态。安装和启动发现 Windows 系统 HTTP/mixed 代理，统一用于下载和 Agent 子进程；工具与资源新增机器学习哈密顿量入口，后端待接入。

当前源码版本为 0.1.10，安装清单引用为预定发布引用 `refs/tags/v0.1.10`，不表示该标签或安装包已发布。0.1.9 的成品及签名证据仍属于原版本。

## Codex `.env` 首次初始化修订（2026-11-18）

本节记录 0.1.10 源码修订的验证；未重新构建、签名、打标签或发布安装包。

应用创建独立 subscription home 时执行一次 `.env` 初始化。源码 Launch 和安装包共用 `desktop/main.mjs` 的入口，以已解析的 `userData/provider-contexts/codex/subscription-home` 为目标。来源沿用 `CODEX_HOME` 优先、用户 `.codex` 后备规则。目标已有文件时不覆盖；首次尝试写入 `.env-initialized`，源缺失或复制失败后也不在升级及后续启动重试，需用户按实际路径手动复制。CMD 仅报告结果、错误代码和目标，不打印配置内容，也不宣称代理连通。

| 状态 | 范围 | 结果 |
| --- | --- | --- |
| passed | 初始化、认证与隔离 | `node --test --test-concurrency=1 tests/agent/codex-env-initialization.test.mjs tests/agent/codex-subscription-runtime.test.mjs tests/integration/codex-isolation.test.mjs`：131 项通过。涵盖复制成功、源缺失、源读取/复制失败、目标已有及并发创建不覆盖、只复制 `.env`、不重复同步、CODEX_HOME 与用户目录后备、保留现有会话/历史/凭据/连接/运行记录 fixture。现有首次登录、登出后不复用、账户不覆盖、刷新不切换账户、取消登录及隔离测试通过。 |
| passed | 启动与 profile | source-start、desktop-launch、workspace-installer、studio-profile 定向测试：39 项通过，核对默认、自定义及安装包 profile 规则和启动继承输出。 |
| blocked | 依赖缺失 | 上述启动测试中 1 项无法加载本地 Electron；额外 `codex-send-lifecycle.test.mjs` 无法加载 TypeScript。原始 runner 记为 failed，原因均为 ERR_MODULE_NOT_FOUND，未安装额外依赖。 |
| passed | 文档与补丁 | 文档链接检查 `DOC_LINKS_OK files=150`；`git diff --check` 通过。 |
| not_run | Windows 原生与成品 | 4 项 Windows 专属测试在 Linux 上 skipped；未重新打包或执行 Windows CMD 原生首启，安装包启动覆盖基于共用入口及路径契约，原生输出仍待成品核验。 |
| not_run | 真实模型与科学计算 | 未自动发送模型消息，未运行科学回归，未修改真实 profile、登录、连接或作业。 |

原始日志保存在受 Git 忽略的 `.studio/validation/codex-env-init/`。测试使用临时 fixture，并在结束时清理；现有用户配置不参与测试。

## 代理与 Electron 初次检查（修复前）

修复前检查确认安装入口和 Agent 子进程未自动读取 Windows 系统代理；Electron 主进程的 `net.fetch` 则支持系统代理/PAC。源码入口仅继承已有环境变量，未自动启用 Electron 下载器的环境代理。初次检查阶段尚未实现系统代理桥接；下方专项修订补充该能力，也未改用户系统或 Clash 配置。Rule/Global 是进入 Clash 后的路由策略，与系统代理及 TUN 区分。

Electron 44.5.1、锁定的 @electron/get 5.1.0 及官方资源路径已核对。npm 元数据、GitHub release API 均成功读取；Windows x64 ZIP 和 SHASUMS256.txt 的 HEAD 均为 200，重定向到 release-assets.githubusercontent.com，ZIP 声明为 157,998,329 字节。未下载完整二进制，也未在用户 Windows 网络复现失败，不能将其归因于唯一原因。可操作的本机配置及官方来源见[代理与 Electron 下载说明](../network-and-electron-install.md)。

## 0.1.10 本轮验证

| 状态 | 范围 | 结果 |
| --- | --- | --- |
| passed | 当前源码定向测试 | 单并发运行 codex-env-initialization、codex-subscription-runtime、codex-isolation、source-start、studio-profile：156 项通过、0 失败；2 项 Windows wrapper 测试 skipped。 |
| passed | 子进程环境 | agent-environment：10 项通过，确认代理环境变量传递边界和 provider 隔离。它们不验证系统代理自动发现或真实网络连通。 |
| passed | 版本一致性 | package、安装清单、STUDIO_VERSION 均为 0.1.10；构建输出目录 release/v0.1.10；发布清单 distribution_status=not_run。 |
| passed | 文档 | DOC_LINKS_OK files=152；补丁空白检查通过。 |
| passed | 官方资源检查 | npm、GitHub release 元数据及两项官方资源 HEAD 检查通过；范围仅为开发节点。 |
| not_run | 本机真实链路与发布 | Windows/Clash 实测、完整 Electron 下载、0.1.10 成品构建与签名、原生 CMD 首启、真实模型请求及科学回归均未执行。 |

本轮原始测试日志在忽略目录 `.studio/validation/0.1.10/`。上节首次验证日志仍保留原路径和范围；缺少 Electron/TypeScript 的历史受阻项没有改记为通过。未创建或推送发布标签。

## 系统代理适配与哈密顿量入口专项修订

新增进程级代理发现模块：优先复用显式代理环境变量，未配置时只读查询 Windows 当前用户启用的 ProxyEnable、ProxyServer 和 ProxyOverride。支持 Clash 单 HTTP/mixed 地址和分别配置的 HTTP/HTTPS 代理。源码 Launch 在安装锁定依赖及 Electron 运行时之前准备代理；单提示词安装器通过私有 JSON 管道取得网络环境，并传给 pnpm 安装、构建和桌面验证。应用首启同样发现代理，在初始化网络请求前设置 Chromium 默认 session，Agent 子进程继承代理及 Node 环境代理开关。

保留既有 NO_PROXY，补充回环地址；不开启或改写系统代理、不持久化代理地址、不改用户配置与真实运行状态。不打印代理地址和凭据，不将发现代理描述为连通成功。没有代理时保持原系统/TUN 行为。PAC-only 配置会提示：Chromium 可处理 PAC，CLI/安装器仍需显式 HTTP/mixed 代理；不声称任意 PAC 或 SOCKS 配置均已适配。

工具与资源 → 计算与建模新增“机器学习哈密顿量”，与力场训练器并列。详情展示数据准备、模型训练、独立评估、哈密顿量重构和能带分析，明确后端待接入；没有引擎绑定或执行按钮，没有新增作业或注册 HotHam 后端。补充英文文案与入口图标。

| 状态 | 范围 | 结果 |
| --- | --- | --- |
| passed | Node 定向检查 | 63 项通过，2 项 Windows wrapper 测试 skipped。覆盖系统代理解析、显式配置优先、HTTP/HTTPS 分流、Electron session 配置、代理/Node 开关、NO_PROXY 合并、禁用代理与读取失败提示、源码安装/Electron 修复/构建/启动环境传递、现有 Codex 认证生命周期、工具目录及翻译完整性。 |
| passed | 真实本地代理契约 | 真实 Node 子进程的 HTTP 和 fetch 请求到虚构外部域名被本地代理接收；本机 worker fixture 直接访问。没有联系真实模型或外部模型域名。临时 HTTP 服务及子进程已清理。 |
| passed | 安装器 | 10 项 Python 定向测试通过；核对安装器代理环境流向 pnpm/构建/验证及代理准备失败时不启动下载，原有受限启动、凭据/profile 保留和新鲜回执门保持有效。 |
| passed | 静态与文档 | Node 入口语法、Python AST、文档链接及 git diff --check 通过。 |
| not_run | 原生与成品 | Windows 当前用户注册表实机读取、Clash 系统代理真实模型链路、Electron 成品下载、原生窗口交互及安装包构建尚未执行；当前登录节点没有 Electron/TypeScript 依赖，不将目录契约测试称为原生 UI 验收。 |
| not_run | 科学与发布 | 未运行科学回归，未发送真实模型消息，未提交作业、打标签或推送。 |

本轮原始证据在受忽略目录 `.studio/validation/0.1.10/proxy/`；此前检查记录保留原时间和范围。
