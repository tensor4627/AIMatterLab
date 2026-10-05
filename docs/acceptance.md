# v0.1.0 验收记录

本记录对应 Windows + Ubuntu WSL + RTX 4090 的首版。Windows 桌面验收日期为 2026-10-04（北京时间）。当前 WSL 系统时钟比 Windows 提前约 8 小时，原始任务时间戳按服务时钟保留，因此界面中的部分任务日期为 10-05；本次未修改系统时钟。四大模块已经完成真实短任务；下面分别列出实现、验证范围与尚未完成的验收项。

## 证据与结果

原始 JSON 和截图位于项目的 `.studio/validation/`，不包含登录令牌或私钥。它们是本机验收产物，不是默认生产项目。

| 项目 | 结果 | 实际范围 |
| --- | --- | --- |
| TypeScript、Vite 构建 | passed | 离线前端资源与 Electron 便携包 |
| Node 安全与协议测试 | passed | 5 项：IPC/路由限制、路径映射、SSH 参数、app server JSONL |
| WSL 作业服务测试 | passed | 20 项：幂等、授权、快照篡改、取消、超时、GPU 排队、服务重建、PID 身份、单一调度器、续算路径等 |
| Codex app server | passed | 0.160.0 初始化、现有 ChatGPT 登录、8 个模型、52 个 skill、真实模型调用、MCP list_environments、恢复会话 |
| Windows–WSL 通信 | passed | localhost 与强制 WSL stdio relay；relay 下使用限制路由的本地 MCP 代理 |
| 桌面窗口关闭 | passed | 窗口关闭后作业仍 running，随后 succeeded；这是托管基础设施检查 |
| Electron 打包应用 | passed | sandbox、真实 WSL 服务、xterm PTY、科学图片预览、主题、1540×980 与 1100×720 无横向溢出 |
| 科学集成 | passed | science.json 共 23 项，下表说明具体内容 |
| GPUMD 续算 | passed | 从真实 restart.xyz 保留速度，显式新的 run.in |
| HotPP 恢复训练 | passed | 恢复真实优化器状态，从 step=3 到 step=6，生成新的 epoch=1-step=6 checkpoint |

证据文件：
- [science.json](../.studio/validation/science.json)：运行 ID、目录、退出记录、日志、数据审计与误差。
- [restarts.json](../.studio/validation/restarts.json)：GPUMD/HotPP 续算和关闭桌面的作业状态。
- [codex.json](../.studio/validation/codex.json)、[codex-relay.json](../.studio/validation/codex-relay.json)：实际协议与 MCP 模型调用。
- [desktop.json](../.studio/validation/desktop.json)：打包窗口的安全与布局检查。
- [工作台](../.studio/validation/workspace.png)、[Bias](../.studio/validation/bias.png)、[浅色主题](../.studio/validation/light.png)、[结果](../.studio/validation/run.png)、[小窗口](../.studio/validation/compact.png)。

## 科学验证范围

测试使用 ASE EMT 生成的 10 帧、每帧 32 个 Cu 原子的合成数据。训练 6 帧，验证 2 帧，独立测试 2 帧；结构指纹已检查互不重叠。没有 DFT 标签。本次结果证明接口能执行、保存和恢复，不能用于宣称势模型精度、物理结论或性能提升。

| 工作流 | 实际执行 |
| --- | --- |
| NEP | 100 代短训练；独立两帧 prediction；原始 skill 生成 RMSE、PNG 和 PDF |
| HotPP | CUDA 短训练；独立测试集 eval；freeze 生成消费端导出 |
| PyDyn MD | 使用 HotPP ase-* 导出，通过公共动力学 API 完成 10 步 NVE |
| GPUMD MD | 使用本次训练 NEP 完成 10 步 NVE |
| pyGAS 模板 | umbrella、固定墙、MetaD、WTMetaD 保存并重新加载；真实结构、CUDA 与邻居契约验证 |
| 采样两条路线 | 同一份 umbrella TorchScript bias 在 GPUMD-GPU-Sampling 与 PyDyn-pyGAS 完成短运行 |
| bias 导数 | 保存产物的有限差分力/virial 检查；报告完整误差与取样范围 |
| PyDyn 配对恢复 | MD 与 sampling checkpoint 成对哈希检查；10+5 步与连续 15 步比较 |
| WTMetaD | GPUMD 真实短运行生成历史，原 pyGAS 工具重加权并生成 FES 图片 |
| 复现导出 | 独立不可变输入、运行元数据和输出哈希 ZIP |

