# AimLab 内部工具开发环境接入验证记录

日期：2026-11-07 · 性质：开发者环境接入验证（非用户配置、非科学验证）· 原始证据保存在 ignored 的 `.studio/aimlab-tools-verification/`，本文件只记录范围与结论。

## 环境与源码身份

- 验证环境：WSL2 Ubuntu（Linux 6.18 WSL2），Python 3.12.3，PyTorch 2.11.0+cu128，CUDA 12.8，NVIDIA RTX 4090（驱动 621.01）。
- 依赖环境：`/home/tensor/aimlab-verify-venv`（`--system-site-packages`）额外安装 `pytorch_lightning 2.6.5`、`cupy-cuda12x 13.4.1`、`tensorboardX`、`numpy 1.26.4`；系统已有 torch/ase/matplotlib/pyyaml。
- 外部资源：`nep.analyze` 的 `{skill:nep-regression-rmse}` 使用本机已注册的 skill（`…/.codex/skills/nep-regression-rmse/scripts/plot_nep_regression.py`）；该路径不进入交付材料，属于调用时选择的本地资源。
- GPUMD 测试构建：`/home/tensor/gpumd-opes-build`，CMake Release、`CMAKE_CUDA_ARCHITECTURES=89`、LibTorch `/home/tensor/.local/lib/python3.12/site-packages/torch`，由当前 `aimlab` 分支源码增量重建（`cmake --build -j 64`）。
- 工具仓库 aimlab 分支（本轮验证时）：GPUMD `bd719b98`，pygas `ba578738`，pydyn `2ac6915`，torchnep `4c3474ba`，hotpp `fa4b33a8`。
- Studio `tool` 分支包含声明检查、`tools.aimlab.*` 登记、adapter 一致性检查与声明驱动 prepare（15/15 parity、生产 bootstrap 强制声明）。

## 逐功能最小测试结果

| 工具 | 函数/用例 | 状态 | 检查方式与产物 |
| --- | --- | --- | --- |
| GPUMD | `gpumd.md` / `gpumd-md.basic` | **passed** | 当前源码构建的 `gpumd`；`thermo.out` 10×18、`dump.xyz` 2×250、`restart.xyz` 1×250（最终快照） |
| GPUMD | `gpumd.sampling` / metad | **passed** | `gpu-sampling`；模型加载 + 完成日志 + `GASCVlog.txt` 11×4 |
| GPUMD | `gpumd.neb` / basic | **passed** | `gpu-sampling`；NEB step summary + `neb_energies.out` 7 点 + `final_traj.xyz` 7×63 |
| GPUMD | `nep.train` / basic | **passed** | `nep`；训练结束日志、generation 100 loss、`nep4 2 Te Pb` 模型、restart、预测输出 |
| GPUMD | `nep.eval` / basic | **passed** | 仓库 `tools/nep_predict.py` + `nep`；`evaluation.json` 角色/SHA256 与 4 类 `*_test.out` |
| GPUMD | `nep.analyze` / basic | **passed** | 注册的 `nep-regression-rmse` skill；`regression/` 内 PDF/PNG/metrics.csv/metrics.json/metrics.md |
| pygas | `pygas.build` / build.basic | **passed** | `python -m entrypoints.cli compile`；`.pt` + manifest + compile report（CPU） |
| pygas | `bias.validate` / validate.basic | **passed** | `validate_model.py`；`validate-result.json` ABI/形状（CPU） |
| pygas | `pygas.reweight` / reweight.basic | **passed** | `GASrGaussian.txt`、`GASFES.txt`、`FES.png`（CPU） |
| pygas | `pygas.opes-reweight` / opes-reweight.basic | **passed** | `OPES_FES.txt/.npz/.png/_summary.json`（CPU） |
| pydyn | `pydyn.md` / md.basic | **passed** | 验证 venv 中 PyDyn + torch/CuPy/CUDA；参考驱动 2 步，log 2 行、轨迹 2 帧 |
| pydyn | `pydyn.sampling` / sampling.basic | **passed** | 验证 venv；真实 2 步偏置 NVE，CV 日志 3 行（初始 + 2 步）、配对检查点与序列化 ABI 复核 |
| torchnep | `torchnep.train` / train.basic | **passed** | CPU eager FP64、2 epoch；`run_config.json`、`history.jsonl`、`latest.txt`、`best.txt`、`checkpoint.pt` 校验 |
| hotpp | `hotpp.train` / train.basic | **passed** | 验证 venv；1 epoch CUDA 训练，`best.pt`/`best.ckpt`/`metadata.yaml` |
| hotpp | `hotpp.eval` / eval.basic | **passed** | 验证 venv；1 epoch 前置模型 + `hotpp eval`，5 个 `.npy` 形状/内容检查 |
| hotpp | `hotpp.export` / export.basic | **passed** | 验证 venv；`hotpp freeze` 产物可 `torch.jit.load`，float64 参数检查 |

