# tool.json v1：声明、注册与版本

本目录带有 [完整 JSON Schema](tool-package.schema.json) 和 [纯声明校验实现](tool-package.mjs)，两者随 skill 一起迁移。`scripts/check-manifest.mjs` 使用这些文件，不依赖 Studio 仓库、第三方 Node 模块或网络。需要支持 JSON import attributes 的 Node 22.13+；小示例另需 Git，真正执行示例才需 Python 3。

## 字段与默认值

`tool.json` 放在 `<id>-package` 根。所有对象均拒绝 schema 未声明的字段，不能额外填入 `version`、安装成功状态或自造权限。必填字段如下：

| 字段 | 内容及默认 |
| --- | --- |
| `schema_version` | 固定 `1` |
| `id`, `name` | `id` 为小写字母开头、字母数字及单连字符，最多 63 字符；包目录必须为 `<id>-package`。`name` 为人类名称 |
| `repository` | `{path, commit}`；包内原 Git 仓库路径和真实 40/64 位小写十六进制 HEAD。不要伪造提交或改写原历史 |
| `manual` | 包内人类操作说明文件，可以保留在原作者位置 |
| `guidance` | 对象必填；`delivery` 默认且只能为根 `SKILL.md`；`installation`、`configuration` 默认 `[]`，列出具体指导文件 |
| `environment` | `hardware: cpu/gpu/cpu_or_gpu`；`requirements` 字符串数组；`parallelism.supported` 为 serial/threads/processes/devices 的非空不重复数组。threads=1、processes=1、gpus=0 为默认；CPU 工具 gpus 必须为0 |
| `functions` | 非空功能列表，逐项定义下表内容 |
| `tests` | `{directory, introduction, cases}`；directory 必须为 `<id>-tests`，introduction 为其内 Markdown，总 cases 非空 |

每个功能包含：

| 字段 | 内容及默认 |
| --- | --- |
| `id`, `name`, `description` | 功能标识、名称和实际用途。功能/测试/端口/参数 ID 最多96字符，小写字母开头，允许字母数字及分隔的 `.`/`-` |
| `engine` | 默认 `null`。有真实 Studio 适配时填其准确 engine 标识；仅填写字符串不创建适配器 |
| `entrypoint` | 实际程序文件的包内相对路径 |
| `inputs`, `outputs` | 输入可为空，输出至少一项；每项 `{id,type,format,description,required,display}`，type 为 file/files/directory/value。description 应给出定位、单位、格式约束及管理行为 |
| `parameters` | 默认 `[]`；每项 `{id,type,description,required,display}`，type 为 string/number/integer/boolean/array/object，unit 默认 null |
| 可选项的默认 | IO/参数 `required:false` 时必须显式有 `default`、非空 `default_behavior` 与 `default_source`，描述省略/不生成的可执行语义；required:true 不得有 default。参数非 null 默认须匹配类型；null 默认必须解释行为 |
| `display` | 每个 IO/参数必填 `{priority:0..100,advanced:boolean,reason}`。按重要性与调整频率选择较大优先级先展示，advanced 表示二级菜单；这是声明，不代表自动生成了界面 |
| `operation` | 非空 argv 字符串数组 `command`，必填 `failure_handling`，working_directory 默认且只能为 `{workdir}`。令牌不得包含 CR/LF/NUL；描述实际解释器、`{entrypoint}`、资源和参数如何绑定，不能当 shell 脚本或通用自动模板执行器 |
| `tests` | 非空测试 ID 数组；所有引用必须能匹配 cases 中本功能的测试，不能重复 |

每个 `tests.cases[]` 必填 `id,function_id,directory,instructions,entrypoint,resources,expected_outputs,pass_criteria`：

- `directory` 在测试总目录内；`instructions` 为此子目录内 Markdown。
- `entrypoint` 可直接指向原仓库的测试文件，也可为测试总目录内薄 wrapper。原作者测试不用移动。每个功能子目录仍需简短说明和必要脚本/重定向入口。
- `resources` 为所有所需测试资源的包内路径，允许文件或目录，目录递归纳入。原仓库中的已跟踪资源可直接引用，不重复复制；包外层数据可以独立存放，不强制纳入 Git。没有数据时显式 `[]`。
- `expected_outputs` 非空，每项 `{path,format,description}`；path 是任务 **输出 workdir 相对路径**，不是现存输入资源，不需事先制造输出。描述实际结构/字段/形状/容差。
- `pass_criteria` 为非空字符串数组，逐项可核对；既记录真实退出状态，也检查真实产物。

