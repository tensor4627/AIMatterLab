# 任务与科学契约

## 项目授权

`Project.policy` 包含 `engines`、`environments`、`gpus`、`max_seconds`、`max_concurrent` 和 `input_roots`。根目录为 Linux 绝对路径，Windows 通过 /mnt/<盘符>/ 映射。作业服务独立强制检查，Agent MCP 凭据不能修改项目或环境。

注册环境示例：

```json
{
  "name": "PyDyn 核心环境",
  "executables": {
    "python": "/home/user/venvs/md/bin/python",
    "gpumd": "/home/user/bin/gpumd",
    "nep": "/home/user/bin/nep",
    "hotpp": "/home/user/venvs/md/bin/hotpp",
    "pygas": "/home/user/venvs/md/bin/pygas"
  },
  "repositories": {
    "pydyn": "/mnt/d/data/software/pydyn",
    "pygas": "/mnt/d/data/software/pygas",
    "hotpp": "/mnt/d/data/software/hotpp"
  },
  "skills": {"nep-regression-rmse": "/mnt/c/Users/Lenovo/.codex/skills/nep-regression-rmse"},
  "variables": {}
}
```

loader 变量仅允许 LD_LIBRARY_PATH、LIBRARY_PATH、OMP_NUM_THREADS、MKL_NUM_THREADS。环境 probe 记录实际模块路径、CUDA、源码 commit 与 dirty 标记。注册普通/采样 PyDyn 时分别指向实际环境源码；sampling probe 记录其固定 pyGAS 来源。

## 用户审阅与执行（v0.2）

Agent 仅准备草稿和输入文件。MCP 不暴露 validate_run/submit_run；旧会话的这两种调用也被服务拒绝。桌面上的「确认并执行」以用户凭据创建修订快照、验证并提交，验证失败则保持未执行草稿。

/api/run/input 读取不可变输入文本及哈希；/api/run/revise 仅允许桌面用户修订未提交草稿。旧版本保留 superseded_by 并停止使用；修订标识绑定原任务、参数和文本修改。修改后的源码保留在项目输入目录，独立运行目录保持不可变。

## Run

任务请求必需：

```json
{
  "name": "GPUMD 短任务",
  "project_id": "实际项目 ID",
  "environment_id": "实际环境 ID",
  "engine": "gpumd.md",
  "gpu": 0,
  "max_seconds": 300,
  "idempotency_key": "每次新实验唯一，重试相同请求保留",
  "inputs": {"run.in": "/home/user/input/run.in", "model.xyz": "/home/user/input/model.xyz", "nep.txt": "/home/user/input/nep.txt"},
  "parameters": {"seed": 123}
}
```

inputs 的键是独立运行目录内相对路径，值是授权源文件路径。可包含安全的子目录，不能使用绝对路径、反向遍历或逃逸 symlink。

状态：draft → validating → ready → queued → running → succeeded/failed/cancelled。进程身份不能确认时为 unknown，占用 GPU 队列直到核实，不重复提交。验证状态独立为 passed/failed/blocked/not_run，并附适用范围。

每个目录含 simulation/（不可变快照）、results/、console.log、validation.json、reproduction.json、退出收据和进程身份。运行命令按 argv 执行。服务托管主进程组和时限；科学 Python 源码属于用户信任的计算输入，并非 OS 容器隔离。

## 引擎输入