## 结论与限制

> 注：上表 `nep.eval` / `nep.analyze` 两行记录的是旧 helper 方案；Studio `1.0.1` 起改用 NEP 原生 `train.xyz` 与 `*_train.out`（见文末 1.0.1 节），旧 `nep_predict.py` 与 `evaluation.json` 路径已删除。

- 本次开发者环境：**16/16 最小用例 passed，0 failed / 0 blocked**（`nep.analyze` 在注册外部 skill 后通过）。
- 范围限制：未运行 Studio 安装/配置流水线、用户真实环境配置、科学精度/收敛验证、`.pt2` AOTI 工具链；不据此声称任意环境、任意参数组合或科学结论已验证。
- 外部资源：`nep.analyze` 需要调用时注册 `{skill:nep-regression-rmse}`；`pydyn`/`hotpp` 需要各自声明的 Python/GPU 依赖（本次用验证 venv 满足）。这些不随 Studio 源码分发。
- 证据驱动修正（已提交到对应工具仓库 `aimlab` 分支）：
  - GPUMD `gpumd.md`：`dump_restart` 覆盖写整个文件，最终只保留最后一步快照（1 帧），不是 2 帧；
  - pydyn `pydyn.sampling`：真实 CV 日志为“初始行 + 每步一行”（2 步 → 3 行），原断言按 2 行错误；
  - pydyn wrapper 对缺失 CuPy 等依赖改为显式 `blocked`（exit 3）而不是 traceback/exit 1。

## 2026-11-08 工具接入契约硬化后复验（Studio dev.42）

日期：2026-11-08 · 性质：声明/绑定/检查与参考配置闭环的软件复验（非真实安装、非科学验证）· 原始证据保存在 ignored 的 `.studio/final-verification/20261108-183824/`、`.studio/audit-tool-contracts/`、`.studio/tool-repo-updates/` 与 `.studio/final-parity.json`，本文件只记录范围与结论。

**范围与候选版本**：Studio `tool` 分支 dev.42（`contracts/tools/engine-contracts.json` 新增 `aimlab_tool_id`/`declaration_tokens`/`parameter_transforms`/`aimlab_repository_keys`；声明路径保留硬编码校验；bias mode 归一化；自包含扫描；conformance/parity 强化；bootstrap 兼容默认）。工具仓 `aimlab` 分支候选提交：GPUMD `73ed40d4`、pygas `4d981f8`、pydyn `5c6b67e`、hotpp `e5d0cc5`、torchnep `4c3474ba`（torchnep 无改动，已符合）。

