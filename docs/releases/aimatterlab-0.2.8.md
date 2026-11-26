# AIMatterLab 0.2.8

本版修复 0.2.7 审核发现的多功能便携工具包运行标识冲突、正式计算参数规则被配置值覆盖、旧版 `0.2.0`–`0.2.5` 私有计算技能升级校验失败、Git 源 Windows CRLF 与 Linux LF 跨平台校验不一致、受管安装目录未申报辅助文件篡改绕过及大体积 `tool.json` 超出 24 KiB 上限不可读问题；同时补齐 `AGENTS.md` 工具接入/配置红线与源码锚点、`studio-neb-workflow/references/neb.json`、L2 `onboarded-tool-<id>` 模板、L3 非工具包执行技能 `Source provenance` 记录、L4 项目与资源库边界、5 KiB 内置入口门禁、集群配置与软件版本路由及全量计算路由的 SSH 恢复指南引用。

## 核对内置指导

- **已变更并复核的指导**：[agent/context/AGENTS.md](../../agent/context/AGENTS.md)（4,585 B，保留动态 `project_skill_catalog({"scope":"user"}).directory` 占位符、6 模块概览、4 项源码锚点及全部 12 项运行时护栏）、[installation/workspace-guide.md](../../installation/workspace-guide.md) 与 [agent-settings.mjs](../../agent/context/agent-settings.mjs)（新增 0.2.7/0.2.8 种子哈希）、[studio-neb-workflow/SKILL.md](../../agent/builtin-skills/studio-neb-workflow/SKILL.md) 与新增 [neb.json](../../agent/builtin-skills/studio-neb-workflow/references/neb.json)、[studio-tool-onboarding/SKILL.md](../../agent/builtin-skills/studio-tool-onboarding/SKILL.md) 与新增 [local-onboarding-template.md](../../agent/builtin-skills/studio-tool-onboarding/references/local-onboarding-template.md)、[studio-workflow-roadmap/SKILL.md](../../agent/builtin-skills/studio-workflow-roadmap/SKILL.md)、[studio-compute-workflow/references/resource-tools.md](../../agent/builtin-skills/studio-compute-workflow/references/resource-tools.md)、[scientific-skill-map.json](../../agent/skills/scientific-skill-map.json)（为其余 6 条 `studio-compute-workflow` 路由补齐 `references/connection-recovery.md`）。
- **已复核继续沿用的指导**：其余内置 `SKILL.md` 及参考文件均通过 5 KiB 入口预算（最大 4,621 B）、产品称呼、全量 `.md` 源码锚点、UI 控件与 `read_scientific_skill` 读回校验。

## 验证范围

| 验收范围 | 结果 | 实测依据 |
| --- | --- | --- |
| 源码与 CI 契约 | passed | `sync-tool-contracts.mjs --check`、`package-developer-kit.py --check`（12 files）、`check-doc-links.mjs`（218 files）、`check-bundled-guidance.mjs --source`（13 个内置技能、44 条目录功能、57 份随包文档、19 项产品源码回执、6 个发行来源、`startupBytes: 4585`、`largestEntryBytes: 4621`）、`tsc --noEmit` 与 `NativeNEB` 契约单测全部通过。 |
| Node 回归 | passed | CI 源码套件 79 项全部通过；覆盖本次全部改动的 10 个核心测试文件（技能上下文、大 `tool.json` 分片、意图路由、便携工具包注册与 CRLF/LF Git blob OID、资源工具控制器、项目技能、安装清单等）共 138 项，136 项通过，2 项因本机 Windows 符号链接权限跳过。 |
| Linux worker 资源与路线图 | passed | WSL Python `tests/test_resource_tools.py`、`tests/test_roadmap_execution.py`、`tests/test_contracts_and_protocol_suite.py` 共 93 项全部通过（覆盖多功能标识隔离与冲突拒绝、必填/默认 300/整数拒绝 `1.5` 与 `bool`、Windows CRLF 摘要对 Linux LF 检出激活、修改未申报 `helper.py` 拦截及 L3 `Source provenance`）。 |
| Windows x64 签名构建与成品核对 | passed | 产出 `AIMatterLab-0.2.8-win-x64-setup.exe`（159,133,440 B，SHA-256 `b7d2717e...`，项目证书签名）、`.blockmap`（144,435 B）、签名 `latest.yml`、`AIMatterLab-0.2.8-win-x64.zip`、`AIMatterLab-0.2.8-developer-kit.zip` 与 `SHA256SUMS.txt`。对 `win-unpacked`、解包后的便携 ZIP 及解包后的 NSIS 安装器分别运行 `check-bundled-guidance.mjs`，三份成品均返回一致回执（`version: 0.2.8`，`promptSha256: 76239ef8...`，`skillInventorySha256: bdcad954...`，57 份文档、39 条路由）。 |
| 真实科学与线上模型 | not_run | 本次以隔离调度器与本地自动化测试核验软件行为；真实集群科学作业、线上模型回复与线上下载端到端增量升级另行验收。 |