| 引擎 | 必需输入/参数 |
|---|---|
| gpumd.md | run.in、model.xyz 和 run.in 引用的势模型；原生单位与初始化显式写入 run.in |
| pydyn.md | run.py 及所有引用的结构/模型；使用 pydyn.dynamics 公共 API |
| pygas.build | 静态 build_bias.py、结构；family、cv_definition、cv_units、atom_selection、pbc_convention、cutoff、output_file |
| bias.validate | bias_file、structure_file、cv_size、cutoff、mode；可附 validation_history、atom_selection、cv_reference、fd_step、fd_atol |
| gpumd.sampling | run.in、model.xyz、GAScfg.yaml、bias；run.in 必须加载确切 bias 与配置 |
| pydyn.sampling | run.py、bias/结构；独立 sampling 环境、SamplingConfig、同一 bias 实例及 hooks |
| nep.train | nep.in、train.xyz、test.xyz（后者是验证集）；prediction 0 |
| nep.eval | nep.in、nep.txt、evaluation.xyz；prediction 1、dataset_role=independent_test/validation/train |
| nep.analyze | energy_test.out、force_test.out、evaluation.json，virial_test.out 可选；环境登记原绘图 skill |
| hotpp.train | input.yaml、配置引用的数据集；可传 checkpoint |
| hotpp.eval | model_file、dataset_file 和对应输入；默认 ASE 数据类型 |
| hotpp.export | model_file、symbols（显式数组）；记录 ase-* / lammps-* 两类消费端 |
| pygas.reweight | bias_file、GASGaussian.txt、fes.yaml |
| pygas.opes-reweight | OPES_COLVAR、fes.yaml；独立于 WTMetaD |

NEP prediction 模式原生读取 train.xyz。工作台由 evaluation.xyz 明确复制出原生输入，保留原输出，再生成匹配实际角色的分析别名并写 evaluation.json。模型 species 顺序和架构必须与 nep.in 匹配。独立性仍需对照模型训练/验证结构的来源哈希，不能仅由文件名判断。

## Bias

内置距离 CV 使用零基原子编号、完整三维 PBC、row-cell 最小镜像，单位 Å；bias 能量单位 eV。只有用户显式选择完整 PBC 才生成该模板。自定义 CV 从代码入口接入，邻居/PBC/原子顺序及 CV 数维需自述。

保存后重新加载，通过原 pyGAS validate_model.py 检查真实邻居和 CV/bias/forces/virial ABI，再检查 CUDA 有限差分。默认 fd_step=1e-5 Å、fd_atol=1e-4；报告明确列出被检查原子及 cell 导数 ABI。有限差分不等于引擎动态或重启一致性。MetaD/WTMetaD 建议提供代表性非空历史，列顺序为 bias、CV 0、CV 1…。

不将缺失 virial 标签当作零，NEP -1e6 sentinel 被跳过。FES 短运行输出不等于收敛自由能；采样和重加权参数需保留。

## 续算

续算创建新 Run，并保留 parent_run、旧输入哈希和 checkpoint 来源。

- GPUMD MD/固定 static bias：checkpoint_files 中选 restart.xyz，填写 continuation_run_in 的授权路径。续算输入不得重置 velocity。历史依赖采样需单独 restart 工作流。
- HotPP：选 checkpoint_files、checkpoint、continuation_config（明确增加训练范围的 input.yaml）。checkpoint 复制为独立 resume.ckpt，避免被输出目录迁走。框架的优化器和数据策略恢复能力以实际 checkpoint 为准。
- PyDyn：显式 continuation_script + checkpoint_files。采样还需 paired_manifest，其 schema=pydyn-pygas-pair-v1，服务检查 generation 下 MD/采样文件路径与哈希并一起快照。脚本使用 initializer=[]、load_checkpoint、相同 physical_id/积分器/步长/温控上下文。
- 系统停止后 unknown 不自动重试。找不到成对状态或工具链时保留 blocked/failed，不能只用最后一帧替代完整恢复。

## 桥接与凭据

渲染进程只访问白名单 IPC，contextIsolation=true、sandbox=true、nodeIntegration=false。主进程管理 Codex 与凭据引用。WSL 服务绑定 Linux 127.0.0.1、私有 token 0600，拒绝浏览器 Origin；MCP token 仅允许结构化科学工具。

如果 Windows localhost 转发不可用，桥接通过长期 WSL stdio relay 访问 Linux 回环服务；Agent MCP 使用受 token 限制的 Windows 回环转发，不修改系统网络。OpenSSH 使用现有 config 别名和严格 host key 校验；文件浏览不会接受任意拼接 shell 参数。
