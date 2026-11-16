# AIMatterLab 0.1.2 服务商与模型配置验证

2026-11-16 · Windows 11 x64 · Node.js 24.22.1 · pnpm 11.28.5 · Electron 44.5.1

本地在 `main` 整理提交；计划的合并请求来源为 `fix/provider-model-configuration`，目标为当前仓库的 `main`。本次是源码更新，未生成 ZIP、便携 EXE 或安装包。

## 用户可见变更

- Qwen 与自定义 API 采用 DSH 的组织方式：每个服务商分别保存地址、协议、模型列表及能力，再在对话中选择模型和推理等级。
- 支持 `openai-completions`、`openai-responses`、`anthropic-messages`。模型与工具循环由固定版本 `@deepseek-ai/dsh-llm-pi-ai` / DSH SDK 0.2.2-rc.1 处理，不再依赖 Qwen CLI 或自定义 API 的 Codex 网关。
- 模型发现可搜索并选择加入；已有模型的推理映射不被发现结果覆盖。发现仅说明接口返回该模型，不代表已验证访问或能力。未知模型仍可手动添加。
- 每个模型可编辑上下文、最大输出、文本/图片输入、思考格式，以及界面等级到 API 值的映射。运行时只接受模型声明的推理等级。
- 输入框上方提供模型与推理等级选择，偏好按服务商配置及模型分别保存。Qwen 页面不再要求 OAuth 或 CLI，也不再增加内嵌编辑区滚动条。
- 增加 DeepSeek Account 认证方式，使用官方 DSH Messages 适配器及账户专用请求头，不把账户令牌当作 API Key。仅允许官方地址；令牌过期后需重新导入。
- 已有 ChatGPT/Codex 同账号登录可直接复用，不覆盖较新的本机令牌；本机导入记录可保留 DSH 选中的模型、名称与推理档，并与 Codex 实际能力取交集。

## 凭据、历史和授权

- 密钥只由 Electron 主进程通过系统 `safeStorage` 加密保存；列表与编辑页只返回是否已保存，不返回密钥。配置目录和本地检查材料均被 Git 忽略。
- 原 Qwen/Coding Plan 与自定义 API 凭据复制为一次性迁移配置，原记录不删除。移除迁移配置不会在下次打开时自动重建。
- 新对话绑定配置 ID、准确地址和协议。现有对话不能切换服务商配置；修改其地址或协议后必须恢复原配置或新建对话。地址变化必须重填密钥，不将旧密钥自动发送到新地址。
- 同一配置内可切换模型；DSH 恢复原生会话，不重放工具操作。旧自定义 API 的文本历史只在原地址、原协议下作为惰性参考迁移，工具调用不重放。
- **兼容性变化**：旧 Qwen ACP/CLI 会话不能在新的 API 模式恢复，需新建 API 对话。原 CLI 数据、计算流程和运行记录保留。0.1.x 不承诺旧开发会话的无损运行时迁移。
- 计算项目、SSH、环境、作业与现有服务商权限分组不变。公开科学指导仍须满足原授权，且新增按 API 地址确认的共享开关；新地址默认关闭。原先已授权的来源在迁移配置中保留，不扩大到其他来源。
- 子进程只装载明确列出的 DSH 内核与 AIMatterLab MCP 工具；不提供 DSH 原生 shell、文件、浏览器或子代理工具。没有计算资源时仍可使用 API 对话。

## 验证结果

| 范围 | 结果 | 证据与限制 |
| --- | --- | --- |
| 受影响 Node 回归 | passed | 20 个文件、163 项通过，0 failed/0 skipped。覆盖加密迁移、地址与配置隔离、发现界限、竞态、会话恢复、MCP 权限、分模型偏好及 DSH 暂存闭包。TypeScript 检查通过；所有新增账户行为均包含在最终定向检查内。 |
| 三种模型协议 | passed | 使用真实官方 DSH 子进程与本机合成 SSE 服务，验证 Chat Completions、Responses、Anthropic Messages；不作为三个远端商业服务均已实测的证据。 |
| Qwen 思考参数与工具范围 | passed | 本机服务读回 `off → enable_thinking:false`、`high → xhigh`；Qwen 路径装载的 MCP 工具保持 provider-scoped，普通聊天不含工作流执行工具。 |
| 原生 Electron 界面 | passed | 8 个受影响真实 DOM/输入场景通过，IPC 为合成数据，逐个核对 sandbox=true、contextIsolation=true、nodeIntegration=false。含保存后验证、错误重试、发现合并、多模型、手动映射、密钥不回显和对话选择。 |
| 实际桌面与本机配置 | passed | 使用当前 main、preload 和构建 renderer，读回新旧两份 Qwen 配置、三个导入模型；打开 Qwen 页面并选择 `qwen4-max-preview / high`，未发送对话。密钥为空、无内嵌编辑区滚动。版本更新后重新核对 0.1.2。 |
| 用户已有 Token Plan | passed | 安全复用本机 DSH 中用户明确指定的 Qwen 密钥引用，仅写入 AIMatterLab 的系统加密凭据。使用原地址，不修改用户 DSH。`/models` 返回 23 个条目；导入的 `qwen4-max-preview`、`qwen3.8-flash`、`qwen4-max` 各完成一次空白上下文测试回复，另以 `qwen3.8-flash` 完成 `high → xhigh` 的真实 API 测试。其余 20 个条目未推断为可聊天或已验证。 |
| DeepSeek Account 复刻 | passed | 本机账户令牌加密导入，使用官方 DSH Messages 适配器与 `x-dsh-auth-token`；目录返回的两个模型各完成一次空白上下文回复。原 API Key 配置不覆盖，账户令牌过期后须重新导入。 |
| ChatGPT/Codex 订阅复用 | passed | 确认本机 Codex 为 DSH 订阅的同一账号，不复制或覆盖其较新的令牌。隔离连接与原生目录验证通过；保留 DSH 选中的三个模型、显示名和推理档，与实时原生能力取交集。未用 Codex 发起付费模型测试。 |
| 源码构建与契约 | passed | `pnpm run build` 完成 TypeScript、Vite、CLI installer 资源及固定 DSH 暂存；未调用 `pack` 或 electron-builder 发行命令。 |
| 科学引擎、数值结果、远端 SSH/集群作业 | not_run | 本次未改引擎执行或数值实现，未提交科学作业、未重新认证集群、未重跑科学矩阵。工具隔离使用本机合成服务。 |
| 发行包验收 | not_run | 按用户要求不打包，未建立发布 tag。 |

本地原始证据保存在 Git 忽略目录 `.studio/local-checks/provider-models-20261116/`，包括定向日志、原生交互结果、实际桌面截图与脱敏 API 回执。不把用户地址、密钥、会话内容或本机科学数据加入版本库。

## 本轮修正中发现的问题

- DSH 模型适配器需要作为固定根依赖随运行时暂存，并从可信运行时位置加载，不能依赖用户 DSH profile 的模块解析。
- 小上下文模型不能使用 DSH 默认 65536-token 压缩余量，API profile 改用明确的 2048-token 余量。
- Anthropic base URL 统一为服务根地址，由 SDK 拼接版本路径；测试端覆盖实际 beta 请求路径。
- 界面保存、发现、测试的迟到响应不能更新另一个服务商页；未保存配置不能触发连接验证。

这些失败均已修正并在上述最终检查中通过；不将首次失败计入通过数量。
