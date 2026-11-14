# AIMatterLab 0.1.0 单 prompt 安装

复制下面这一段给能使用本机终端和 Git 的 Agent。新机器从源码安装时，电脑需要能读取该 GitHub 仓库。

```text
请在我的 Windows 电脑安装 AIMatterLab 0.1.0。从 https://github.com/tensor4627/AIMatterLab.git 获取仓库，先读 main 的 INSTALL_AGENT.md，在新目录检出 b2eba88374ec2c2df9dbc2d83d7b120f8615e479 并核对版本。先发现本机可复用的 WSL、Python 和计算环境，和我确认要验收的服务商与短例后，按安装提示执行。完成后给我启动文件和每项实际验收结果。
```

完整指令见 [INSTALL_AGENT.md](../INSTALL_AGENT.md)。[安装清单](../installation/manifest.json)提供官方仓库和固定源码提交。已有完整检出时也可直接交付安装提示，并说明希望复用当前检出还是安装指定版本。源码已通过有读取权限的 Git 账号从新目录克隆；需要登录时在本机 Git 凭据界面完成。

Windows 的源码启动、开发启动和安装器桌面阶段统一使用令牌前置检查。`node scripts/start.mjs --preflight-only` 在受限上下文返回 blocked，安装器此时尚未安装依赖、构建或启动 Electron。改用正常桌面上下文即可，普通非管理员账户受支持；不自动提权或更改 ACL、sandbox 和执行策略。安装器生成的 `Launch-AIMatterLab.cmd` 为 Windows 优先启动文件，并保留相同 profile；PS1 保留兼容。详见[原生启动故障记录](development/windows-startup-diagnostics.md)。

需要额外科学工具时，按[工具仓库清单](../installation/tool-sources.json)获取用户选定的源码分支，然后按该仓库内的安装说明操作。Windows 解压版也提供 `resources/tool-sources.json`。

## 已有源码的日常启动

已有 Git 检出可双击根目录 `Launch-AIMatterLab.cmd`，或执行 `pnpm run source`。以后关闭桌面，在同一目录 `git pull` 再启动，自动补齐受影响的依赖／构建。默认沿用仓库 `.config`；需要复用安装器生成的 profile 时用 `--profile` 指向同一目录。[源码启动说明](source-desktop.md)包含首次使用与便携包并存规则。

## 安装状态机

~~~mermaid
flowchart LR
 P[Agent 读取安装 Prompt] --> C[一次收集缺失配置]
 C --> Plan[plan]
 Plan --> Env[configure 专用环境]
 Env --> Probe[target-probe]
 Probe --> Smoke[smoke 真实短例]
 Smoke --> Desktop[desktop 界面和真实 provider 调用]
 Desktop --> Final[finalize]
 Smoke -->|缺失 fixture / unknown / 排队| Block[blocked]
 Desktop -->|未登录或 CLI 不兼容| Block
 Final -->|全部选定检查 passed| Done[installation_success]
~~~

默认私有配置及收据在 `.studio/installation`。`plan` 校验配置并写入本次计划。选择新环境时 `configure` 创建独立 venv；源码使用完整 commit。现有环境可以显式复用。Agent 审查 `configure.json` 后合并配置并重新探测。Node/pnpm/Python/WSL 的系统安装由通用 Agent 按本机权限处理；需要管理员操作或重启时保持 blocked。

### 环境交接

安装验收与日常使用必须指向生成 launcher 的同一个 worker root 和 profile。安装结束前在该实例读取 `compute_readiness` / `list_environments`，核对选中的 Python、引擎、源码来源与 CUDA 观察结果，并为实际路线保存 `probe_environment` 运行时收据。另一隔离验收实例跑通，不代表正常实例已经登记。首启/连接时默认发现现有的标准 venv、conda 索引、PATH/已绑定源码中的程序，新增独立版本登记，保留旧环境和项目授权。该搜索有明确范围；自定义前缀和非标准原生构建可由 Agent 用 `draft_local_environment` 提议，在计算环境页用表单审阅保存。GPU 发现、依赖探测与真实科学短例分别记录。

