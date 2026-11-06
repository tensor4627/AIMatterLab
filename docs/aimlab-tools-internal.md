# AimLab 内部工具声明与接入检查标准

> 适用范围：仅 AimLab 内部工具（例如 GPU-Sampling）。第三方开发者仍按 [`<id>-package`](../developer/skills/studio-tool-integration/SKILL.md) 交付格式接入；本文件不是对外协议，也不改变现有包注册契约。

## 1. 定位与原则

AimLab 内部工具的接入声明放在工具自己的 Git 仓库主工作分支中，随源码版本走：

- 工具开发者只维护工具仓库里的 `aimlab-tools/`：机器可读声明、交付/操作 skill、精简手册和测试映射；
- Studio 侧按**指定 commit** 读取源码并检查声明、路径闭包和测试映射，不复制整个工具仓库；
- 检查结果只是 `declaration_checked`。真实安装、逐功能测试和放行分别记录，不能用检查代替安装或科学验证；
- Studio 不自动 pull。候选版本由受控流程取得，通过检查并在真实环境验证后才替换已放行版本；旧任务继续使用旧版本。

这样避免了两个问题：把整个工具仓库复制进 Studio 包（体积大、与“兄弟引擎仓库不改动”的约束冲突），以及“声明在 Studio 仓库、源码在工具仓库”导致的版本错位。

## 2. 目录结构

```text
<tool-repository>/
└── aimlab-tools/
    ├── manifest.json          # 必需：机器可读的五项定义声明
    ├── SKILL.md               # 必需：交付/操作 skill（UTF-8，YAML name/description）
    ├── manual.md              # 必需：精简人类操作手册
    ├── install.md             # 可选：安装指导（在 manifest.guidance 中声明）
    ├── configure.md           # 可选：配置指导（在 manifest.guidance 中声明）
    ├── references/            # 可选：补充说明，随 aimlab-tools/ 整体纳入闭包
    └── tests/
        ├── README.md          # 必需：整套测试介绍与执行入口
        └── <function>/        # 每个声明功能至少一个用例目录
            ├── README.md      # 必需：用例说明（manifest 中的 instructions）
            └── run-test.py    # 可选：薄 wrapper；也可直接指向仓库内已有测试
```

`aimlab-tools/` 下的文件必须提交进 Git；只存在于工作树、未提交的文件不构成声明。

## 3. `manifest.json`

```json
{
  "schema_version": 1,
  "id": "gpu-sampling",
  "name": "GPU-Sampling",
  "environment": {
    "hardware": "gpu",
    "requirements": ["Linux", "CUDA toolkit", "LibTorch（版本按 lane 声明）"],
    "parallelism": {"supported": ["serial"], "threads": 1, "processes": 1, "gpus": 1}
  },
  "functions": [
    {
      "id": "gas.metad",
      "name": "MetaD sampling",
      "description": "用 TorchScript/AOTI 模型运行 MetaD 采样",
      "entrypoint": "aimlab-tools/tests/metad/run-sampling.py",
      "inputs": [],
      "outputs": [
        {
          "id": "cv-log",
          "type": "file",
          "format": "text",
          "description": "GASCVlog 格式的 CV 轨迹",
          "required": true,
          "display": {"priority": 100, "advanced": false, "reason": "主产物"}
        }
      ],
      "parameters": [],
      "operation": {
        "command": ["{python}", "{entrypoint}"],
        "failure_handling": "保留日志与失败退出码，核对真实输出后再重试。"
      },
      "tests": ["metad.basic"]
    }
  ],
  "tests": {
    "cases": [
      {
        "id": "metad.basic",
        "function_id": "gas.metad",
        "directory": "aimlab-tools/tests/metad",
        "instructions": "aimlab-tools/tests/metad/README.md",
        "entrypoint": "tests/gpusampling/test-metad/test_metad.py",
        "resources": ["tests/gpusampling/test-metad"],
        "expected_outputs": [
          {"path": "GASCVlog.txt", "format": "text", "description": "有限步 CV 轨迹"}
        ],
        "pass_criteria": ["进程退出码为 0", "GASCVlog.txt 可解析且包含预期列"]
      }
    ]
  }
}
```