| 检查 | 结果 | 范围/证据 |
| --- | --- | --- |
| AimLab 声明检查（5 仓） | **5/5 passed**（`definition_checked`；installation/tests/release=`not_run`） | `.studio/final-verification/20261108-183824/*-declaration.json` |
| 多源汇总 | **5/5 passed，0 failed** | 同目录 `sources.json` |
| adapter conformance（16 声明） | **15 passed + 1 pending**（`torchnep.train` 无 Studio adapter，预期）；`--allow-pending` 下 `status=passed` | 同目录 `conformance.json` |
| 可复现 parity（替换自证审计） | **20/20 用例 argv 一致 + 2/2 负例双方拒绝** | `.studio/final-parity.json`；命令 `python3 scripts/check-aimlab-parity.py --repos-root <dir>` |
| 真实 CPU reference 配置闭环 | **11/11 checks passed**（真实 worker 安装/固定测试/执行 skill/body-only 运行；native_ui/scientific=`not_run`） | `.studio/audit-tool-contracts/e2e-dev42/` |
| Electron 原生包面板 | **7/7 checks passed**（version `1.0.0-dev.42`；tool installation/model/cluster/scientific=`not_run`） | `.studio/audit-tool-contracts/native-tool-package-dev42/` |
| AimLab 登记（真实 Catalog） | **5/5 登记 passed**，`definition_checked`，不复制源码 | `.studio/audit-tool-contracts/reports/aimlab-registry.json` |
| 开发者 skill CPU reference | 生成 → `schema_checked` → 真实 inspect/register `definition_checked`，快照存在 | `.studio/audit-tool-contracts/devskill/developer-package-report.json` |
| Node / Python / 静态检查 | Node **3111（3103 通过/0 失败/8 skip）**；Python worker **779（2 skip）**；`tsc` 0；doc links 81；契约同步 current | `.studio/audit-tool-contracts/node-tests-final-dev42.log` 等 |

**结论**：本轮范围内声明、绑定、检查、登记与参考配置流程通过；**未运行真实工具安装、GPU/CUDA、16 个最小用例复跑、科学精度/收敛或用户真实环境配置**，均记为 `not_run/blocked`。声明检查与 parity 通过不等于真实安装或科学验证通过；工具仓默认分支仍未合入 `aimlab-tools/`，严格声明模式需按发布顺序先合入默认分支再启用。

## 2026-11-08 方案 B（nep.eval 原生命名）复验

用户确认 NEP 原生 prediction 模式只需 `prediction 1`，**只读取 `train.xyz` 并写出 `*_train.out`**；`train.xyz` 只是原生固定文件名，内容可为任意评估/验证/测试数据集。Studio 因此采用方案 B：删除 `nep_predict.py` helper，`nep.eval` 直接使用原生命名；`nep.analyze` 改用 `energy_train.out`/`force_train.out` 与 `--splits train`。

候选版本：GPUMD `aimlab` 分支重建为**基于 `GPU-Sampling` tip `7529f413` 的单提交 `2c716d71`（仅 `aimlab-tools/`；删除 helper；旧历史备份分支 `aimlab-helper-history-20261108`）**；pygas `4d981f8`、pydyn `5c6b67e`、hotpp `e5d0cc5`、torchnep `4c3474b`（无改动）。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| AimLab 声明检查 | **5/5 passed**（GPUMD 闭包 45 文件、`worktree_dirty=false`；其余 23/15/11/18） | `.studio/final-planb-verification/20261108-200548/*-declaration.json` |
| 多源汇总 | **5/5 passed，0 failed** | 同目录 `sources.json` |
| adapter conformance | **15 passed + 1 pending**（`torchnep.train` 无 Studio adapter，预期）；`--allow-pending` 下 `status=passed` | 同目录 `conformance.json` |
| 可复现 parity | **20/20 用例 argv 一致 + 2/2 负例双方拒绝** | `.studio/final-planb-parity.json` |
| 真实 CPU reference 配置闭环 | **11/11 checks passed**（真实 worker 安装/固定测试/执行 skill/body-only 运行） | `.studio/audit-tool-contracts/e2e-dev43/` |
| Electron 原生包面板 | **7/7 checks passed**（version `1.0.0-dev.43`） | `.studio/audit-tool-contracts/native-tool-package-dev43/` |
| AimLab 登记（真实 Catalog） | **5/5 `definition_checked`**（GPUMD 新 commit `2c716d71`） | `.studio/audit-tool-contracts/reports/aimlab-registry.json` |
| Node / Python / 静态 | Node **3111（3103 通过/0 失败/8 skip）**；Python worker **779（2 skip）**；`tsc` 0；doc links 81；契约同步 current | `.studio/audit-tool-contracts/node-tests-final-dev43.log` 等 |

**结论**：方案 B 的契约/绑定/声明/检查与参考配置闭环通过；**真实 `nep` 二进制/GPU 最小用例未运行（not_run）**，不据此声称推理或科学结果通过。`train.xyz` 不表示训练用途；数据集角色改由任务说明和运行记录承载。GPUMD `aimlab` 分支当前相对 `GPU-Sampling` tip 为 **1 ahead / 0 behind**，该提交只改 `aimlab-tools/`。

