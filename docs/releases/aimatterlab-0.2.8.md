# AIMatterLab 0.2.8

本版修复 0.2.7 审核发现的多功能便携工具包运行标识冲突、正式计算参数规则被配置值覆盖、旧版 `0.2.0`–`0.2.5` 私有计算技能升级校验失败、Git 源 Windows CRLF 与 Linux LF 跨平台校验不一致、受管安装目录未申报辅助文件篡改绕过及大体积 `tool.json` 超出 24 KiB 上限不可读问题；同时补齐 `AGENTS.md` 工具接入/配置红线与源码锚点、`studio-neb-workflow/references/neb.json`、L2 `onboarded-tool-<id>` 模板、L3 非工具包执行技能 `Source provenance` 记录、L4 项目与资源库边界、5 KiB 内置入口门禁、集群配置与软件版本路由及全量计算路由的 SSH 恢复指南引用。

## 核对内置指导

- **已变更并复核的指导**：[agent/context/AGENTS.md](../../agent/context/AGENTS.md)（4,585 B，保留动态 `project_skill_catalog({"scope":"user"}).directory` 占位符、6 模块概览、4 项源码锚点及全部 12 项运行时护栏）、[installation/workspace-guide.md](../../installation/workspace-guide.md) 与 [agent-settings.mjs](../../agent/context/agent-settings.mjs)（新增 0.2.7/0.2.8 种子哈希）、[studio-neb-workflow/SKILL.md](../../agent/builtin-skills/studio-neb-workflow/SKILL.md) 与新增 [neb.json](../../agent/builtin-skills/studio-neb-workflow/references/neb.json)、[studio-tool-onboarding/SKILL.md](../../agent/builtin-skills/studio-tool-onboarding/SKILL.md) 与新增 [local-onboarding-template.md](../../agent/builtin-skills/studio-tool-onboarding/references/local-onboarding-template.md)、[studio-workflow-roadmap/SKILL.md](../../agent/builtin-skills/studio-workflow-roadmap/SKILL.md)、[studio-compute-workflow/references/resource-tools.md](../../agent/builtin-skills/studio-compute-workflow/references/resource-tools.md)、[scientific-skill-map.json](../../agent/skills/scientific-skill-map.json)（为其余 6 条 `studio-compute-workflow` 路由补齐 `references/connection-recovery.md`）。
- **已复核继续沿用的指导**：其余内置 `SKILL.md` 及参考文件均通过 5 KiB 入口预算（最大 4,621 B）、产品称呼、全量 `.md` 源码锚点、UI 控件与 `read_scientific_skill` 读回校验。

## 验证范围

| 验收范围 | 结果 | 实测依据 |
| --- | --- | --- |
| 源码与 CI 契约 | passed | `sync-tool-contracts.mjs --check`、`package-developer-kit.py --check`（12 files）、`check-doc-links.mjs`（218 files）、`check-bundled-guidance.mjs --source`（13 个内置技能、44 条目录功能、57 份随包文档、19 项产品源码回执、6 个发行来源、`startupBytes: 4585`、`largestEntryBytes: 4621`）、`tsc --noEmit` 与 `NativeNEB` 契约单测全部通过。 |
| Node 回归 | passed | CI 源码套件 79 项全部通过；覆盖本次全部改动的 10 个核心测试文件（技能上下文、大 `tool.json` 分片、意图路由、便携工具包注册与 CRLF/LF Git blob OID、资源工具控制器、项目技能、安装清单等）共 138 项，136 项通过，2 项因本机 Windows 符号链接权限跳过。 |
| Linux worker 资源与路线图 | passed | WSL Python `tests/test_resource_tools.py`、`tests/test_roadmap_execution.py`、`tests/test_contracts_and_protocol_suite.py` 共 93 项全部通过（覆盖多功能标识隔离与冲突拒绝、必填/默认 300/整数拒绝 `1.5` 与 `bool`、Windows CRLF 摘要对 Linux LF 检出激活、修改未申报 `helper.py` 拦截及 L3 `Source provenance`）。 |
| Windows x64 签名构建与成品核对 | passed | 产出 `AIMatterLab-0.2.8-win-x64-setup.exe`（159,133,440 B，SHA-256 `b7d2717e...`，项目证书签名）、`.blockmap`（144,435 B）、签名 `latest.yml`、`AIMatterLab-0.2.8-win-x64.zip`、`AIMatterLab-0.2.8-developer-kit.zip` 与 `SHA256SUMS.txt`。对 `win-unpacked`、解包后的便携 ZIP 及解包后的 NSIS 安装器分别运行 `check-bundled-guidance.mjs`，三份成品均返回一致回执（`version: 0.2.8`，`promptSha256: 76239ef8...`，`skillInventorySha256: bdcad954...`，57 份文档、39 条路由）。 |
| 真实科学与线上模型 | not_run | 本次以隔离调度器与本地自动化测试核验软件行为；真实集群科学作业、线上模型回复与线上下载端到端增量升级另行验收。 |