### 3.1 顶层字段

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `schema_version` | 是 | 固定 `1` |
| `id` | 是 | 工具标识，小写字母开头，字母/数字/单连字符，≤63 字符；与 Studio 工具身份一致 |
| `name` | 是 | 人类可读名称 |
| `environment` | 是 | 与 `tool.json` v1 的 `environment` 同构（hardware/requirements/parallelism） |
| `functions` | 是 | 非空功能列表 |
| `tests.cases` | 是 | 非空用例列表，覆盖所有声明功能 |
| `guidance` | 否 | `{installation?: string[], configuration?: string[]}`，文件路径位于 `aimlab-tools/` 下且不在 `aimlab-tools/tests/` 内 |

### 3.2 `functions[]`

字段与 `tool.json` v1 的功能定义相同：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `id` / `name` / `description` | 是 | 功能标识与说明 |
| `engine` | 否 | 有真实 Studio 适配时填准确 engine 标识；只填字符串不创建适配器 |
| `entrypoint` | 是 | 仓库相对路径的真实程序入口；若位于 `aimlab-tools/` 下，必须是 `aimlab-tools/tests/` 内的 wrapper |
| `inputs` / `outputs` | 是 | `outputs` 至少一项；端口结构、默认值规则与 `tool.json` 相同 |
| `parameters` | 是 | 可为 `[]`；可选参数必须有 `default`、`default_behavior`、`default_source` |
| `operation` | 是 | `{command, failure_handling}`；`command` 是实际生产 argv 数组，不能含换行/NUL。token 规则见 3.5。 |
| `tests` | 是 | 非空用例 ID 数组，必须与 `tests.cases` 双向一致 |

### 3.5 生产调用与测试入口分离

`functions[].operation.command` 必须描述**生产调用**，而不是接入检查用例：

- `{python}`：所选环境的 Python 解释器；
- `{entrypoint}`：`entrypoint` 解析后的仓库内路径；
- `{executable:<name>}`：所选环境注册的可执行文件（如 `{executable:gpumd}`、`{executable:gpu-sampling}`、`{executable:nep}`、`{executable:hotpp}`、`{executable:pygas}`）；
- `{skill:<name>}`：所选环境注册的外部 skill 资源根目录（如 `{skill:nep-regression-rmse}/scripts/plot_nep_regression.py`）；资源不在工具仓库时用该 token 显式声明依赖，未注册时检查/执行报错；
- `{<输入 id>}`：该输入在运行工作目录中的**文件名**（Worker 会把任务输入复制进 run 目录，生产命令使用文件名而不是源路径）；
- `{<参数 id>}`：该功能声明的参数值；数组参数按元素展开为多个 argv token。

token 必须匹配保留 token、`executable:<name>`，或本功能已声明的输入/参数 ID；未声明的 token 检查失败。可选输入/参数省略时按声明默认行为处理。`tests.cases[].entrypoint` 与用例 wrapper 只用于环境/可运行性检查，不得作为 `operation.command` 的唯一实现来冒充生产调用。

编译型工具（GPUMD、NEP 等）的 `entrypoint` 可以是仓库内的启动 wrapper，但 `operation.command` 应调用 `{executable:<name>}` 指向用户环境实际注册的二进制；只有确实没有独立可执行入口的 Python 工具才使用 `{python}` + 入口脚本/模块。

### 3.3 `tests.cases[]`

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `id` / `function_id` | 是 | 用例 ID 与所属功能 |
| `directory` | 是 | 必须位于 `aimlab-tools/tests/` 下 |
| `instructions` | 是 | 必须位于该用例目录内、以 `.md` 结尾 |
| `entrypoint` | 是 | 仓库相对路径；可为仓库内已有测试，或 `aimlab-tools/tests/` 内的 wrapper |
| `resources` | 是 | 仓库相对路径数组；文件或目录，目录递归纳入闭包；没有时显式 `[]` |
| `expected_outputs` | 是 | 非空；`path` 是任务输出目录相对路径，不是输入资源 |
| `pass_criteria` | 是 | 非空、可逐项核对；既记录真实退出状态，也检查真实产物 |