接入测试用例用于证明相应功能在用户环境可安装、可运行并产生承诺产物，不承担代码正确性回归；完整回归、边界和数值测试留在原仓库发布流程。不要为“覆盖完整”加入无关、重复或低级的仓库测试。

全部长度、数量和数据类型界限以随附 schema 为准；manifest 最大512 KiB、有限 JSON、最多12000节点及24层。检查器会补齐声明默认值，但不推断功能或生成安装成功结论。

```text
node <SKILL_DIR>/scripts/check-manifest.mjs <PACKAGE_ROOT>/tool.json
```

成功为 `schema_checked`，安装/测试仍为 `not_run`。该命令只检查 manifest 及以下纯声明约束：规范路径、ID去重、测试覆盖双向一致、默认值及来源、CPU/GPU 默认一致性。它不检查仓库实际 HEAD、文件存在或链接闭包；后者是实际注册检查的职责。

## 注册的额外文件约束

以下约束独立于 JSON Schema 的形状验证，同样是包交付要求：

- manifest 中的资源路径为规范包内 `/` 相对路径；不得绝对、空段、`.`、`..`、反斜杠、控制字符、Windows 保留字符或 `.git` 段。实际文件名还不得尾随点/空格、使用 Windows 设备保留名，或只因大小写不同发生碰撞。输出相对路径适用同样规范。
- 原仓库必须是包内独立完整 Git 仓库，含真实 `.git` 目录。注册不支持 worktree 的 `.git` 指针、浅克隆、partial/promisor clone、对象 alternates、submodule 或链接 Git 管理目录。保留开发者现场，在新副本中准备合适仓库；不要擅自补拉远程或重写分支。
- manifest commit 必须等于实际 HEAD；工作树和索引须干净，无普通未跟踪文件、隐藏的 assume-unchanged/skip-worktree 状态。注册不会替作者提交未提交工作。运行输出放仓库外明确的运行目录。
- 全部已跟踪源码、`tool.json`、手册、具体指导文件、功能/测试入口、测试介绍、说明、resources 和整个测试总目录组成递归闭包。其他包外层引用也要通过这些声明纳入闭包；注册不会顺着 Markdown 文本任意抓取文件。
- 功能和测试 entrypoint 必须最终解析为文件，位于原仓库的已跟踪提交，或测试总目录内的包外层 wrapper。不能把任意包外层 programs 文件误当成已绑定源码。
- 交付 `SKILL.md` 须为 UTF-8、有合法 YAML name/description 及非空正文，最大256 KiB；短 name 使用小写字母数字和单连字符。它可引用包内文件，但要足以操作实际功能。manual 和 guidance 项为文件；额外前置 refs 也应逐文件列入相应 guidance，便于准确封存。不要把程序文件或整个软件目录列为指导。
- 资源目录可递归，最多100000文件。符号链接只允许相对、包内可解析目标；target 可含不越界的 `..`，链接链须无环。绝对目标、包外目标、链接仓库根或 `.git` 管理资源会拒绝。注册同时记录链接本身和实际目标闭包；推荐 wrapper 以避免平台链接权限差异。
- 所需资源须已实际随包取得；下载 URL、包外私有文件和 Git LFS 指针本身不能替代测试所需实际字节。大型模型/数据不必进 Git，可放包外层明确 resources 目录；取得条件未满足时记录 blocked。

Studio 包检查会验证真实文件、Git 和链接，并计算内容身份；不会安装软件、运行作者程序/测试、执行 Git hooks/filters、自动 fetch/pull 或修改作者历史。若文件变化导致检查不一致，保留现场并重做候选检查，不能报通过。

## 注册、快照和更新

Studio 提供 typed `tools.packages.inspect/register/update/relocate/list/read`；这些是受 sender 验证的桌面入口，不是让普通 MCP 改权限的接口。运行在 Studio 外时交付完整包及检查结果，由用户在 Studio 选择目录检查/注册；不需要把 Studio 源码复制给开发者。