## 0.2.8 发布后复核

对照版本为已发布的 `v0.2.8`（`754d640`）。下列修复在此标签之后开发。上表保留发布当时的验证范围。

| 核对项 | 结果 | 本次观察 |
| --- | --- | --- |
| 发布载荷 | passed | GitHub 发行安装器与本地文件的 SHA-256 均为 `b7d2717eeb6f8b65fcd2c00924c08dedac4d667371010d857d283080caa5223f`。比对 NSIS、便携 ZIP 和构建产物的 30,791 个程序文件。干净发行包的 13 个内置技能、57 份文档、39 条含内置技能的读取路由均返回与标签源码一致的内容。 |
| 工作区提示词升级 | passed | 0.1.12–0.1.19 的安装指南包含完整的 0.1.11 指南前缀。旧算法会将较长版本末尾的 217 个字符误作本地备注。修复后匹配最长完整指引。用 8 个历史安装器的真实文件和追加笔记样本核验，16/16 通过。 |
| 会话工具可见性 | passed | DSH 首次绑定工作流、从持久化会话恢复及切回普通聊天时，按当前 MCP 租约生成工具清单。官方 DSH 运行组件的受控协议测试验证了正确授予和撤销 `present_task`。 |
| 工作区覆盖升级 | passed | 使用正式安装器的文件管理脚本在独立目录重放 0.2.0 和 0.2.7 的登记升级，两条路径均保留了 9 项模拟用户数据。缺少旧卸载登记的 0.2.0 覆盖样本遗留 33 个 Python 模块。修复后的版本识别、WSL 安装输入、SSH 传输和差分清单只选取当前应用归档登记的 126 个 worker 文件。修复后的终端组件清单也排除了已退役的 SSH 辅助脚本。 |
| 专题指南 | passed | 提问指定本版附带资料时，使用本地工具目录与按需读取的专题参考。未共享的外部 pyGAS 指南仍保留共享检查。GPUMD NEB 双语参考及入口区分 FIRE 力容差 eV/Å 与变胞压力 GPa，依据发行目录固定的 GPUMD 提交 `bd719b98`。 |
| 本地修复安装包 | passed | 重新构建独立 NSIS 测试包。解出内层载荷逐字节核对 22 个有改动的交付文件，验证全部 57 份随包技能文档及 39 条读取路由。启动提示摘要为 `58781673…`，技能清单摘要为 `e2806996…`，安装器 SHA-256 为 `8f533438066cd628c97e350d83e6db45a8563739c3d125584788fea97aaf7f43`。测试包沿用 0.2.8 版本号，未签名，独立于已发布资产。 |
| 软件回归 | passed | 对应 15 个 Node 测试文件合并运行，339/339 通过。范围包括提示词、按需读取、DSH 两种会话状态、worker 文件清单、终端暂存和 Windows 安装升级。 |
| 计算与 Windows 系统登记 | not_run | 本轮复核使用隔离工作区、公开工具文档和只读问答。真实科学作业、真实集群部署、生产工作区原地安装和 Windows 注册表及快捷方式写入均在本轮范围外。 |