询问用户是否需要集群，优先导入已有 SSH 引用。先只读核验登录用户、调度器及队列，再讨论目标队列、资源与激活路径，使用 `draft_cluster_setup` 生成可审阅设置；连接检查不提交任务。连接页显示实际检查时间，失败清除旧成功，修改配置或结果过旧后显示待复查。计算节点 GPU/模型仍需用户审阅后的短例，不把登录节点探测当成安装成功。

[连接引导实施契约](design/compute-connection-hil.md)区分本地 WSL、已有密钥或转发入口、人工二步认证。安装 Agent 收集所选来源、用户名和密钥引用等必要设置。密码、私钥和验证码由用户在对应界面处理。使用真实 SSH 站点时，分别记录登录结果、所选资源的执行授权和计算节点短例的结果。日常运行继续使用登记环境和运行时收据。

## Kimi / Qwen 按需安装

便携包不附带这两套 CLI。AIMatterLab 优先保留有效手动路径，再检查 `STUDIO_KIMI_CLI` / `STUDIO_QWEN_CLI` 和本机 `PATH` / `PATHEXT`；找不到兼容程序时复用已验证的 AIMatterLab 专用缓存。Windows 常见 npm/pnpm 入口会解析到实际程序，不执行命令包装脚本。有效程序仍须满足当前版本及 ACP 接口要求；安装位置、程序兼容、账户登录和真实模型调用分别判断。

点击对应登录或连接入口时，缺失或不兼容会显示下载界面。用户可重新检测、选择已有程序、下载兼容版本或取消；启动应用、切换服务商、读取账户和后台恢复均不触发下载。下载使用锁定的官方 npm 地址和完整性值，无需另外安装 npm、Node 或 Python。主进程负责校验、受限解包和原子安装，不运行 postinstall，也不覆盖本机已有程序。

安装放在当前 AIMatterLab profile 的 `agent-runtimes` 私有目录。界面显示实际下载字节、包数量及校验/安装/接口检查阶段；未知总量使用加载动画。失败或取消保留已有可用版本，成功后继续原登录流程。高级设置中的有效手动路径保留，仅迁移已失效的历史包内默认路径。用户在外部安装 CLI 后可点击重新检测。

单 prompt 安装协作者遵循相同入口和 profile；`reuse-existing` 仍不下载，缺失时保留 blocked，完成用户选择的安装后再复核。CLI 安装通过不能替代桌面实际模型回复或科学短例。

## 配置与命令

复制 `installation/config.example.json` 到忽略目录，填写目标 Linux Python 和源码仓库。Windows 源码构建使用 Node 22.19+、pnpm 11。仅运行基础 worker 时目标 Python 最低为 3.9；选择 PyDyn 或其他科学短例时还需满足对应工具和锁定依赖的要求。Codex 按所需 app-server 协议和实际隔离能力检查兼容性。Kimi / Qwen 优先复用兼容本机程序，缺失时由用户选择下载已锁定的官方 ACP runtime，认证由用户完成。

~~~text
python scripts/one_prompt.py plan --config .studio/installation/config.json
python scripts/one_prompt.py configure --config .studio/installation/config.json
python scripts/one_prompt.py target-probe --config .studio/installation/config.json
python scripts/one_prompt.py smoke --config .studio/installation/config.json
python scripts/one_prompt.py desktop --config .studio/installation/config.json
python scripts/one_prompt.py finalize --config .studio/installation/config.json
~~~

bootstrap 示例字段：enabled、专用 Linux root、基线 python、精确 packages（name==version）、sources（name / credential-free GitHub url / full commit / install）。环境的 executables.python 指向 venv/bin/python；不要 resolve 掉符号链接。新增 GPU 包必须匹配驱动、CUDA、PyTorch/LibTorch/ABI；偏置 .pt2 不兼容时阻止，不降级后端。

SSH compute 配置增加 connection 与 resources。connection 包括 host、username、port、ssh_client、identity_file、via、scheduler、queue、remote_root、activation、limits、lsf_memory_scope。Windows 凭据可以通过 WSL 中的原生 OpenSSH 路径使用，用户名通过 -l 强制指定。resources 必须有 queue/cpus/gpus/memory_mb。短例上限 120 秒、2 CPU、1 GPU、8192 MB；项目并发 1。smoke 默认只准备远程草稿；明确审阅批准后才使用 --approve-submit。排队超时和失联为 blocked，保留 Run，由 AIMatterLab 监控，不自动重复提交。

