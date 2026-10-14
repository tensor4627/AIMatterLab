# One-prompt 安装入口

将根目录 INSTALL_AGENT.md 交给本机 Codex、Claude Code 等通用 Agent。它负责获取指定 GitHub 版本、收集配置、执行受控安装与真实验收；软件内聊天服务商仍是独立的 Codex / Kimi / Qwen 选择。集群端不安装 Agent CLI。

本仓库尚未关联公开 GitHub remote，manifest 的 repository_url 为 null。当前入口可从本地完整 checkout 使用；发布后维护者需填写真实仓库和 release 地址、revision/hash。线上 clone / release 下载属于 not_run，不能虚构一个 URL。

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

默认私有配置及收据在 .studio/installation。plan 无执行副作用。configure 创建独立 venv；源码使用完整 commit，不切换已有源码分支。现有环境可以显式复用。环境配置结果不会悄悄替换用户配置；Agent 审查 configure.json 后合并并重新探测。Node/pnpm/Python/WSL 的系统安装由通用 Agent 按本机权限处理；需要管理员操作或重启时保持 blocked。

## 配置与命令

复制 installation/config.example.json 到忽略目录，填写目标 Linux Python 及 repositories。Windows Node 22.19+、pnpm 11、目标 Python 3.10+。Codex 需要兼容固定 app-server 协议的 CLI；Kimi / Qwen 使用已锁定官方 ACP runtime，认证由用户完成。版本信息见 desktop/generated/version.json 和 package.json。

~~~text
python scripts/one_prompt.py plan --config .studio/installation/config.json
python scripts/one_prompt.py configure --config .studio/installation/config.json
python scripts/one_prompt.py target-probe --config .studio/installation/config.json
python scripts/one_prompt.py smoke --config .studio/installation/config.json
python scripts/one_prompt.py desktop --config .studio/installation/config.json
python scripts/one_prompt.py finalize --config .studio/installation/config.json
~~~

bootstrap 示例字段：enabled、专用 Linux root、基线 python、精确 packages（name==version）、sources（name / credential-free GitHub url / full commit / install）。环境的 executables.python 指向 venv/bin/python；不要 resolve 掉符号链接。新增 GPU 包必须匹配驱动、CUDA、PyTorch/LibTorch/ABI；偏置 .pt2 不兼容时阻止，不降级后端。

SSH compute 配置增加 connection 与 resources。connection 包括 host、username、port、ssh_client、identity_file、via、scheduler、queue、remote_root、activation、limits、lsf_memory_scope。Windows 凭据可以通过 WSL 中的原生 OpenSSH 路径使用，用户名通过 -l 强制指定。resources 必须有 queue/cpus/gpus/memory_mb。短例上限 120 秒、2 CPU、1 GPU、8192 MB；项目并发 1。smoke 默认只准备远程草稿；明确审阅批准后才使用 --approve-submit。排队超时和失联为 blocked，保留 Run，由 Studio 监控，不自动重复提交。

允许登录节点安装时，bootstrap.allow_login_install 必须明确为 true。否则 configure 阻止登录节点安装，由 Agent 按站点规则将同一 recipe 排入队列执行。所有远端配置与输入包都排除 SSH 地址、端口和密钥引用；它们只留在本地控制端。共享摘要只记录状态和范围。

## 首版短例与成功边界

| 短例 | 实际执行 | 可证明范围 |
| --- | --- | --- |
| worker | 真实子进程及持久化 Run | 生命周期基础设施 |
| reference-md | 32 Cu、ASE EMT、5 步 CPU MD | 参考计算可运行，不能替代引擎验证 |
| pydyn-md | 32 Cu、PyDyn 公共 Simulation / VelocityVerlet、5 步 CUDA EMT | PyDyn API 和目标 CUDA 环境的短运行 |
| 额外引擎 / 训练 / sampling | 首版未内置 fixture | 选中则 blocked，不能虚报通过 |

每例检查真实退出码及 smoke-result.json，MD 还检查原子数、步数、有限能量和位移。它们不证明生产收敛、模型精度或长时间稳定性。

desktop 使用独立 profile、真实 renderer/worker 和 provider 请求；登录缺失则 blocked。生成的 Launch-Studio.ps1（或 Linux launcher）复用验收 profile，不覆盖用户原安装。finalize 绑定当前配置和源码指纹，要求三个阶段均通过、短例集合完整；不存在“跳过后也成功”的路径。

本地验证范围与最终发布记录见 v0.5.md；原始证据保留在忽略目录。
\n同一配置/源码已通过的 smoke 可复用明确标注的旧收据。修改配置后若旧安装任务未解决，阻止创建新请求。已有 worker 正在托管时不抢占权威锁、不杀服务；通过 Studio 核对任务，或选择独立安装 root。\n
Agent 需要为独立 worker 选择空闲本机端口；端口冲突应修改私有配置后重做 probe/smoke，不抢占其他安装的服务。
