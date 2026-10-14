# 版本更新与验证

每代更新在本文件及对应 docs/vX.Y.md 写明功能、验证范围与未验证项；原始作业输入、证据、截图和安装包留在未跟踪的运行目录。Git 跟踪源码、契约、依赖锁和说明，发布通过后提交并建立本地版本标签，不自动推送。运行成功不等于科学有效，工具接入不等于任意环境通过验证。

| 版本 | 本代更新 | 验证 | 未验证 / 尚待接入 |
| --- | --- | --- | --- |
| 0.5.0 | 显式任务规划开关；SSH 独立用户名与测试；One-prompt 安装入口、独立环境/profile、真实短例与成功门槛 | Node 26、worker 47、实际模型模式切换、SSH 用户匹配、WSL ASE/PyDyn 短例、独立 profile、便携包 passed | 公开 GitHub 与全新 GPU 依赖安装 not_run；真实集群作业 not_run；额外引擎安装 fixture 缺失会 blocked；详见 [v0.5](docs/v0.5.md) |
| 0.4.0 | 全局小字下限与对话字号；修复当前 Codex 协议与登录回调；项目服务商绑定；中央流程参数；SSH/LSF/Slurm 设置、版本化 Skill、草稿审阅、文件与监控 | Node 22、worker 36、实际代理 Codex 工具调用、两条实际 SSH 只读路线、桌面与便携包 passed | 真实集群科学作业 not_run；新 Kimi/Qwen 账户验证 not_run；多节点、数组与远程重启待适配；详见 [v0.4](docs/v0.4.md) |
| 0.3.0 | Codex / Kimi / Qwen 登录；官方 ACP CLI；七类任务与工具关系；可选计划和已有输入；Agent 居中布局；初始化 Git | Node 19、WSL worker 22、构建、CLI 本地服务集成、Electron 登录 / 布局 / 加密检查 passed | Kimi / Qwen 真实模型调用 not_run；本轮新科学验收 not_run；新工具适配器及 DFT 自动流转待接入 |
| 0.2.0 | Codex effort / 上下文；模块审阅后执行；分类设置、字体字号、中英文 | 历史记录：Node 6、worker 22、真实 Codex 设置和草稿、便携包审阅执行 passed | 未新增科学验收，详见 [v0.2](docs/v0.2.md) |
| 0.1.0 | Electron 工作台、Codex app server、独立 WSL 服务、四大模块与现有适配器 | 历史记录：Node 5、worker 20、Codex、桌面、23 项科学短任务 passed | 合成 EMT Cu 短任务只证明接口；远程调度等边界见 [验收](docs/acceptance.md) |

v0.3 是首次建立 Git 跟踪的版本；前两代是既有发布记录，没有对应历史源码提交。不得把本地测试模型服务的调用记录写成真实账户模型访问。
