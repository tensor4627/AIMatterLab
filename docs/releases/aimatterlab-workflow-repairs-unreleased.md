# 集群草稿、会话历史、复现包与技能一致性

2026-11-21，基于 0.1.26 的未发布变更。

## 四项修复

| 用户操作 | 行为与验证 |
| --- | --- |
| 在集群草稿中改名或调整时限 | 桌面保留本地与远程输入的各自来源。worker 为新草稿核对原始快照的字节与哈希。混合输入测试在远端原件已移除、本地原件已改变时成功修订，传输调用数没有增加。显式替换来源、旧草稿和同名冲突有独立用例。[集群输入回归](../../backend/worker/tests/test_cluster_transfer.py) |
| 从侧栏打开已保存的 Qwen 或自定义 API 会话 | 直接读取本机 SQLite，将已脱敏的消息交给界面。续发按会话核对原服务配置与凭据。覆盖移除配置、撤销密钥、更改地址和协议，也覆盖旧版自定义 API 记录。有效绑定在本机 DSH 回环中沿原端点完成续发。[历史读取回归](../../tests/integration/provider-history-acceptance.test.mjs) · [发送与重试回归](../../tests/frontend/agent-send-lifecycle.test.mjs) |
| 导出本地运行 ZIP | `reproduction.json` 在 `execution.provenance` 和 `execution.execution_check` 中保留 worker 实际持久化的字段，诊断受长度和脱敏限制。未记录、已记录 `not_run` 和执行失败分别有测试，并核对了日志缺失时的 ZIP 内容。[导出回归](../../backend/worker/tests/test_execution_findings.py) |
| 下载独立开发者技能包 | ZIP 的 12 个成员与 Git 跟踪的源文件逐项一致。包内含 `trajectory.density` 和 `normalizeInlineSchema`。生成顺序、时间和属性固定，重建可得到相同的 SHA-256。[生成与检查](../../scripts/package-developer-kit.py) · [独立交付包测试](../../tests/integration/developer-tool-integration.test.mjs) |

## 技能、规范与分发

- 绑定 GPUMD 的工作流收到明确的材料查询、导入或建模请求时，保留工作流指导并选择对应的 Materials Project 或 ASE 指导。手动选择优先。已有输入与继续 MD 的用例保留原引擎路由。回归覆盖当前全部 16 个引擎、五类提供商的共享权限，以及参考文件按需读取。[意图与引擎回归](../../tests/agent/scientific-context.test.mjs) · [实际读取与权限回归](../../tests/agent/scientific-skill-router.test.mjs)
- 软件规范和开发文档已更新技能正文的交付方式与 SSH、Slurm、LSF 图执行范围。站点技能和集群审阅页分别说明本地快照与资源检查、计算节点的必需执行检查、科学检查建议。Slurm 和 LSF 参考已重新核对 worker 文件摘要与对应行段。[软件规范](../software-specification.md) · [技能投递](../portable-skills.md) · [集群工作流](../development/workflow-io-roadmap.md)
- GitLab 的相关合并请求、默认分支变更与版本标签会检查契约副本、开发者 ZIP、文档链接、实际技能读取和路由回归。发布维护者可在本地执行同一组命令。[CI 配置](../../.gitlab-ci.yml) · [分发检查](../development/windows-update-release.md)

## 验收范围

| 检查 | 本次观测 |
| --- | --- |
| 桌面交互 | 隐藏的 Electron 窗口通过真实 React 审阅页完成混合输入草稿修订。在生产主进程和 preload 下，通过侧栏依次打开 Qwen、自定义 API，再切回 Qwen。SQLite 中的脱敏消息正确显示了三次，记录到三次 `thread/read`，模型连接与外部请求均为 0。 |
| 源码与 Windows 应用目录 | 与发布流程相同的读取模块从未签名的 `win-unpacked` 目录核对了 11 个内置技能。源码与应用目录的 37 份文档摘要一致，读回覆盖 36 条涉及内置文档的路由，其中 8 条含外部指导。完整目录有 41 条功能路由、16 个引擎、17 项产品源码引用。 |
| 开发者 ZIP | 12 个成员与源文件逐字节一致。两次重建的 SHA-256 均为 `475c2e673cb292d4617b980d6866a25ec4907fe5e4724398a967fec197ddd368`。 |
| OPES 外部源码 | 在技能指定的公开 pyGAS 提交 `2a5bf4e` 上，三个文件的 LF 规范化摘要全部匹配，CLI 形参和输出契约检查通过。登记站点的原始字节摘要仍单独核验。 |

上述四项修复的前端通过 TypeScript 检查和生产构建。隔离 worker 测试使用临时项目、SQLite 和调度传输夹具。模型续发使用本机回环和合成凭据。真实站点排队、外部模型推理与材料科学计算不在该轮验收范围。