## 2026-11-08 Studio 1.0.1 发布前最终复核（声明绑定匹配修复）

日期：2026-11-08 · 性质：发布前独立只读复核后的修复与重跑（软件/契约/参考配置闭环；非真实安装、非科学验证）· 原始证据保存在 ignored 的 `.studio/release-101/` 与 `release/v1.0.1`。

**复核发现并修复的默认路径缺陷**（仅 Studio 侧，不涉及工具仓源码改动）：

1. 声明参数值曾使用双向前缀匹配：保留数值控制 `parameters.validation` 会被当成声明 token `validation-history`，使带 FD 控制的 `bias.validate` 在默认声明路径 `prepare` 失败（内置路径正常）；`checkpoint_dir` 也被当成 `checkpoint` 生成多余 `--load_checkpoint`。现改为归一化精确匹配，并补 Python 回归用例。
2. conformance 与 Worker 的契约 token 端口匹配同样收紧为归一化精确（输入文件名允许去掉一个常见扩展名，如 `GAScfg.yaml` ↔ `gas-cfg`），拒绝 `model-file` 冒充必需参数 `mode` 的前缀假通过；补 Node 负例。
3. 可复现 parity 脚本对声明侧强制 `STUDIO_REQUIRE_TOOL_DECLARATIONS=1`、清理 `STUDIO_DECLARATION_ENGINES` 残留，并逐用例记录/断言 `declaration_used`；空仓库根从“回退内置仍 passed”改为 **failed**。
4. 可选空数组省略时同时移除其 flag；`STUDIO_REQUIRE_TOOL_DECLARATIONS=1` 与 `STUDIO_DECLARATION_DRIVEN=0` 冲突显式报错；同一仓库多环境键登记按解析路径去重；conformance CLI 失败输出 `source_errors`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| AimLab 声明检查 | **5/5 passed**（GPUMD `2c716d71` 闭包 45 文件；pygas 23、pydyn 15、torchnep 11、hotpp 18；hotpp 工作树仅原有未跟踪目录） | `.studio/release-101/reports2/*-declaration.json` |
| 多源汇总 | **5/5 passed，0 failed** | 同目录 `sources.json` |
| adapter conformance | **15 passed + 1 pending**（`torchnep.train` 无 Studio adapter）；`--allow-pending` 下 `status=passed` | `.studio/release-101/reports2/conformance.json` |
| 可复现 parity | **20/20 argv 一致 + 2/2 负例；20/20 用例均实际使用声明**；空仓库根负例 **failed**（符合预期） | `.studio/release-101/reports2/parity.json`、`parity-empty.json` |
| 真实 CPU reference 配置闭环 | **11/11 checks passed**（真实 worker 安装/固定测试/执行 skill/body-only 运行） | `.studio/release-101/e2e-final/wire-6HZTn9/report.json` |
| Electron 原生包面板 | **7/7 checks passed**（version `1.0.1`） | `.studio/release-101/native-final/receipt.json` |
| Node / Python / 静态 | Node **3112（3104 通过 / 0 失败 / 8 skip）**；Python worker **782（2 skip）**；`tsc` 0；doc links 81；契约同步 7/7 current | `.studio/release-101/node-tests-final.log`、`worker-tests-final.log`、`build-final.log` 等 |
| portable 包与启动 | `release/v1.0.1` 构建并核验：ASAR 1190 项、worker 134 文件逐字节一致、版本 1.0.1；解包 exe 与 portable exe 均实际启动、渲染 1.0.1、0 退出；未签名 | `.studio/release-101/package-check.log`、`packaged-startup/`、`portable-startup/` |

**结论**：本轮修复后，默认声明路径与内置路径的 argv 一致、检查器不再因前缀相似假通过、parity 缺声明会失败；AimLab 声明/来源/conformance/parity/参考配置闭环均通过。**真实安装、GPU/CUDA、16 个最小用例、科学精度/收敛仍未运行**；工具仓默认分支仍未合入 `aimlab-tools/`，严格声明模式需先合入默认分支。此记录随 Studio `1.0.1` 正式发布冻结为基线。
