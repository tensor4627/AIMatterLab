# AimLab 内部工具（工具仓库内 `aimlab-tools/` 约定）

> 仅供 AimLab 内部工具（例如 GPU-Sampling）使用，第三方开发者可忽略本文件。第三方工具仍按本 skill 的 `<id>-package` 交付格式接入；本约定不改变现有包注册契约。
>
> 本文件随接入 skill 分发。内部声明所需的纯声明校验器、schema 与引擎契约都在 skill 目录内（`references/aimlab-tools.mjs`、`references/tool-package.mjs`、`references/tool-package.schema.json`、`references/engine-contracts.json`），编写声明不需要访问 Studio 源码；引擎参数事实以随附的 `references/engine-contracts.json` 为准。

## 1. 基本定位

AimLab 内部工具不在 Studio 里再复制一份源码或单独维护交付包，而是把接入声明随工具源码放在工具仓库里：

- 工具开发者在工具仓库的**主工作分支**维护根目录 `aimlab-tools/`；
- Studio 按指定 commit 读取源码，校验声明、文件闭包与测试映射，**不复制整个工具仓库**；
- `aimlab-tools/` 的声明和文件必须提交进 Git，只存在于工作树、未提交的内容不构成有效声明；
- 检查通过只表示 `declaration_checked`；真实安装、逐功能测试和放行另行记录。

**可写范围**：生成或更新 `aimlab-tools/` 时，只允许修改工具仓库的 `aimlab-tools/` 目录；工具仓库其他文件保持既有默认分支内容不变。补充的 wrapper、测试和说明放在 `aimlab-tools/` 内，不修改、不移动、不重排原仓库的源码、已有测试和配置。

## 2. 仓库内的目录要求