当前静态 umbrella NVE 样例中，PyDyn 配对恢复的 r、p、box 最大绝对差均为 0。该结论仅适用于本次样例，不能推广到 NPT 或有历史状态的采样。短 WTMetaD 的 FES 仅用于检查读取和重加权链路，未验证收敛。

NEP 原生 prediction 在此版本读取 train.xyz；适配器从明确 evaluation.xyz 建立独立预测目录并记录数据角色及哈希。不会把训练输出当作独立测试。缺失 virial 标签时返回 not_run。

HotPP CLI 会搬移已有 model 输出目录；续算将输入 checkpoint 快照放在 resume.ckpt，并要求新的 continuation_config。只恢复后立即结束不算完成继续训练。

## 环境与执行

验收 Python：
`/home/tensor/.local/state/gpu-sampling-studio/validation-venv/bin/python`

独立安装 NumPy 1.26.4、CuPy CUDA12 13.6.0、ASE 3.29.0、PyYAML、SciPy、Matplotlib、Pillow、PyTorch Lightning 2.5.0、torchmetrics、tensorboard/tensorboardX；通过独立 .pth 引用既有 Torch 2.11.0+cu128。未改动原虚拟环境。CuPy 分配与 torch.cuda.is_available 均实际检查。

GPUMD/NEP 使用既有 5.1 可执行文件。GPU-Sampling 使用原有编译环境的可执行文件及其 LibTorch 依赖；没有重新编译或更改用户现有源码。普通 PyDyn 与 sampling PyDyn 分别登记；采样版本保留固定来源的 vendored pyGAS。

主科学运行根目录：
`/home/tensor/.local/state/gpu-sampling-studio/acceptance/sessions/2fb23205c33140b9bcadca2006c9d226`

桌面验收使用另一份 SQLite 索引，通过真实 HTTP 作业服务访问这些运行产物。具体 root/runtime 见 desktop.json，防止验收脚本和服务同时调度同一数据库。作业目录位于 Linux 文件系统；长期服务部署到持久化 runtime。

复核命令（PowerShell）：

```powershell
pnpm test
pnpm test:worker
pnpm build
pnpm run pack
node scripts/codex-smoke.mjs --relay
node scripts/restart-smoke.mjs
```

科学 smoke 脚本为 `scripts/science-smoke.py`，其中环境路径需要按目标机器登记修改。不要把本机特定路径或本次测试项目授权当作所有机器的默认配置。

## 明确的未完成验收

| 内容 | 状态 | 原因或范围 |
| --- | --- | --- |
| AOTI .pt/.pt2 完整双产物构建 | blocked | 未完成匹配工具链的构建预检与真实部署验收；显式请求保留错误，不降级 |
| OPES 与历史型 GPUMD sampling 自动续算 | not_run | 已有工具接口，但需要各自独立状态/重启协议的真实验收 |
| 所有 CV、NPT 和任意模型正确性 | not_run | 当前覆盖距离 CV、Cu、小体系 NVE，不能替代用户科学任务验证 |
| 具体 SSH 集群连接 | not_run | 文件浏览和 OpenSSH 终端已实现，尚未选择并实测用户目标主机 |
| SSH 队列、断线托管、调度器 | not_run | 属于计划中的后续版本 |
| 节点编辑器、FFS、路径采样 | not_run | 属于计划中的后续版本 |
| Windows 安装签名及跨机器环境验收 | not_run | 当前交付便携 EXE，本机打包验收通过 |

因此，这是可运行并有真实科学证据的 v0.1.0 首版；尚未宣称计划中每一项 P4 科学验收全部完成。现有上游仓库分支与未提交修改保持原状。