允许登录节点安装时，bootstrap.allow_login_install 必须明确为 true。否则 configure 阻止登录节点安装，由 Agent 按站点规则将同一 recipe 排入队列执行。所有远端配置与输入包都排除 SSH 地址、端口和密钥引用；它们只留在本地控制端。共享摘要只记录状态和范围。

## 首版短例与成功边界

| 短例 | 实际执行 | 可证明范围 |
| --- | --- | --- |
| worker | 真实子进程及持久化 Run | 生命周期基础设施 |
| reference-md | 32 Cu、ASE EMT、5 步 CPU MD | 参考计算可运行，不能替代引擎验证 |
| pydyn-md | 32 Cu、PyDyn 公共 Simulation / VelocityVerlet、5 步 CUDA EMT | PyDyn API 和目标 CUDA 环境的短运行 |
| 额外引擎 / 训练 / sampling | 首版未内置 fixture | 选中则 blocked，不能虚报通过 |

每例检查真实退出码及 smoke-result.json，MD 还检查原子数、步数、有限能量和位移。它们不证明生产收敛、模型精度或长时间稳定性。

desktop 使用独立 profile、真实 renderer/worker 和 provider 请求。需要认证时，由用户登录后重验。Windows 用户双击 `Launch-AIMatterLab.cmd` 进入验收过的同一 profile，另有兼容 PS1 启动文件。finalize 绑定当前配置和源码指纹，要求三个阶段均通过且选定的短例集合完整。

本版桌面、开发者工具包和 CPU 适配器的验收范围见 [AIMatterLab 0.1.0 发布说明](releases/aimatterlab-0.1.0.md)。第三方工具从「工具与资源 → 第三方工具包」单独登记，示例的使用步骤见[开发者快速开始](../developer/README.md)。
同一配置/源码已通过的 smoke 可复用明确标注的旧收据。修改配置后若旧安装任务未解决，阻止创建新请求。已有 worker 正在托管时不抢占权威锁、不杀服务；通过 AIMatterLab 核对任务，或选择独立安装 root。

Agent 需要为独立 worker 选择空闲本机端口；端口冲突应修改私有配置后重做 probe/smoke，不抢占其他安装的服务。


## 复用已有环境的 dry-run 验收

将 `INSTALL_AGENT.md` 交给本机 Agent，并明确选择复用本机环境。先只读发现 WSL、实际解释器、已有引擎和登录能力，再将选中的已有环境登记到一份新的私有配置。该流程不下载源码、不运行包安装、也不配置科学环境；它会在隔离目录建立应用配置和 worker 输入快照，实际探测、执行选定短例、构建已有 checkout 并完成真实模型回复。

~~~powershell
python scripts/one_prompt.py reuse-existing --config .studio/installation/config.json --state-dir .studio/installation/audit-new
~~~

`bootstrap.enabled` 必须为 false。`state-dir` 和配置中的 `worker.root` 都须选新的空目录；控制端和 worker 分别以本次源码/配置指纹和审计身份标记所有权。未知非空目录在写入、启动服务和注册之前拒绝，不修改现有 worker、SSH 连接、凭据、项目授权或作业。同一次审计可恢复自己的目录；源码或配置变化则选择新目录。配置文件应放在审计目录外。

`desktop.source_ids` 明确选择自动附加的源码摘要，可设 `[]`；安装模型回声测试默认不需要科学源码。独立安装 profile 不拷贝其他安装的凭据；Codex 可使用本机现有登录能力，其他服务商缺登录时在该独立 profile 中完成登录。该范围不改变已有 worker 源码注册授权。

每次审计实际执行 target-probe 和 desktop/provider 检查。完成过的 smoke 不会被默认冒充新运行；需要本轮全新科学证据时换用新的两个目录。仅在显式 `--reuse-smoke-receipt`、已登记环境身份未变且源码无 dirty 标记时，才可恢复标有原始时间的历史 smoke；报告同时显示 `cached_evidence=true`，不能称本轮新科学运行。

报告分别给出 `reuse_readiness_success`、`dry_run=true`、`installation_success=false` 与复用模式跳过的动作。每台新机器的完整安装结果由该机的 finalize 收据确认。Git 源码克隆、预编译发行包下载和目标环境的科学运行分别记录；额外引擎缺少所选 fixture 时保留 blocked。