```text
<tool-repository>/
└── aimlab-tools/
    ├── manifest.json          # 必需：机器可读声明（五项定义）
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

固定要求：

- 工具仓库根目录下的 `aimlab-tools/` 是唯一入口；不要改名为其他目录；
- 五个必需文件：`manifest.json`、`SKILL.md`、`manual.md`、`tests/README.md`，以及每个功能至少一个用例目录（含 `README.md`）；
- 可选说明文件位于 `aimlab-tools/` 下、`tests/` 之外，并在 `manifest.guidance` 中逐文件声明；
- 测试输入/模型/夹具可留在工具仓库已有位置（用仓库相对路径引用），补充的小资源可放在 `aimlab-tools/tests/` 内；
- 不要求把原作者的文档或测试搬到别处；不要复制维护同一套原测试。

## 3. 中立生产契约（随 skill 分发）

`aimlab-tools/` 的声明以随 skill 分发的 `references/engine-contracts.json` 为**唯一生产事实来源**。该副本由 Studio 生成并随 skill 同步，与 Studio 侧使用的引擎契约字节一致；不要手改副本，也不要为了写声明去读取 Studio 仓库源码。声明中的 `engine`、参数、生产 token 与默认值依据都从该副本的 `engines` 条目取得；本节说明声明侧必须遵守的语义。

### 3.1 契约字段与声明要求

| 字段 | 含义 | 声明侧要求 |
| --- | --- | --- |
| `aimlab_tool_id` | 该引擎契约绑定的工具身份 | `manifest.id` 必须等于所声明功能所用引擎契约的 `aimlab_tool_id`；一个工具仓库只声明一个工具身份 |
| `required_inputs` | 引擎必需输入 | `functions[].inputs` 必须逐项包含；输入 ID 以契约名称为准，允许仅大小写/分隔符不同的等价写法（如 `run.py` → `run-py`、`GASGaussian.txt` → `gas-gaussian-txt`） |
| `required_parameters` | 引擎必需参数 | `functions[].parameters` 必须逐项包含，且以 `required: true` 声明 |
| `declaration_tokens` | 生产命令必须绑定的端口 token | 每个 token 对应的输入/参数必须已声明，并且 `operation.command` 中必须出现 `{<对应端口 id>}`；缺失任一项时声明检查与生产执行都会失败 |
| `parameter_transforms` | 公开参数值到 Studio 内部模式的归一化映射 | 声明只使用契约参数名与公开值（`choices`）；不要在命令里预映射，也不要写 Studio 内部模式名；归一化由 Studio 执行 |
| `aimlab_repository_keys` | 工具 id → 环境仓库键 | 只读映射，Studio 用它定位已注册的环境仓库；声明侧不自行定义或改写 |

当前 `aimlab_tool_id` 的取值及对应引擎：

| 工具 id（`manifest.id`） | 环境仓库键 | 契约中的引擎 |
| --- | --- | --- |
| `gpu-sampling` | `gpumd` | `gpumd.md`、`gpumd.sampling`、`gpumd.neb`、`nep.train`、`nep.eval`、`nep.analyze` |
| `pygas` | `pygas` | `pygas.build`、`pygas.reweight`、`pygas.opes-reweight`、`bias.validate` |
| `pydyn` | `pydyn` | `pydyn.md`、`pydyn.sampling` |
| `hotpp` | `hotpp` | `hotpp.train`、`hotpp.eval`、`hotpp.export` |

`declaration_tokens` 必须**逐项**出现在 `operation.command` 中，包括契约中属于可选参数性质的 token。例如：

- `bias.validate` 除 `bias_file`、`structure_file`、`mode`、`cutoff`、`cv_size` 外，还必须声明并绑定 `validation_history`、`kernel_capacity`；
- `hotpp.train` 必须绑定 `input.yaml` 与可选续训参数 `checkpoint`；
- `pygas.reweight` 必须绑定 `bias_file`、`GASGaussian.txt`、`fes.yaml`。

完整 token 列表以 `references/engine-contracts.json` 每项的 `declaration_tokens` 为准，不能只按 `required_parameters` 推断。可选输入/参数的 token 仍须写入命令：用「flag、值」两个独立 argv token 排列（如 `--load_checkpoint {checkpoint}`、`--history {validation-history}`），省略时两者一并省略；数组参数按元素展开；省略后的行为按声明中的 `default` 与 `default_behavior` 处理。

`parameter_transforms` 目前用于 `bias.validate` 的公开 `mode`：声明使用 `static` / `metad` / `wtmetad` / `bias` / `cvonly` / `opes` 等公开值，Studio 在绑定生产命令前按契约把前四种归一为 `bias`，执行与既有校验都基于归一化结果。声明不要复刻该映射，也不要直接声明内部值；值不在映射内时 Studio 报错，而不是静默透传。

声明驱动只替换生产 argv 的构造；Studio 内置适配器原有的校验（必需输入与参数、单 walker 策略、数值验证控制等）仍然生效。声明无法通过写得更薄来绕过这些校验。

### 3.2 自包含与 `default_source`

内部声明必须**自包含**，不能引用 Studio 仓库内部路径。`check-aimlab-tools` 会扫描 `aimlab-tools/**` 下的文本文件（`.md`、`.json`、`.yaml`/`.yml`、`.py`、`.mjs`/`.cjs`/`.js`、`.txt`、`.sh`、`.toml`、`.cfg`；单文件不超过 512 KiB 的 UTF-8 文本），出现以下引用即检查失败并报告 `文件:行号`：

- `backend/worker`、`backend/main`；
- `contracts/tools`；
- `desktop/`、`frontend/`；
- `agent/tools`；
- `studio_worker/`。

`default_source` 写在 `manifest.json` 中，同样属于被扫描文本。可选输入/参数的 `default_source` 只能使用两类来源：

- 随 skill 分发的契约条目，例如 `references/engine-contracts.json#/engines/bias.validate`；
- 工具仓库内的相对路径，例如 `aimlab-tools/manual.md`、`src/neb/GPU-cfneb_manual.md`。

不要把 `default_source` 写成 `backend/worker/studio_worker/tools/adapters.py`、`contracts/tools/engine-contracts.json` 之类的 Studio 路径，否则 `check-aimlab-tools` 会拒绝该声明。`SKILL.md`、`manual.md`、`tests/README.md` 等说明文本同样使用仓库相对路径与随附契约条目，不写 Studio 源码位置或开发者机器的绝对路径。

## 4. `manifest.json` 的要求

### 4.1 顶层字段

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `schema_version` | 是 | 固定 `1` |
| `id` | 是 | 工具标识：小写字母开头，字母/数字/单连字符，≤63；必须等于所声明引擎契约的 `aimlab_tool_id`（见 §3） |
| `name` | 是 | 人类可读名称 |
| `environment` | 是 | 与 `tool.json` v1 同构：`hardware`（cpu/gpu/cpu_or_gpu）、`requirements`、`parallelism`（supported/threads/processes/gpus） |
| `functions` | 是 | 非空功能列表 |
| `tests.cases` | 是 | 非空用例列表，覆盖全部声明功能 |
| `guidance` | 否 | `{installation?: string[], configuration?: string[]}`，文件位于 `aimlab-tools/` 下且不在 `tests/` 内 |

### 4.2 功能字段

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `id` / `name` / `description` | 是 | 功能标识与真实用途 |
| `engine` | 否 | 取引擎契约 `engines` 中的键（如 `gpumd.md`、`bias.validate`）；功能 `id` 本身是契约引擎键时可省略。只填字符串不创建适配器；不在契约中的引擎没有内置适配，需单独实现 Studio 侧适配 |
| `entrypoint` | 是 | 仓库相对路径的真实程序入口；位于 `aimlab-tools/` 下时只能是 `aimlab-tools/tests/` 内的 wrapper |
| `inputs` / `outputs` | 是 | `outputs` 至少一项；端口结构与默认值规则沿用 `tool.json` v1 |
| `parameters` | 是 | 可为 `[]`；`required:false` 必须有 `default`、`default_behavior`、`default_source`；`required:true` 不得有 default |
| `operation` | 是 | `{command, failure_handling}`；`command` 是生产 argv 数组，不能含换行/NUL，token 规则见 §4.3 |
| `tests` | 是 | 非空用例 ID 数组，必须与 `tests.cases` 双向一致 |

### 4.3 生产调用与 token 规则

`operation.command` 必须描述**真实生产调用**，不能只调用测试 wrapper。它必须绑定 §3 要求的全部 `declaration_tokens`（包括可选参数 token）。可用 token：

- `{python}`：所选环境的 Python 解释器；
- `{entrypoint}`：该功能 `entrypoint` 解析后的仓库内路径；
- `{executable:<name>}`：所选环境注册的可执行文件（如 `{executable:gpumd}`、`{executable:gpu-sampling}`、`{executable:nep}`、`{executable:hotpp}`、`{executable:pygas}`）；
- `{skill:<name>}`：所选环境注册的外部 skill 资源根目录（例如 `{skill:nep-regression-rmse}/scripts/plot_nep_regression.py`）；资源不在工具仓库时用它显式声明依赖；
- `{<输入 id>}`：该输入在运行工作目录中的**文件名**（Worker 会把任务输入复制进 run 目录，命令用文件名而非源路径）；
- `{<参数 id>}`：该功能声明的参数值；数组参数按元素展开为多个 argv token。

token 必须匹配保留 token、`executable:<name>`、`skill:<name>`，或本功能已声明的输入/参数 ID；未声明的 token 检查失败。可选输入/参数省略时按声明默认行为处理；可选 flag 与值建议用独立 token（如 `--load_checkpoint {checkpoint}`），省略时 flag 一并省略。数组参数不能嵌入单个 argv token 内部。声明驱动路径仍会执行 Studio 内置适配器的既有校验，声明只替换生产 argv 的构造。

### 4.4 测试用例字段

每个 `tests.cases[]` 必需 `id`、`function_id`、`directory`、`instructions`、`entrypoint`、`resources`、`expected_outputs`、`pass_criteria`：

- `directory` 必须在 `aimlab-tools/tests/` 下；`instructions` 必须是该目录内的 Markdown；
- `entrypoint` 是仓库相对路径，可指向仓库已有测试文件，或 `aimlab-tools/tests/` 内的 thin wrapper；
- `resources` 是仓库相对路径数组（文件或目录，目录递归纳入），没有时显式 `[]`；
- `expected_outputs` 的 `path` 是**任务输出工作目录相对路径**，不是输入资源；
- `pass_criteria` 必须逐项可核对，既记录真实退出状态，也检查真实产物。

## 5. 测试要求：只验证环境可用与计算可运行

- 接入测试的目的是验证**用户运行环境是否可用、声明的各项计算是否能实际运行**（依赖/设备/入口/产物），**不是代码正确性验证**；代码正确性、边界、数值精度和回归由工具仓库在发布其代码时验证。
- 每个声明功能至少一个最小用例；只保留满足目的的最小用例，不要为“覆盖完整”纳入无关、重复或低级的仓库测试，以免占用交付空间和用户测试时间。
- 最小用例只做有界规模，不以短例证明科学精度、收敛或生产适用性。
- 原测试或补充 wrapper 必须运行真实工具、读取真实输出，不能只打印固定成功文本；测试资源必须随包/仓库取得。

## 6. `SKILL.md`、`manual.md`、`tests/README.md` 的内容要求

- `SKILL.md`：UTF-8，合法 YAML `name`/`description` 和非空正文；说明适用任务、真实安装/入口、输入输出与参数、工作目录、测试入口、完成/失败判定。使用仓库相对路径，不写开发者机器的绝对路径、账户或凭据。
- `manual.md`：覆盖用途、安装、输入准备、参数、运行、输出读取和错误处理。
- `tests/README.md`：包含“功能 → 用例目录”覆盖表、所需环境/设备、执行顺序、各功能原测试与资源位置、预期输出与通过标准、结果记录位置和未通过处理方式。

## 7. 接入检查与状态

编写声明只需 skill 内的 schema、校验器与契约副本；以下检查由 Studio 侧在 Studio 检出中运行（`--repo` 指向工具仓库根目录，只读，不写工具仓库、不安装、不执行测试、不注册 Studio）。

### 7.1 声明检查

```powershell
node scripts/check-aimlab-tools.mjs --repo <工具仓库> [--commit <sha>] [--out <新报告文件>]
```

- 校验 `aimlab-tools/` 已跟踪、必需文件、manifest 结构、路径闭包、测试/功能双向覆盖、`SKILL.md` 元数据；
- 扫描 `aimlab-tools/**` 文本并拒绝 Studio 内部路径引用（见 §3.2），失败时报告 `文件:行号`；
- 输出 `status`、`id`、`source_commit`、`manifest_sha256`、`declaration_sha256`、文件闭包、`installation/tests/release=not_run`。

多仓库汇总：

```powershell
node scripts/verify-aimlab-sources.mjs --repo <repo1> --repo <repo2> ... [--out <报告>]
```

### 7.2 adapter 一致性检查

替换内置 adapter 前，对照生产声明与引擎契约检查声明是否可绑定：

```powershell
node scripts/check-aimlab-adapter-conformance.mjs --repo <repo1> ... [--allow-pending] [--out <报告>]
```

检查项：

- `declared_required_inputs` / `declared_required_parameters`：契约要求的输入/参数是否已在声明中逐项出现；
- `declaration_tokens`：契约 `declaration_tokens` 的每个端口是否已声明，且 `operation.command` 是否绑定对应 token（含可选参数 token）；
- `tool_identity`：声明工具 id 是否等于契约 `aimlab_tool_id`；
- `production_operation`：生产命令是否绑定声明值，而不是只调用测试 wrapper。

没有内置引擎契约的功能记为 `pending_adapter`，**默认按失败处理（退出码 1）**；只有显式传入 `--allow-pending` 才把 `pending_adapter` 视为可接受。存在 `failed` 项或来源扫描错误时始终失败。

### 7.3 声明与适配器 argv 的 parity 检查

在 Linux/WSL 中，用包含 `GPUMD`、`pygas`、`pydyn`、`hotpp`、`torchnep` 检出的目录逐例比较声明绑定 argv 与内置 adapter argv：

```bash
python3 scripts/check-aimlab-parity.py --repos-root <目录> [--out <新报告文件>]
```

- 内置侧强制 `STUDIO_DECLARATION_DRIVEN=0`，声明侧走生产默认路径；
- 逐例比较 argv，并验证缺输入、多 walker 等负例在两侧都被拒绝；
- 只做 argv 对比，不安装、不启动引擎、不做科学验证；报告保留 `case_count`、`parity_count`、`negative_count`、`failures` 与逐例结果。

### 7.4 Studio 登记与状态

Studio 主进程提供 `tools.aimlab.*` typed 路由（`choose`、`sources.inspect`、`sources.register`、`sources.update`、`sources.list`、`sources.read`），按 `declaration_sha256` 登记外部来源，不复制工具源码。状态含义：

| 状态 | 含义 |
| --- | --- |
| `declaration_checked` | 声明与文件闭包一致；不代表安装或测试通过 |
| `installation` | 真实安装结果；未执行 `not_run`，缺条件 `blocked`，失败 `failed` |
| `tests` | 逐功能真实测试结果；缺资源 `blocked`，失败 `failed` |
| `release` | 放行/登记状态；未完成前保持 `not_run` |

只有检查通过 + 候选环境真实安装 + 声明的最小测试通过后，才按明确版本/环境/功能范围报告放行；详细限制和记录格式见 Studio 侧的完整内部标准。

## 8. 更新与版本纪律

- 工具开发者在主工作分支更新 `aimlab-tools/`，与源码一起提交；只改 `aimlab-tools/` 目录，工具仓库其他文件保持既有默认分支内容不变；
- Studio 不自动 pull；
- 每次更新都由 Studio 在候选 commit 上重新执行检查与真实测试，通过后登记新版本；
- 旧版本和旧任务保留其已登记的 commit/环境，不原地替换；
- 声明、路径、依赖或通过标准变化都视为新版本，需重新检查与验证。

## 9. 与第三方交付包的关系

第三方工具的 `<id>-package`（`tool.json` + 包根交付 `SKILL.md` + `<id>-tests/` + 原仓库副本）流程不变。内部工具的 `aimlab-tools/` 声明可以映射到等价的包内路径（`aimlab-tools/tests/**` → `<id>-tests/**`，其他 `aimlab-tools/**` → 包根，仓库其他路径 → `<id>/**`），但内部接入的交付单元是**工具仓库的 commit**，不是复制出来的包。