### 真实模型问答

四道自然语言题分别覆盖用户工具定义、GPUMD NEB、HotHam 与 HotPP 的区别，以及 TorchNEP、PyDyn、GPUMD 与 pyGAS 的跨工具使用。四名 GPT-6.2 Sol High 测试员以 `ultrafast` 配置出题。通过普通 Electron 聊天界面逐题提交原文，DeepSeek V4.1 Flash 使用 Max，GPT-6 Luna 使用 Medium。每个主问答都使用独立会话。

| 实测对象 | 完成回复 | 有对应专题文档与正确 SHA-256 回执 | 公网手册读取调用 |
| --- | ---: | ---: | ---: |
| 已发布的 0.2.8 安装载荷 | 8/8 | 8/8 | 13 |
| 源码修订随包查询指引后 | 8/8 | 8/8 | 0 |
| 源码补全 NEB 单位后的定向复测 | 2/2 | 2/2 | 0 |
| 包含全部修复的本地安装载荷 | 8/8 | 8/8 | 0 |

两次安装版测试均从实际 NSIS 解出程序，通过安装器的工作区初始化脚本启动隔离工作区。两款模型都保留了额外写入的用户备注。发行版的 DSH 活动配置和 Luna 的会话开发者指令都含有旧版正文尾段。最终测试包中两种记录均只包含当前基础指令和用户备注。带 33 个退役模块的安装工作区与对照组都选中 126 个 worker 文件，标识一致。

最终安装包的八次回复中，七次首次回答覆盖全部预设要点。DeepSeek 在跨工具题中给出了正确的 AOTI 加载要求，结论段对指南共享和执行可用性的区分仍有歧义。Luna 在工具登记题中两次尝试项目技能读取后找到了正确的随包模板。该指标按实际工具回执统计，回复完成与首次解释精度分别复核。

另在独立的 DeepSeek 会话中引用这句首答做专项追问。其分项解释确认，偏置采样适配器已登记实现，此对话未获外部指南正文，目标执行授权和指定 `.pt2` 的真实加载均待验证。该答复使用随包目录和实际权限回执。首答按原表现计数。

## 2026-11-26 科学场景问答复核

五名 GPT-6.2 Sol High 以 ultrafast 配置分别编写情景题。每道题要求给出科学方法、参数选择、资源估算、环境配置、输入至结果的工作流和验收标准。冻结题面后，在真实 Electron 普通聊天中逐题开启新会话。DeepSeek V4.1 Flash 选择 Max，GPT-6 Luna 选择 Medium。正式版采用发布安装器的实际载荷和工作区初始化脚本。修复后分别生成五个独立本地 NSIS 测试包。原发布安装器 SHA-256 以 b7d2717eeb6f 开头，最终测试包为 c80bb3c5aec4。生产工作区、注册表和快捷方式未参与该项验收。

| 验证项 | 状态 | 范围与实测 |
| --- | --- | --- |
| 答卷身份与读取 | passed | 84 份完成的答卷均有模型身份、推理档位、题面摘要、完成事件及可见答复。每份答卷均有匹配源码或安装载荷的技能正文回执。各轮合计核对 665 项逐答去重的文件摘要。 |
| 配置与来源 | passed | 各会话仅登记同一个干净的公开 pyGAS 提交 49bbead1。发行清单的 ba578738 与公开文档快照分别核验。pyGAS 与 PLUMED 的 24 项双提供方定向读取覆盖两种提交、两种换行、真实内容改动、未授权和未登记。末次 WT 修订另核对 24 项双提供方回执，并用固定版本的真实配置解析器验证裸值、配对单双引号产生同一路径。 |
| 指导、安装载荷与回归 | passed | 最终源码和解出的安装载荷各有 13 个内置技能、59 份文件、45 个功能目录项和 41 条随包读取路由。九个 Node 测试文件共 143 项通过。Windows 缺少符号链接创建权限，一个文件链接子情形未运行，目录 junction 检查通过。 |
| 全部答卷可直接照做 | failed | 各题最后一次适用修订的 20 份答卷中，0 份六项完整，9 份部分覆盖，11 份含影响计算、解释或验收的重大错误。 |
| 实际数值模拟和资源消耗 | not_run | 情景给定的生产用时和显存来自题设试跑。实际执行了应用内问答、工具读取与独立数值复算。没有提交 Slurm 作业、运行 MD、训练 HotHam 或产生新的材料计算结果。 |

