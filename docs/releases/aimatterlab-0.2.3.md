# AIMatterLab 0.2.3 变更与验证记录

2026-11-24 · 起点为 GitHub 主仓库 `b5719b8`（精简并明确弱校验的软件规范）。本次为 0.2.3 本地源码提交，暂未推送远端或创建发行 tag；桌面包元数据、Worker 版本与源码安装清单一致。[上一版本](aimatterlab-0.2.2.md) · [软件规范](../software-specification.md)

## 本版主要改动

1. **软件规范对齐与融合**：同步 `b5719b8` 的零 WSL 纯 SSH 闭环、弱校验首原则与一次委托口径，补充单步输入输出（左端输入资源 → 一次工具调用 → 右端输出产物）、多路复用通道替代旧中转/串行路径，以及界面交互容错不变量，并按实装状态同步第 4 节说明。
2. **Worker SQLite 索引与高频查询**：在 `studio_worker/infrastructure/store.py` 非破坏性新增 4 个 JSON 表达式索引及精准状态/计划查询方法，消除调度器 `reconcile` / `dispatch` 与托管计划状态查询的全表扫描，保持 `SCHEMA_VERSION = 2` 及存量数据兼容。
3. **前端容错、流式渲染与交互完善**：为 `Agent` 与 `SharedTerminalPanel` 增加独立 `ViewBoundary`；折叠工具组外露核心跳转/修复按钮并在告警或错误时自动展开；长对话流式增量按 `requestAnimationFrame` 合批；底部跟随态跳过无关 DOM 锚点查询；`RunDetail` 日志证据仅在展开时惰性拼接；`JobsPage` 改用索引映射；`WorkflowRoadmap` 在短高视口（`<460px`）自适应折叠；英文提示词全量补齐。
4. **跨模型能力对齐与增量上下文**：`AcpBridge`（Kimi/Qwen）在正常连接中采用 semver + ACP v1 能力握手 + 非阻塞版本提示，包下载安装器继续严格锁定版本；五类服务商全面开放私有 CV 定义隔离与显式会话恢复；`TaskRecords` 按已确认回合跟踪工作流快照 SHA-256 基线并在未变化时发送紧凑引用。
5. **零引用死代码清理**：移除 `ssh.save`、`ssh.browse`、`codex.configure` 废弃 IPC 路由以及 `workspace_layout.py`、`custom_reference.py` 零引用 Worker 垫片。

## 内置指导与提示词核对

- 核对并更新 `agent/builtin-skills/studio-data-workflow/references/studio-viewer.json` 中 `frontend/features/runs/RunDetail.tsx` 的 SHA-256 与字节元数据（预览范围与交互契约未改变）。
- 复核 `agent/context/task-turn-context.mjs` 与 `agent/sessions/requests.mjs` 的增量基线格式：仅在非 `reviewMode`、同一会话已确认基线完全匹配时发送紧凑引用；首轮、修改参数/流程图、压缩、失败或恢复均完整重发。
- `scripts/check-bundled-guidance.mjs --source`、`scripts/sync-tool-contracts.mjs --check` 与 `scripts/check-doc-links.mjs` 均通过。

## 验收范围

| 范围 | 结果 | 核对内容 |
| --- | --- | --- |
| 契约、文档与指导检查 | passed | `sync-tool-contracts.mjs --check` 退出 0；`check-doc-links.mjs` 检查 193 个文档通过；`check-bundled-guidance.mjs --source` 通过（11 skills、41 catalog routes、37 documents）。 |
| 类型检查与生产构建 | passed | `tsc --noEmit` 与 `vite build` 均退出 0。 |
| Worker Python 回归 | passed | 在 WSL Ubuntu Python 3.12 下运行 8 个受影响/新增测试文件（含 `test_store_schema` 索引执行计划、`scheduler_isolation`、`launch_protocol`、`managed_schedules`、`cluster_concurrency`、`domain_distribution`、`workspace_layout`、`custom_cv`），共 138/138 通过。 |
| 契约与桌面 Node 测试 | passed | `--suite=contracts` 41/41 通过，`--suite=desktop` 73/73 通过。 |
| 受影响前端、Agent 与集成回归 | passed | 20 个直接相关 Node 测试文件（含跨模型恢复、ACP 能力握手、增量上下文、私有隔离及 `ux-stability-optimizations`）共 369/369 通过。 |
| 其余全量套既有基线/环境差异项 | failed | 全量运行暴露 3 类与本版改动无关的既有问题：`tests/agent` 中 2 项真实 DSH 视觉网络调用测试；`tests/backend` 中 Windows git temp 清理 `EPERM`、`ELECTRON_RUN_AS_NODE` 下 `NODE_MODULE_VERSION` 156/138 差异及 `ssh-service-main-switch` / `ssh-live-source-compatibility` 既有桩漂移；未入选受影响批的 `continuous-work.test.mjs:60` 与 `local-build-review-eligibility.test.mjs` 存在测试桩缺少 `getLanguage` / `taskDraftStorage` 问题（计划在下一阶段测试精简中一并修复）。 |
| 真实科学计算与安装器打包 | not_run | 本版聚焦框架层、调度索引与交互代码，未改动科学引擎适配，未执行真实科学算例、远端提交及 NSIS/便携包打包。 |