最小用例只检查输入输出契约、安装和环境，不承担科学精度或生产收敛验证，也不承担代码正确性验证；代码正确性在工具发布时由原仓库测试/CI 验证。只为每个声明功能保留能证明其在用户环境可运行的最小用例，不要纳入无关、重复或低级的仓库测试，以免占用交付空间和测试时间。

### 3.4 路径与映射

- 所有声明路径以**仓库根**为基准，使用 `/`，不允许绝对路径、`..`、反斜杠、控制字符或 `.git` 段；
- `aimlab-tools/tests/**` 对应交付包中的 `<id>-tests/**`；
- 其它 `aimlab-tools/**` 对应交付包根（`SKILL.md`、`manual.md` 等）；
- 其它仓库路径对应交付包中的 `<id>/**`；
- 引用仓库已有测试时用仓库相对路径，不复制、不搬家；需要补充的 wrapper 放在 `aimlab-tools/tests/<function>/` 内。

## 4. `SKILL.md`、`manual.md` 与 `tests/README.md`

- `SKILL.md`：UTF-8，合法 YAML `name`/`description` 和非空正文；说明适用任务、所需上下文、真实安装入口、输入输出与参数、工作目录、测试入口、完成/失败判定。路径使用仓库相对路径，不写开发者机器绝对路径、账户或凭据。
- `manual.md`：精简人类操作说明，覆盖用途、安装、输入准备、参数、运行、输出读取和错误处理。
- `tests/README.md`：整套测试介绍，至少包含“功能 → 用例目录”覆盖表、所需环境/设备、执行顺序、各功能原测试与资源位置、预期输出与通过标准、结果记录位置和未通过处理方式。

## 5. 接入检查

检查命令在 Studio 仓库内执行（`--repo` 指向工具仓库根目录）：

```powershell
node scripts/check-aimlab-tools.mjs --repo <工具仓库路径> [--commit <sha>] [--out <新报告文件>]
```

需要一次核对多个已提交的工具仓库时：

```powershell
node scripts/verify-aimlab-sources.mjs --repo <工具仓库1> --repo <工具仓库2> ... [--out <新报告文件>]
```

汇总报告 `scope=aimlab_tools_sources`；任一来源失败时退出码为 1，并保留每个来源的失败原因。

替换内置 adapter 前，用一致性检查对照生产声明与 `contracts/tools/engine-contracts.json`：

```powershell
node scripts/check-aimlab-adapter-conformance.mjs --repo <工具仓库1> --repo <工具仓库2> ... [--out <新报告文件>]
```

检查项包括必需输入、必需参数与生产 `operation.command` 是否绑定声明值；没有内置 adapter 的引擎记为 `pending_adapter`（不算通过）。只有全部声明 `passed` 才能进入 adapter 替换与真实安装/测试。

Studio 主进程提供 `tools.aimlab.*` typed 路由（`choose`、`sources.inspect`、`sources.register`、`sources.update`、`sources.list`、`sources.read`）：按声明的 `declaration_sha256`（commit + manifest + 闭包）登记外部仓库，**不复制工具源码**；登记记录只保存来源路径、commit、声明与文件哈希。`installation` / `tests` / `release` 仍为 `not_run`，真实安装与测试按第 6 节单独记录。

行为：