| 测试轮次 | 独立答卷 | 六项完整 | 部分覆盖 | 重大错误 |
| --- | ---: | ---: | ---: | ---: |
| 原工作树源码与正式 0.2.8 安装载荷 | 20 | 0 | 9 | 11 |
| 第一次修复后的源码与安装载荷 | 20 | 0 | 13 | 7 |
| MD 与采样指导修复后的三题 | 12 | 0 | 8 | 4 |
| pyGAS 与 PLUMED 来源修复后的两题 | 8 | 0 | 2 | 6 |
| 同一源码与安装载荷上的全部五题 | 20 | 0 | 8 | 12 |
| WT 参考勘误后的专项复核 | 4 | 0 | 2 | 2 |

每个维度最高 2 分。完整要求六项均为 2 分。重大错误须指向原回答中会使方案、结果或核心验收失效的具体步骤。完整矩阵实测了同一源码与安装载荷的四组合。最后仅修订 WT 参考并完成 4 答专项复测，其他 16 答实际读取的文件与最后安装载荷字节一致。各轮保留首次答卷、原始盲评和按固定源码复核的裁决。另计 10 次无完整答案的请求。其中 4 次 Luna 请求通用工具 list_mcp_resources 触发隔离，6 次 DeepSeek 返回 max-tokens，其中 2 次保留有截断正文。这些尝试单独记为失败，同题新会话的完整答卷列入表中。每格只有一次独立回答，因此计数描述本次样本。


| 最终题目 | 源码 DeepSeek | 源码 Luna | 安装 DeepSeek | 安装 Luna | 已核对专题正文 |
| --- | --- | --- | --- | --- | ---: |
| MD 平衡密度 | 6/12 · 重大错误 | 10/12 · 重大错误 | 5/12 · 重大错误 | 7/12 · 重大错误 | 4/4 |
| 固定伞窗 | 6/12 · 重大错误 | 9/12 · 部分 | 6/12 · 重大错误 | 8/12 · 部分 | 4/4 |
| WTMetaD | 7/12 · 重大错误 | 6/12 · 部分 | 6/12 · 重大错误 | 7/12 · 部分 | 4/4 |
| 电子能带 | 7/12 · 部分 | 7/12 · 部分 | 6/12 · 重大错误 | 6/12 · 部分 | 4/4 |
| 电子哈密顿量 | 7/12 · 重大错误 | 7/12 · 部分 | 6/12 · 重大错误 | 8/12 · 部分 | 4/4 |

| 原题与独立核算 | 实测修订与检查 |
| --- | --- |
| GPUMD 普通 MD，4096 个 Si 原子，200 ps 按 1 fs 为 200,000 步，按题设外推 400 秒 | 核对 NPT 密度统计和固定胞 NVE 漂移。区分发行 fork 与 GPUMD v5.9.1 的轨迹关键字，补足阶段末重启文件的产生、验证和交接。 |
| 固定伞窗，12 窗各 50 ps，总计 300 GPU·min，两卡理想 150 分钟，每张活动卡约 5 GiB | 核对标记离子配位与全局平均、平滑截断、偏置力符号、窗口重叠和 WHAM/MBAR。补足同一进程重复挂载偏置与每段输出重设的区别。 |
| WTMetaD，每副本 1 ns 和 2,000 个丘，两卡理想 100 分钟，总约 3.33 GPU·h | 核对两个独立历史、力求值和沉积相位、偏置与 CV 日志、自由能重加权和结果支持区间。最终修正配对引号的解释，并明确有限截断下的可微配位函数和完整偏置力。 |
| 能带，80 个轨道和 120 个 k 点，complex128 的 H/S 合计 23.4375 MiB，给定路径求解串行 30 秒、理想四路 7.5 秒 | 核对 Hc=ESc、能量单位与对齐、S 的正定性、参考 k 路径和全区采样。确认原版脚本还逐点计算 DOS 与可选参考。 |
| HotHam 哈密顿量，600 个结构来自 12 个轨迹家族，同一批大小的试跑外推 40 轮约 120 分钟 | 原生示例以 H 为训练目标，S 随数据提供。固定数据加载器使用 batch=1。按族划分并保留独立测试集，区分更改了加载器的试跑和原版配置。 |