本次独立复跑的五组 worker 测试共 133 项通过。技能相关工程回归 249 项通过，包含固定 pyGAS 公开提交的可选源码检查。GitLab 技能作业中的全部命令也在独立、未安装项目依赖的工作副本上通过。

## WSL 1 本地作业启动与恢复

修复前，两个真实监督进程用例均等待 10 秒后超时。进程栈显示监督器已登记自己的身份，随后阻塞在 SQLite 的第一个 `BEGIN IMMEDIATE`，尚未创建计算子进程。另一个进程中空闲的 WAL 连接即可在本机 WSL 1 复现。独立写者实验还发现，此环境的 POSIX 字节范围锁不能可靠排斥竞争写者。

WSL 1 上的 worker 和监督器改用 SQLite 回滚日志，共用随进程退出释放的 `flock`。启动和取消仍在同一把锁下核对作业状态。其他 Linux 环境继续使用 WAL。原用例保留 10 秒上限。独立验收从正常调度入口运行了 12 个作业，分别使用 WSL 的 `/tmp` 和挂载的 Windows 目录。每个作业都有两个监督进程竞争，重开 worker 后六个正常完成、六个确认取消。每个作业的子进程启动记录均只有一条。[启动与取消协议](../../backend/worker/studio_worker/compute/launch_protocol.py) · [启动测试](../../backend/worker/tests/test_launch_protocol.py) · [存储回归](../../backend/worker/tests/test_store_schema.py)

旧版 WAL 库正常关闭后可直接重开。若 WSL 1 报告残留 WAL，先等待原作业和监督器结束并关闭旧 worker。保留 `worker.sqlite` 及同目录的 `-wal`、`-shm` 原件，在完整的离线副本上用单个 SQLite 连接执行 `PRAGMA wal_checkpoint(TRUNCATE)`，确认返回的 busy 项为 0，再核对 `PRAGMA integrity_check` 返回 `ok`、`PRAGMA journal_mode=DELETE` 返回 `delete`。验证副本内的原项目和作业记录后再用于恢复。异常退出夹具已核对原项目授权、未决作业的启动声明和事件顺序。

## Slurm 与 LSF 的提交和计算回执

原调度命令夹具同步执行整个批脚本，只有脚本成功时才打印作业号。在本机 WSL 1 上，Landlock 和 Bubblewrap 工作目录隔离均不可用，脚本以 125 退出，夹具随之遗漏了已经接受的提交。现在夹具先接收脚本、分配作业号并返回，再单独执行原脚本。测试逐项核对提交目录、作业号、提交令牌、退出回执和单次提交次数。[整图回归](../../backend/worker/tests/test_cluster_roadmap.py)

独立复跑还发现，成功找回原作业号后，旧的“提交回执缺失”仍保存在运行记录里，会遮住随后计算失败的退出原因。worker 现在确认原作业号后清除该提示，保留其他诊断。证据不足时继续对账。提交答复丢失、回执令牌不匹配、再次断线、两次重开 worker 和计算失败均有回归覆盖。[集群回执处理](../../backend/worker/studio_worker/compute/cluster.py)

在断网 Linux 7.0 虚拟机中，以普通用户启用真实 Landlock 隔离，Slurm 和 LSF 命令由本地夹具提供。两条整图都运行了仓库的数密度工具。每条流程都另行经过提交答复丢失、重开 worker、找回原作业号，随后在原会话目录生成 `density.csv`。一个原子和 8 Å³ 晶胞得到 0.125 Å⁻³，两份输出的 SHA-256 相同。更改已提交的输入会在计算节点校验时失败。在 WSL 1 上则核对了真实隔离失败时的退出码、回执及无输出。真实站点的 SSH、生产队列和 GPU 未参与此次验证。

## 本轮独立回归

- WSL 1 执行 205 个测试方法，无失败。上述同一测试方法下的两个受限成功分支在此环境跳过。另用四个真实进程向临时库各提交 12 条事件，再让持有未提交事务的进程异常退出。恢复后 48 条已提交事件逐条匹配，SQLite 完整性检查返回 `ok`。
- 断网 Linux 客机执行整图、资源工作区和存储回归 22 项，全部通过，无跳过。两种调度器的成功与失败分支都实际执行。普通 Linux 的临时库使用 WAL，同样的四写者与崩溃恢复检查也保留了全部 48 条事件。本轮直接验证的内核为 WSL 1 和 Ubuntu Linux 7.0。
- 两个调度器技能的本地源码引用已更新。23 项技能回归全部通过。源码和重新制作的未签名 Windows 应用目录核对了 11 个技能、37 份文档及 17 项产品源码引用，文档清单摘要相同。交付目录中本次改动的五个 worker 实现文件也与源码逐字节一致。[Slurm 参考](../../agent/builtin-skills/studio-compute-workflow/references/slurm.json) · [LSF 参考](../../agent/builtin-skills/studio-compute-workflow/references/lsf.json)
