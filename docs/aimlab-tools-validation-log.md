# AimLab 内部工具开发环境接入验证记录

日期：2026-11-07 · 性质：开发者环境接入验证（非用户配置、非科学验证）· 原始证据保存在 ignored 的 `.studio/aimlab-tools-verification/`，本文件只记录范围与结论。

## 环境与源码身份

- 验证环境：WSL2 Ubuntu（Linux 6.18 WSL2），Python 3.12.3，PyTorch 2.11.0+cu128，CUDA 12.8，NVIDIA RTX 4090（驱动 621.01）。
- 依赖环境：`/home/tensor/aimlab-verify-venv`（`--system-site-packages`）额外安装 `pytorch_lightning 2.6.5`、`cupy-cuda12x 13.4.1`、`tensorboardX`、`numpy 1.26.4`；系统已有 torch/ase/matplotlib/pyyaml。
- GPUMD 测试构建：`/home/tensor/gpumd-opes-build`，CMake Release、`CMAKE_CUDA_ARCHITECTURES=89`、LibTorch `/home/tensor/.local/lib/python3.12/site-packages/torch`，由当前 `aimlab` 分支源码增量重建（`cmake --build -j 64`）。
- 工具仓库 aimlab 分支（本轮验证时）：GPUMD `bd719b98`，pygas `ba578738`，pydyn 本轮修正后的 `aimlab` HEAD，torchnep `4c3474ba`，hotpp `fa4b33a8`。
- Studio `tool` 分支包含声明检查、`tools.aimlab.*` 登记、adapter 一致性检查与声明驱动 prepare（15/15 parity）。

## 逐功能最小测试结果

| 工具 | 函数/用例 | 状态 | 检查方式与产物 |
| --- | --- | --- | --- |
| GPUMD | `gpumd.md` / `gpumd-md.basic` | **passed** | 当前源码构建的 `gpumd`；`thermo.out` 10×18、`dump.xyz` 2×250、`restart.xyz` 1×250（最终快照） |
| GPUMD | `gpumd.sampling` / metad | **passed** | `gpu-sampling`；模型加载 + 完成日志 + `GASCVlog.txt` 11×4 |
| GPUMD | `gpumd.neb` / basic | **passed** | `gpu-sampling`；NEB step summary + `neb_energies.out` 7 点 + `final_traj.xyz` 7×63 |
| GPUMD | `nep.train` / basic | **passed** | `nep`；训练结束日志、generation 100 loss、`nep4 2 Te Pb` 模型、restart、预测输出 |
| GPUMD | `nep.eval` / basic | **passed** | 仓库 `tools/nep_predict.py` + `nep`；`evaluation.json` 角色/SHA256 与 4 类 `*_test.out` |
| GPUMD | `nep.analyze` / basic | **blocked** | 缺少外部 `nep-regression-rmse` 分析程序（`{skill:nep-regression-rmse}` 未注册）；输入已准备好 |
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

- 本次开发者环境：**15/16 最小用例 passed，1 blocked（`nep.analyze` 缺少外部 skill）**；blocked 项未计为通过。
- 未运行：Studio 安装/配置流水线、用户真实环境配置、科学精度/收敛验证、`.pt2` AOTI 工具链；上述结论只覆盖本文列出的版本、环境与最小用例。
- 证据驱动修正（本轮，均已提交到对应工具仓库 `aimlab` 分支）：
  - GPUMD `gpumd.md`：`dump_restart` 覆盖写整个文件，最终只保留最后一步快照（1 帧），不是 2 帧；
  - pydyn `pydyn.sampling`：真实 CV 日志为“初始行 + 每步一行”（2 步 → 3 行），原断言按 2 行错误；
  - pydyn wrapper 对缺失 CuPy 等依赖改为显式 `blocked`（exit 3）而不是 traceback/exit 1。
