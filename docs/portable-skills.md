# 可迁移 skill 与本机配置

发行版提供 `agent/builtin-skills/studio-compute-workflow/`，只保存通用科学流程、环境发现、LSF/Slurm 适配、审阅提交和结果回收规则。它适用于已有本地 WSL 或 SSH 算力；用户目标机器无需安装 Agent CLI。现有环境优先复用，测试请求不隐含安装依赖或修改引擎分支的授权。

科学流程先定义结构、势模型、MD/CV/Bias 和输出；完整后再进入独立部署模块选择计算连接、环境、队列、资源和工作目录。MetaD / WTMetaD 默认一个任务、一个 walker；多 walker、replica 和共享 hills 必须由用户明确选择。短试运行和生产阶段不能被误当作多 walker。

本机特殊值放在 `.studio/local-skills/<profile-id>/`，与发行文件分开。该目录由仓库既有 `.studio/` 规则忽略，不参与 Git、安装包、远端任务或公开报告。连接继续使用 AIMatterLab 的现有登记；overlay 只引用 `connection_ref` 和环境 ID，不再复制主机、端口、账号、密钥、模型 token 或代理配置。

## 生成本机 overlay

先由 Agent 与用户协作只读探测已注册连接，确认 Python/引擎版本、调度器与站点资源语义，再将用户明确选择的元数据写入忽略目录中的 JSON。格式见 [profile schema](../agent/builtin-skills/studio-compute-workflow/references/compute-profile.schema.json)。使用真实登记 ID；其中 version 字段是所选版本的描述，不能充当实际探测证据。

```text
node scripts/localize-skill.mjs --profile <private-profile.json> --repo <checkout-root>
```

必须显式提供 profile。脚本不读取用户级 skill 全文，不扫描用户家目录，不执行 profile 中的任何路径，不连接或安装软件，也不修改 SSH、凭据、环境登记和项目授权。`local_skill_refs` 只保留明确选择的 SKILL.md 路径引用。凭据字段、主机/端口字段、自由 shell 激活脚本、路径遍历和未知字段均被拒绝。

脚本核对目标为精确 Git 根目录、目标文件真实受 ignore 规则保护且未被跟踪，并拒绝目录链接/junction 越界。在临时子目录写完整后重命名，输出 `profile.json`、`SKILL.md` 和 `provenance.json`。已有同 ID overlay 不覆盖；修改时用新 ID 保存，确认后再在 AIMatterLab 中选择新版本。输出状态始终是 `validation_status=not_run`，没有真实探测或运行时不得改称通过。

在 AIMatterLab 的额外技能根目录登记生成的私有目录，或其父目录 `.studio/local-skills`。源 checkout 默认发现 `agent/builtin-skills`，便携包默认发现物理目录 `resources/studio-skills`；这一根目录同时用于技能库和所选技能的注册校验。选定技能后，Codex 使用真实文件路径；Kimi、Qwen、DeepSeek API 由主进程校验后组装受限附件：AIMatterLab 公共入口及关联 references；生成的私有 overlay 还包含经 schema 和 provenance 核对的同目录元数据。父入口固定映射到已登记 bundled 根，不按任意相对路径读取。每项文件和总内容有大小及数量上限，拒绝链接/越界/缺失/过期附件；不读取 local_skill_refs 全文。其他已登记 skill 保持仅入口注入。renderer 不直接读文件，原有显式额外目录保持有效。

打包规则仅将 `agent/builtin-skills/**` 复制为 `resources/studio-skills`，并将通用 localizer 和作业核对脚本复制为 `resources/studio-tools/localize-skill.mjs`、`resources/studio-tools/cluster-reconcile.mjs`。不会将 `.studio/local-skills`、profile JSON、用户级 skill 或本机特化目录作为资源源路径。localizer 要求显式指定用户选择的完整 Git checkout；即使从便携包执行工具，输出也写该 checkout 的忽略目录，不能写 Electron 的资源目录。新用户安装时用其本机登记重新生成 overlay，不能拷贝开发者 `.studio`。

已有私有 overlay 的旧父入口标识继续精确映射到已登记的公共根，不移动或改写私有配置。迁移只兼容记录在案的同一公共入口 CRLF→LF 摘要对；新的 overlay 使用当前摘要，其他内容修订仍会使旧来源过期。这是指导来源兼容，不代表环境、安装或功能测试通过。外部工具作者仓库的 `agents/skills` 布局保持由作者管理。

## 测试与证据范围

`node --test tests/integration/skill-portability.test.mjs` 使用独立 Git 仓库验证可迁移父 skill 引用、精确元数据保存、不读取私有 skill、无越界写入、ignore 例外/已跟踪文件拒绝、已有 overlay 不覆盖及 CLI 日志脱敏。公开模板还检查机器路径、IP 端点及密钥材料未进入通用 skill。

软件内服务商支持 Codex / Kimi / Qwen / DeepSeek API；DeepSeek Key 由用户在 Agent 登录窗口输入并加密保存，不属于 profile schema 或可迁移模板。选择服务商、存在凭据或读取模型目录都不能算作模型推理验证，需要对应账户的一次真实回复。

这些是软件与隐私边界测试，不证明 SSH 可用、引擎可以计算或科学结果有效。实际集群短例必须另有对应 worker Run、调度任务、compute-node 验证、退出收据和本地回收文件；证据留在忽略运行目录，公开版本报告只保留脱敏范围与 passed / failed / blocked / not_run。

## 已有任务的可迁移观察脚本

`scripts/cluster-reconcile.mjs` 只观察私有 manifest 中记录的 Run ID，同一调度 ID 保持不变；终态后回收选定产物并核对文本预览的 UTF-8 大小与 SHA。它没有 prepare、submit、cancel 或注册入口。可通过导出的 `reconcile({manifest, request, timeoutMs, pollIntervalMs, requestTimeoutMs})` 接入真实 typed IPC，或由调用者环境提供本机 worker URL/token 使用 CLI；不内置主机、端口、队列或凭据。格式和状态边界见 [观察与回收](../agent/builtin-skills/studio-compute-workflow/references/reconcile.md)。

断线、连接不确定和观察超时保持 `status=unknown`，保留实际 `run_status`，未验证回收为 `not_run`；不会自动重提。输出只保留状态、身份与校验摘要，不打印原始响应、文件正文、路径或错误内容。脚本的 fixture 测试不能替代实际桌面→集群→本地回收验收。