- 只读：不写工具仓库、不安装、不运行测试、不注册 Studio；
- 默认检查 `HEAD`，也可指定任意已提交的 commit；
- 校验 `aimlab-tools/` 在 commit 中已跟踪、必需文件存在、manifest 结构、声明路径闭包、测试/功能双向覆盖、`SKILL.md` 元数据；
- 计算 `manifest_sha256`、`declaration_sha256` 和闭包哈希；闭包包含 `aimlab-tools/` 下全部已跟踪文件，以及 manifest 声明的仓库内入口和测试资源；
- 检查基于 commit；工作树是否有未提交改动只记录在 `worktree_dirty`，不影响 commit 内容校验；
- 输出 JSON：`status`、`id`、`source_commit`、`manifest_sha256`、`declaration_sha256`、`file_count`、`files`、`installation`/`tests`/`release` 均为 `not_run`、`limitations`；
- 失败时退出码为 1，并把失败原因写入 stderr；`--out` 只接受不存在的新文件，且不得位于工具仓库内。

检查通过表示**声明与文件闭包一致**；不表示安装、功能或科学验证通过。

## 6. 状态与放行

| 状态 | 含义 |
| --- | --- |
| `declaration_checked` | 本检查通过；声明、路径闭包和测试映射一致 |
| `installation` | 真实安装结果；未执行为 `not_run`，缺依赖为 `blocked`，失败为 `failed` |
| `tests` | 逐功能真实测试结果；未执行为 `not_run`，缺资源为 `blocked`，失败为 `failed` |
| `release` | 放行/登记状态；未完成前保持 `not_run` |

放行条件：

1. 在候选 commit 上通过本检查；
2. 在声明的候选环境完成真实安装；
3. 声明的全部最小测试通过（`passed`），或缺失项已明确记为 `blocked`/`not_run` 并说明原因；
4. 记录版本（commit、`declaration_sha256`）、环境、命令、退出码、输出检查和证据位置；
5. 之后才在 Studio 侧登记/更新放行版本（登记与版本快照的 Studio 实现见第 7 节）。Studio 不自动 pull，不原地替换旧任务依赖的版本。

## 7. 当前实现范围与限制

- 已实现：本文件第 5 节的只读声明与文件闭包检查脚本、`tools.aimlab.*` 登记路由、生产声明与 `engine-contracts.json` 的 adapter 一致性检查、Worker 端声明绑定模块 `studio_worker.tools.declarations`，以及 `Adapter.prepare` 的声明驱动集成：`DEFAULT_DECLARATION_ENGINES` 已覆盖全部 15 条内置 route；已注册源码仓库存在 `aimlab-tools/manifest.json` 时默认使用声明 argv，`STUDIO_DECLARATION_DRIVEN=0` 可关闭、`=1` 可扩大试点、`STUDIO_DECLARATION_ENGINES` 可指定 allowlist；Worker 启动脚本（`bootstrap.py`）默认设置 `STUDIO_REQUIRE_TOOL_DECLARATIONS=1`，生产 worker 在缺少声明时明确报错，兼容回退只对显式设置 `STUDIO_REQUIRE_TOOL_DECLARATIONS=0` 的开发/测试进程保留。`nep.eval` 的生产 helper 已迁入 GPUMD 仓库 `tools/nep_predict.py`，Studio 侧旧 `nep_predict.py` 已删除；`nep.analyze` 使用 `{skill:nep-regression-rmse}` 外部资源 token，未注册时检查/执行报错；
- 未实现：Studio 内的版本登记/快照、`engine` 与 Worker 适配器交叉校验、移除遗留兼容回退、真实安装/GPU 执行验证、通用安装与执行配置（当前自动配置仅支持固定串行 CPU `installation.check` reference）；
- 因此检查通过不等于“已接入 Studio”。登记、环境配置和真实测试通过须按实际实现另行完成并记录；
- 第三方 `<id>-package` 的注册路径保持不变，仍由 `studio-tool-integration` 与现有包注册实现处理。

## 8. 更新流程

1. 工具开发者在主工作分支更新 `aimlab-tools/`，与源码一起提交；
2. 通知 Studio 候选 commit；
3. Studio 在候选 commit 上运行接入检查，保存报告；
4. 在候选环境安装并运行声明的测试，逐项记录 `passed / failed / blocked / not_run`；
5. 全部通过后放行并登记新版本；旧版本和旧任务保持不变；
6. 声明、路径、依赖或通过标准变化都视为新版本，需要重新检查与验证。