| 操作 | 事实边界 |
| --- | --- |
| inspect | 只读定义与文件闭包，返回 `definition_checked`；不创建安装记录或写注册快照 |
| register | 首次注册准确包版本，保留独立、完整、内容固定的源码/材料快照；安装和测试仍 not_run |
| update | 明确 package_id、候选 package_root 和 expected_revision；核对当前 revision 后记录候选版本，保留已注册旧版本 |
| relocate | 相同包版本迁移目录，需 expected_revision；内容变化须走 update |
| list/read | 读取已登记元数据；日常读取不能为了重算哈希重新打开封存指导 |

`package_version` 为 SHA256 内容身份，覆盖准确 source commit、原始 tool.json 字节和文件/链接闭包；不是可自由填写的 semver。重定位不改变身份，但 manifest 排版、交付说明或 wrapper 字节变化也会改变身份。快照保留完整 Git 历史以固定版本，清除远程及宿主 Git 配置；不是作者后续 pull 的活动工作树。

在作者授权下，正常 `git pull` 可同步候选原仓库的代码及原位置测试。随后更新 tool.json commit，核对 wrapper、资源和交付指导，再作定义检查与受影响安装/功能测试，最后显式 update。Studio 不自动 pull，也不原地更新旧任务/环境依赖的快照。作者只需继续维护已有布局和必要最小测试；包外层材料由接入流程维护。

## 验证与生命周期

分别记录四层状态，不能互相替代：

1. `schema_checked`：纯声明检查通过。
2. `definition_checked`：真实 Git/文件闭包及快照注册检查通过，installation/tests 均 not_run。
3. 开发者接入：五项定义、实际安装和全部声明功能/流程测试在明确版本与环境范围内通过；保留逐项 failed/blocked/not_run 及原因。
4. 用户配置：用户真实资源上完成安装、对应真实测试及产物判据，由 worker 记录软件/环境/运行身份后激活自足执行 skill。

当前第4层自动能力 **仅支持固定串行 CPU `installation.check/worker` 工程 reference**：一个线程、一个进程、零 GPU；固定 `['{python}','{entrypoint}']`；无 inputs/parameters；一个 JSON 输出；测试 resources 为空；实际原始脚本字节须匹配随产品提供的 worker case。声明任意 `engine:'installation.check'`、复制 passed 字段、probe 可用或开发者测试成功均不能绕过这个限制。一般科学软件仍可交付、检查和注册，实际安装/执行适配的未实现部分应明确 blocked/not_run，不伪装配置通过。

配置后的执行 skill 应包含日常完整操作及最小结果判断，使用后端保存的自足快照。delivery/installation/configuration 的准确文件及 refs 保留但封存，不能因未选配置、激活失效或路由切换而重新读回。显式 configure/repair/update 人工操作可授予当前确切版本、资源 ID、owner/lease/revision 和期限的读取 scope；MCP/文档不能自建 grant。执行授权和项目权限另行保持。此门覆盖受控指导入口及 worker 文件路径入口，不声称防止任意终端命令读取全局文件系统。

## 可选CPU工程示例

需要一个可检查的完整交付包时，可在一个明确 **全新** 的目录生成固定 reference；不是处理开发者真实软件的必要步骤：

```text
node <SKILL_DIR>/scripts/create-cpu-reference.mjs --output <ABSOLUTE_NEW_PARENT>/cpu-worker-reference-package
node <SKILL_DIR>/scripts/check-manifest.mjs <ABSOLUTE_NEW_PARENT>/cpu-worker-reference-package/tool.json
```

生成器只使用随 skill 的 `assets/worker-smoke.py`，保留其固定原始内容，创建一个自有的全新 Git 仓库与真实提交，生成 tool.json、交付 skill、人类说明、安装交接和外层测试 wrapper。它不会执行程序、安装环境、访问网络、复用现有输出目录、提交到 Studio 仓库或伪造原作者历史。仅生成时安装/测试为 not_run。

人工检查后，可把整个包复制到另一父目录（保留 `cpu-worker-reference-package` 目录名），运行声明检查，再通过 Studio inspect 检查真实闭包；移动后仍应得到同一版本身份。若另行授权执行，包内测试说明给出 Python 命令、全新输出目录和实际 JSON/stdout 判据。工程结果只能证明短 CPU 子进程及产物链，不能证明通用安装、GPU/集群能力或任何科学结论。