发现的旧来源问题涉及 pyGAS 的配位数和邻居表源码指纹。此前指纹来自带本地改动的工作树，所记提交无法重现。修订后按发行清单的 Git 文件及已核实的 Windows 换行字节比较，保留实际读取摘要。公开测试快照的六个实现文件与发行清单一致，两份使用手册有变更，聚合回执保留 reference_only。独立 PLUMED 规则所依据的两个源码文件均匹配。电子对齐复算采用非对角正定 S，正负偏移的本征值检验误差小于 5×10⁻¹⁶。第一次和第二次测试安装包的 app.asar 相同，外置技能清单摘要不同，均已通过应用内读取回执区分。

对应的指导见 [GPUMD 原生输入](../../agent/builtin-skills/studio-md-workflow/references/gpumd.json)、[固定伞窗](../../agent/builtin-skills/studio-cv-bias-planning/references/umbrella.md)、[良调元动力学](../../agent/builtin-skills/studio-cv-bias-planning/references/wtmetad.md) 与 [HotHam](../../agent/builtin-skills/studio-tool-discovery/references/hotham.md)。本地逐题答卷、读取回执、两层评分与数值复算保存在忽略目录 .studio/science-qa-20261126。

## 2026-11-26 通用资源目录与输出截断复核

上节的四次 Luna 中断与六次 DeepSeek 截断分别保留原始结果。下表记录此后的定向复核。

| 项目 | 状态 | 观察 |
| --- | --- | --- |
| Codex 目录权限 | passed | 真正的 Codex app-server 配合本地确定性服务重现了两种协议事件。带 server=gpusampling 的资源与模板列表按当前会话授权完成。省略 server 的原生资源列表事件使用服务器标识 codex，现有隔离桥会终止该连接。 |
| 源码和测试安装载荷 | passed | 修订隔离提示，明确给两个目录工具传入 gpusampling。实际 GPT-6 Luna Medium 在源码和 NSIS 安装载荷分别完成同一会话内的两轮问答，每端四次具名列举均返回空目录，随后通过 scientific_skill_catalog 定位 md.gpumd 并实际读取 studio-md-workflow。两端技能正文和提示模块字节一致。 |
| DeepSeek 调查 | passed | 此前六次失败均来自官方 DSH 的 max-tokens 终止回执。当时 Max 档请求输出预算为 32,768 token。两次保留了截断正文，四次没有可见正文。原问答记录缺少这些请求的详细 token 用量。用随包 DSH 0.2.2-rc.1 和本地合成 Messages 服务复核，在短上下文中也可以独立收到该终止原因，Harness 保留收到的前缀，等待明确的下一条消息。 |
| 协议与回归 | passed | 174 项隔离、目录协议和工具代理回归通过。另有两项回环实测，覆盖受限目录与租约撤销，以及 DSH 的请求参数和截断结束语义。 |

本次安装器是本地未发布测试包，SHA-256 为 ccdc10e00fc26b03056bfd9dec9c2d546419fbde5fe486ac618348d22977c60a。本轮的原始回执位于忽略目录 .studio/catalog-qa-20261126。
