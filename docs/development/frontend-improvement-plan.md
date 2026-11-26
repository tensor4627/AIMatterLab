# 前端外观与交互改进计划

基线：`ebd0277`（0.2.10 之后 3 个提交，前端仅 `AgentTaskPage`、`ParameterFields` 有小改动）。本文承接[桌面工作台前端设计评审](frontend-design-review.md)与[以任务为中心的交互设计](../design/interaction-design.md)：方向（石墨灰与淡紫、渐进展开、“发生了什么 + 保留了什么 + 下一步”）不变，本文解决的是这些约定尚未落到设计变量与公共组件上的问题。

诊断初稿来自源码与样式静态检查。标注“需实测”的条目由 P0 的隔离 Electron 截图复核，证据见第 10 节。

## 1. 目标与边界

**目标**

- 外观一致：颜色、字号、间距、圆角、阴影、动效全部来自设计变量；深浅主题同等完整。
- 交互易用：每个阶段一个主操作；反馈分层清楚；确认、撤销、禁用原因、状态表达方式统一；键盘可完成主要路径。
- 可维护：样式分层明确，没有互相覆盖的全局补丁层；用渐进收紧的检查脚本防止回退。

**不在范围内**

- 不修改后端、worker、IPC 协议、MCP 工具和科学引擎；渲染进程继续无 Node/文件系统访问。
- 不改变项目授权、作业状态、提交与重试语义；任何替换后的确认流程都不得自动重新提交未知运行。
- 不保留旧样式类名的视觉“兼容”，但必须保留所有 `data-testid`，原生交互测试依赖它们。

## 2. 现状诊断

### 2.1 外观一致性

| 编号 | 问题 | 证据 | 后果 |
| --- | --- | --- | --- |
| A1 | 默认字号层级被压平 | [App.tsx](../../frontend/app/App.tsx#L410-L414) 默认 `fontSize=18`（`--ui-scale=18/13`）、`minimumFontSize=17`。全局写法 `max(calc(Npx*scale), var(--ui-min-font))` 使基准 9–12px 的说明、元信息、标签、按钮统一落到 17px，正文 18px | 层级只能靠颜色和粗细；说明文字与正文争夺注意力，密集面板显得拥挤 |
| A2 | 主按钮在浅色主题下未跟随主题 | [style.css](../../frontend/app/style.css#L55) `.button.primary{background:#a99ae4}`、`.send{background:#aa9ae3}` 写死；[frontend-refinement.css](../../frontend/app/frontend-refinement.css#L539) 悬停用 `--accent-hover`（浅色为 `#48347e`） | 浅色主题主按钮常态浅紫、悬停深紫，跳变明显（需实测） |
| A3 | 硬编码颜色绕过主题 | 非设计变量文件约 234 处 hex：`style.css` 75、`setup-assistant.css` 54、`custom-cv.css` 49、`pygas-composer.css` 20、`task-flow.css` 10、`shared-terminal.css` 9 等；CV 页焦点框与强调文字写死 `#b4a4ee`；53 个样式文件中只有 4 个有浅色规则 | 浅色主题下对比度不足、局部仍是深色调 |
| A4 | 圆角与间距无统一刻度 | 已有 `--radius-*`，但仍有 `0/4/5/6/7/8/10/12/14px` 等字面量；`gap` 有 2–20px 共 15 种以上取值，含 `3/5/7/9/13/17px` | 同类卡片、按钮、输入框边角和疏密不一 |
| A5 | 全局样式层层覆盖 | `style.css` 为单行压缩的约 52KB；`App.tsx` 依次引入 `ux-finish`、`project-navigation`、`workspace-shell`、`navigation`、`frontend-refinement`、`interactions` 六个全局覆盖层；如 `.navigation-rail` 在 `navigation.css` 定义后又被 `frontend-refinement.css` 改宽度与圆角；共约 21 处 `!important` | 改一处样式要追多个文件，修改结果依赖引入顺序 |
| A6 | 同类元素多套写法 | `<Notice>` 组件 19 处，手写 `className="notice"` 86 处，裸 `<p role="alert">` 35 处；`<Empty>` 3 处，手写空态 5 处；固定操作栏有 `review-execute`、`workflow-actions`、`cluster-footer` 三套 | 提示、空态、操作栏的样子与可访问性各不相同 |
| A7 | 双语写法混用 | 多数用 `t()`/`tr()`；`CustomCvLibrary`、`CustomCvNumericScope`、`ConsumerStageEditor`、`ConsumerTargetReview` 用内联 `m('中','En')`；[Dialogs.tsx](../../frontend/ui/Dialogs.tsx#L4) 状态名以中文为键 | 术语难以统一维护，英文界面易漏译 |

### 2.2 交互易用性

| 编号 | 问题 | 证据 | 后果 |
| --- | --- | --- | --- |
| B1 | 确认使用系统原生弹框 | `window.confirm` 9 处：[App.tsx:563](../../frontend/app/App.tsx#L563)、[ComputeConnectionChooser.tsx:86-88、131](../../frontend/features/compute/ComputeConnectionChooser.tsx#L86-L88)、[RunReview.tsx:75（2 处）、82](../../frontend/features/runs/RunReview.tsx#L75)、[SshConnectionPanel.tsx:509](../../frontend/features/terminal/SshConnectionPanel.tsx#L509) | 风格与主题不一致，无法说明对象与后果，危险操作不突出 |
| B2 | 反馈方式没有层级 | 全局只有错误提示（`DiagnosticNotice className="toast"`）；成功信息散落在各处 `<p role=status>` | 用户不确定操作是否完成；成功提示位置不可预期 |
| B3 | 主按钮过多 | `button primary` 共 78 处，`App.tsx` 7 处、`ProviderLogin` 6 处、`ClusterPage` 4 处 | 同屏多个强调色按钮，分散注意力 |
| B4 | 折叠区样式不一 | `<details>` 190 处，标题有的灰色有的加粗，箭头和 `cursor` 在多处各自定义 | 用户难以判断哪些是技术细节、哪些是需要处理的内容 |
| B5 | 可访问名称不足 | `<button>` 563 处，`aria-label` 263 处；`title=` 111 处只依赖原生提示 | 纯图标按钮对读屏与键盘用户不可辨认；原生提示延迟长、不可聚焦 |
| B6 | 状态只靠颜色 | `Badge` 用小圆点加文字；排队/未知颜色写死 `#cfb58a` | 色弱用户与扫视时难以区分；不符合设计文档“不只依赖红绿点” |
| B7 | 快捷键少且无处查看 | 仅命令搜索 `Ctrl+K`、发送、`Esc` | 高频操作只能用鼠标 |
| B8 | 空态、加载、失败各写各的 | `Empty` 3 处、`LoadingFeedback` 30 处、各页自行拼接失败提示 | 失败时恢复入口位置不固定 |

### 2.3 已经做得好的部分（保留）

- [Dialogs.tsx](../../frontend/ui/Dialogs.tsx) 的 `Modal` 已有焦点锁定、`Esc`、叠层判断与焦点归还，新弹框一律基于它。
- [Notice.tsx](../../frontend/ui/Notice.tsx) 已有级别、图标与 `role`，作为提示的唯一实现。
- `ComputeResourceConsole` 已有 `confirm({title,target,label})` 式的应用内确认，作为 `ConfirmDialog` 的起点。
- `apple-tokens.css` 已定义圆角、阴影、毛玻璃、焦点环与弹簧动效变量，补齐语义后推广使用。

## 3. 设计系统规范

### 3.1 文件组织

```
frontend/ui/tokens.css        设计变量（合并 apple-tokens.css 与 style.css 中 :root 主题变量）
frontend/ui/base.css          元素重置、排版、滚动条、焦点
frontend/ui/components/*.css  Button、Field、Notice、Toast、Dialog、Disclosure、ActionBar、StatusBadge、States
frontend/app/layout.css       标题栏、导航栏、侧栏、工作区、面板分隔
frontend/features/**.css      仅放该功能独有的布局，不再定义通用控件外观
```

### 3.2 颜色

保留现有 `--bg/--panel/--sidebar/--raised/--line/--text/--muted/--accent*/--green/--danger/--warn` 与 `--hairline*/--fill-*/--surface-*`，新增语义变量：

| 变量 | 用途 | 取值方式 |
| --- | --- | --- |
| `--success`、`--success-bg` | 成功、通过、就绪 | `--success` 指向 `--green`；背景 `color-mix(in srgb, var(--success) 10%, transparent)` |
| `--warn-bg`、`--danger-bg`、`--info-bg` | 提示、徽标、警示区域背景 | 同上，比例 8–10% |
| `--focus` | 焦点框颜色 | 指向 `--accent`，与 `--focus-ring` 配套 |
| `--text-subtle` | 比 `--muted` 更弱的辅助文字（时间戳、计数） | 深色 `#8f8b9c`、浅色 `#6d6979`，需满足 4.5:1 |
| `--surface-sunken` | 日志、控制台、代码背景 | 深色 `#121218`；浅色 `#f1eff5` |
| `--surface-terminal` | 终端（两种主题都保持深色，沿用现状） | `#121218` |
| `--illustration-*` | 首次设置铜晶胞等插图专用色 | 豁免主题规则，集中定义在 tokens.css |

规则：除 `tokens.css` 外不得出现 hex/rgb 字面量；`var(--x, #fallback)` 中的回退色一并删除（变量必然存在）。文字对比度 ≥ 4.5:1，图标、边框、焦点框 ≥ 3:1，两种主题都要量。

### 3.3 字号

以正文字号为基准的六级字号，全部由 `--ui-scale`（`fontSize/13`）推导，最小字号只做下限：

| 变量 | 计算 | 默认（正文 18px、下限 13px） | 用途 |
| --- | --- | --- | --- |
| `--font-caption` | `max(calc(10px*var(--ui-scale)), var(--ui-min-font))` | 13.8px | 徽标、快捷键、计数、时间 |
| `--font-meta` | `max(calc(11px*var(--ui-scale)), var(--ui-min-font))` | 15.2px | 字段说明、次要信息、表头 |
| `--font-body` | `max(calc(13px*var(--ui-scale)), var(--ui-min-font))` | 18px | 正文、按钮、输入 |
| `--font-title` | `max(calc(15px*var(--ui-scale)), var(--ui-min-font))` | 20.8px | 卡片、弹框、区块标题 |
| `--font-heading` | `calc(19px*var(--ui-scale))` | 26.3px | 页面二级标题 |
| `--font-display` | `calc(25px*var(--ui-scale))` | 34.6px | 页面主标题、统计数字 |

决定：

- 新安装的默认最小字号由 17px 改为 13px，正文默认仍为 18px，层级随之恢复；设置项范围仍为 11–18px。
- 已保存的用户设置一律不迁移、不改写。设置页“最小字号”旁显示一行说明（“下限越高，标题与说明的字号差越小”），并提供“使用推荐值”按钮与实时预览。
- 迁移现有写法时按基准像素映射：≤10px → caption；11px → meta；12–13px → body；14–16px → title；17–22px → heading；≥23px → display。`em` 相对写法（`.8em` 等）只保留在行内代码、快捷键等确需相对父级的场合。
- `apple-tokens.css` 中的 `--ui-caption-font/--ui-meta-font/--ui-label-font` 合并到上表，旧名保留一个版本作为别名后删除。
- 聊天、编辑器、终端字号设置保持独立，不受本表影响。

### 3.4 间距、圆角、阴影、层级、动效

- 间距刻度：`--space-1..8` = 2、4、8、12、16、20、24、32px。`gap`、`padding`、`margin` 只取刻度值；`3/5/7/9/13/17px` 等就近归并。
- 圆角三档为主：控件 `--radius-xs`（7px）、卡片与提示 `--radius-md`（12px）、浮层与弹框 `--radius-lg`（16px）；另有 `--radius-pill` 与 `0`、`50%`。删除 `4/5/6/8/10/14px` 字面量。
- 阴影：平面元素不加阴影；悬浮卡片 `--shadow-xs`；下拉、提示 `--shadow-sm`；弹框 `--shadow-lg`。
- 层级沿用 `--z-popover/--z-modal/--z-version-notice/--z-toast/--z-tooltip`，不再新增数字 `z-index`（局部 1–10 的堆叠除外）。
- 动效：只用 `--motion-snappy-dur`（悬停、按下、展开箭头）、`--motion-smooth-dur`（下拉、提示、折叠内容）、`--motion-gentle-dur`（弹框、短暂提示进出）。导航框架、流式输出、拖动分隔条不加动画；`prefers-reduced-motion` 下保留透明度变化、去掉位移与缩放。

## 4. 公共组件规范

所有组件放在 `frontend/ui/`，样式在 `frontend/ui/components/`。迁移时保留调用处的 `data-testid`（通过 props 透传）。

### 4.1 Button

- 变体：`primary`（每个阶段至多一个）、`secondary`（默认，即现在的 `.button`）、`ghost`（工具栏、次要入口）、`danger`（不可逆操作）、`icon`（纯图标，必须有 `aria-label`，配 `Tooltip`）。
- 尺寸：`sm`（最小高度 28px）、`md`（34px）。纯图标按钮命中区不小于 28×28px（现有标签页关闭按钮为 24px，需放大）。
- 加载态：保持按钮宽度，显示转圈与原文字，设置 `aria-busy`。
- 禁用态：除外观变灰外，必须能读到原因——优先在按钮旁显示一行说明；空间不足时用 `aria-disabled` 加可聚焦的 `Tooltip`，不用原生 `disabled` 吞掉焦点。
- 颜色全部来自 `--accent-fill/--on-accent/--accent-hover/--danger`。

### 4.2 ConfirmDialog 与 useConfirm

- 在应用根部挂一个 `ConfirmProvider`，提供 `const confirm = useConfirm()`；调用 `await confirm({title, target, consequence, confirmLabel, cancelLabel, tone})` 返回 `true/false`。基于 `Modal` 实现，先阅读并泛化 `ComputeResourceConsole` 现有的 `confirm(...)`。
- 内容固定三段：操作对象（`target`）、后果（`consequence`，写明会丢失或会影响什么）、按钮。按钮文案用动词，如“放弃修改”“释放通道”，不用“确定”。
- `tone:'danger'` 时确认按钮用 `danger` 变体，默认焦点放在取消上；`Esc`、点遮罩都等于取消。
- 原同步调用（如 `App.tsx` 的 `confirmReplace` 返回布尔值）改为异步后，所有调用方要 `await`，并在等待期间防止重复触发。

### 4.3 何时确认、何时撤销

| 情形 | 处理 |
| --- | --- |
| 仅影响本机界面状态、可恢复（丢弃本地草稿、清理其他审阅草稿、关闭含已自动保存草稿的标签） | 直接执行，弹出带“撤销”的短暂提示，8 秒内可恢复 |
| 丢失无法恢复的本地编辑（编辑器未保存内容、修改来源路径会丢弃已编辑文件） | ConfirmDialog，默认 `default` 语气 |
| 有外部副作用或不可逆（删除会话、释放通道、断开会话、覆盖远端文件、提交作业） | ConfirmDialog，`danger` 语气，写明对象与后果 |
| 结果未知的提交 | 不提供“重试提交”按钮；只提供“核对原记录” |

### 4.4 反馈分层

1. **字段内**：校验错误、格式提示，紧贴字段，`aria-describedby` 关联。
2. **区块 Notice**：影响当前区块的问题或说明，使用 `<Notice severity>`，可带一个恢复操作。
3. **短暂提示 Toast**：操作结果（成功、已撤销、已复制）。位置在右下角状态栏上方，最多叠 3 条；成功 5 秒后消失，悬停或聚焦时暂停；错误不自动消失；`role=status`/`alert`。现有 `DiagnosticNotice` 错误提示改为 Toast 的错误变体，诊断详情仍可展开。
4. **阻断对话框**：只用于 4.3 表中需要确认的情形。

### 4.5 Notice、States

- 手写的 `className="notice"` 与裸 `<p role="alert">`/`<p role="status">` 全部改为 `<Notice>`；单纯的字段错误改为 Field 的错误槽。
- `EmptyState`（标题、一句说明、至多一个操作）、`LoadingState`（包装 `LoadingFeedback`，显示阶段与耗时）、`ErrorState`（发生了什么、保留了什么、下一步按钮，技术详情折叠）。`Empty` 改名为 `EmptyState`，旧名保留一个版本。

### 4.6 Field

- 结构：标签（必填标记）→ 控件（可带单位后缀）→ 说明 → 默认值来源标记 → 错误。复用 `ParameterFields` 内部的标签与说明逻辑，使普通表单与参数表单外观一致。
- 说明默认一行；超出时折叠为“更多说明”，不使用问号图标堆叠。

### 4.7 Disclosure

- 包装 `details/summary`，统一箭头（旋转动画用 snappy 时长）与两种标题样式：`section`（加粗，用于需要阅读的内容分组）、`detail`（`--text-subtle`，用于哈希、原始 JSON、协议细节）。
- `forceOpen`：内含缺项、越界或阻塞问题时自动展开，并可被“定位”按钮滚动到视图中。
- 保留原生键盘行为，不自造展开逻辑。

### 4.8 ActionBar

- 统一 `review-execute`、`workflow-actions`、`cluster-footer`：吸附在滚动容器底部，左侧状态文字，右侧操作，一个主按钮。
- 窄栏与大字号下自动换行；为内容区预留底部空间，不遮挡最后一行操作或文件下载。

### 4.9 StatusBadge

- 每种状态固定“图标 + 文字 + 颜色”，图标来自 lucide：

| 状态 | 图标 | 颜色 |
| --- | --- | --- |
| draft 草稿 | `PencilLine` | `--muted` |
| validating 验证中 | `ShieldEllipsis` | `--accent` |
| ready 就绪 | `CircleDot` | `--accent` |
| queued 排队中 | `Clock` | `--warn` |
| running 运行中 | `LoaderCircle`（减少动效时静止） | `--accent` |
| succeeded 已完成 / passed 通过 | `CircleCheck` | `--success` |
| failed 失败 | `CircleX` | `--danger` |
| blocked 环境阻塞 | `Ban` | `--danger` |
| cancelled 已取消 | `CircleMinus` | `--muted` |
| unknown 状态未知 | `CircleHelp` | `--warn` |
| not_run 未验证 | `CircleDashed` | `--muted` |

- 状态名改为以英文状态值为键的翻译条目，删除写死的中文映射。

### 4.10 Tooltip

- 纯图标按钮、截断文字用现有 `Tooltip`；`title=` 只作为截断文字的补充，不再用于按钮。
- 路径、回执、安全后果不得只放在悬停提示里（沿用设计评审要求）。

## 5. 交互规范

- **主操作**：每个阶段一个 `primary`（发送需求、复核当前参数、执行、保存设置）；返回、详情、刷新用 `secondary` 或 `ghost`。审查 `App.tsx`、`ProviderLogin`、`ClusterPage`、`ToolPackagesPanel`、`ResourceToolSetup`、`Agent` 中同屏多个主按钮的情况。
- **禁用原因可见**：遵循弱校验原则，按钮禁用时说明缺什么；仅提示性的问题不禁用按钮，而以 Notice 警告呈现。
- **快捷键**（实施前先核对 `desktop` 主进程菜单加速键，避免冲突）：

| 快捷键 | 动作 |
| --- | --- |
| `Ctrl+K` | 命令搜索（现有） |
| `Ctrl+N` | 新对话 |
| `Ctrl+B` | 显示/隐藏会话侧栏 |
| `Ctrl+J` | 显示/隐藏底部任务与终端面板 |
| `Ctrl+,` | 打开设置 |
| `Ctrl+/` | 快捷键一览 |
| `Esc` | 关闭最上层浮层（现有） |

  焦点在终端（xterm）、代码编辑器（Monaco）或输入框中时，除 `Ctrl+K` 与 `Esc` 外不拦截按键；首次设置层显示时沿用现有屏蔽逻辑。快捷键显示在对应按钮的 Tooltip 与命令搜索结果中。
- **焦点**：所有可交互元素有可见焦点框（`--focus-ring`）；弹框关闭后焦点回到触发元素；页面切换后焦点落到页面标题。
- **窄窗与大字号**：1024px 宽度下保留工作区与对话的显式切换；最后一行操作可点击、不被 ActionBar 或 Toast 遮挡。

## 6. 样式架构

- 在 `style.css` 顶部声明层顺序：`@layer tokens, base, components, layout, features, legacy;`。
- **迁移起点**：先把现有 `style.css` 主体与六个覆盖层整体放入 `legacy` 层（`@import url(...) layer(legacy)` 或包裹 `@layer legacy {}`），并确认界面无变化。注意：未分层的样式优先级高于任何层，所以功能样式文件也要同时包进 `@layer features {}`，否则会压过新组件。
- 之后按组件把规则从 `legacy` 移入 `components/layout/features`。`legacy` 在最后，仍匹配同一元素的旧规则会继续生效，这一点是有意的：迁移某个组件时必须同步删除 `legacy` 中的对应规则。
- `!important` 在层中会反转优先级，迁移时逐个删除；最终只保留 `.hidden` 与减少动效规则。
- `style.css` 先做一次只改格式的展开（单独提交），再做内容迁移，便于审阅。
- 迁移完成后删除 `ux-finish.css`、`navigation.css`、`workspace-shell.css`、`project-navigation.css`、`frontend-refinement.css`、`interactions.css`，内容分别并入 `layout.css` 与对应组件；`ProjectAuthorizationForm.tsx` 对 `project-navigation.css` 的引用一并改掉。

### 6.1 渐进收紧检查

新增 `scripts/check-frontend-style.mjs` 与已跟踪的基线文件 `scripts/frontend-style-baseline.json`，接入现有前端测试命令：

| 指标 | 当前 | 最终目标 |
| --- | --- | --- |
| tokens.css 以外的 hex/rgb 字面量 | 约 234 | 0（插图变量除外） |
| `!important` | 约 21 | ≤ 3 |
| `window.confirm/alert/prompt` | 9 | 0 |
| 手写 `className="notice"` | 86 | 0 |
| 裸 `<p role="alert">` | 35 | 0 |
| 无 `aria-label` 的 `icon-button` | 待测 | 0 |
| 按钮上的 `title=` | 待测（全部 `title=` 111） | 0 |
| 字面量 `font-size: Npx` | 待测 | 0（终端、编辑器设置除外） |
| 字面量 `border-radius`（除 0、50%） | 约 120 | 0 |
| 全局覆盖层文件 | 6 | 0 |

规则：指标高于基线时失败，低于基线时提示更新基线；不因存量问题阻断开发（符合弱校验原则）。

## 7. 分阶段实施

建议版本号仅供参考，可按实际节奏合并。

### P0 主题与可读性（建议 0.2.11）

1. 用隔离 Electron 窗口截取基线图：深/浅主题 × 1024×768、1366×768，覆盖第 8 节列出的界面，存入忽略的运行时目录；据此确认 A2 等“需实测”条目。
2. 建立 `tokens.css`，补齐 3.2 节语义变量；把 `style.css` 中主按钮、发送按钮、徽标、审批框、队列提示等写死颜色改为变量。
3. 清理 `custom-cv.css`、`setup-assistant.css`、`pygas-composer.css`、`task-flow.css`、`shared-terminal.css` 的硬编码颜色；铜晶胞等插图色迁入 `--illustration-*`。
4. 落地 3.3 节字号变量；新安装默认最小字号改为 13px；设置页增加说明、推荐值按钮与预览。
5. 实现 `ConfirmProvider/useConfirm`，替换附录 A 的 9 处 `window.confirm`；按 4.3 节把可恢复的草稿丢弃改为撤销提示（Toast 若尚未完成，可先用 ConfirmDialog，P1 再改）。
6. 验收：两种主题对比度达标；浅色主题主按钮常态、悬停、按下颜色连贯；默认设置下 caption、meta、body、title 四级字号可区分；所有确认弹框可用键盘完成。

### P1 公共组件与可访问性（建议 0.2.12）

1. 按第 4 节实现 Button 变体、Toast（含撤销）、Field、Disclosure、ActionBar、StatusBadge、EmptyState/LoadingState/ErrorState。
2. 按功能区逐批迁移，每批独立提交：会话与对话 → 设置、账号与首次设置 → 算力、SSH、集群与终端 → 流程、PyGAS 与自定义 CV → 作业、资产与诊断。
3. 每批同时完成：手写 notice 与裸 `role="alert"` 改为 `Notice`；同屏多主按钮降级；纯图标按钮补 `aria-label` 与 `Tooltip`；按钮去掉 `title=`。
4. 接入 6.1 节检查脚本并记录首个基线。
5. 验收：每批功能区截图与基线对比；纯键盘完成该区主要路径；读屏可读出图标按钮名称与状态徽标文字。

### P2 样式架构（建议 0.2.13）

1. 只改格式展开 `style.css`（单独提交）。
2. 按第 6 节引入 `@layer`，先整体放入 `legacy` 并确认截图无变化。
3. 把通用控件、布局规则迁出 `legacy`，删除六个覆盖层与多余 `!important`。
4. 圆角、间距、阴影、`z-index` 替换为刻度变量。
5. 验收：检查脚本各指标达到第 6.1 节目标或有书面理由；截图与 P1 结束时一致或仅有预期差异。

### P3 交互细节与文案（建议 0.2.14）

1. 实现第 5 节快捷键与快捷键一览，并在 Tooltip、命令搜索中显示。
2. 下拉、提示、折叠、弹框、Toast 套用动效变量；核对减少动效模式。
3. 统一翻译入口：`m('中','En')` 改为 `t()` 条目；状态名改为状态值为键；中英文术语对照检查。
4. 页面切换焦点、滚动位置恢复、窄窗切换的细节打磨。
5. 验收：快捷键在终端、编辑器、输入框聚焦时不误触；英文界面无漏译；减少动效下信息与操作完整。

## 8. 验收与回归

按 AGENTS 回归规则，本计划全部属于前端改动：

- 运行受影响组件的 Node 测试与原生交互测试；新增组件补组件级测试（ConfirmDialog 的焦点、`Esc`、返回值；Toast 的暂停与撤销；StatusBadge 的图标与文字）。
- 不重跑后端、worker 生命周期或科学算例；若某一步意外触及共享契约，再补测对应后端接口。
- 原生交互检查矩阵：深/浅主题 × 1024×768、1366×768 × 最小字号 11px、17px × 正常/减少动效，以及纯键盘路径。
- 覆盖界面：标题栏与导航、会话侧栏、对话与输入区（含审批、提问）、首页、设置（外观、账号、更新）、首次设置、算力选择与 SSH、共享终端、集群队列与文件、工具与技能、流程图与参数编辑、PyGAS 组合器、自定义 CV、作业列表与运行详情、资产与结构查看、各类弹框与提示。
- 截图与运行回执放在忽略的运行时目录，不提交。
- 每个版本在 `CHANGELOG.md` 为每项用户可见变化写一条简短条目；在 `docs/releases/` 的版本文档记录检查范围及 passed/failed/blocked/not_run。原生按钮全量审计与独立工作流使用统计不与本计划混记。

## 9. 风险与注意事项

- **测试依赖**：迁移组件时保留所有 `data-testid` 与可访问名称，避免原生交互测试失效；改按钮文案时同步更新以文案定位的测试。
- **异步确认**：`window.confirm` 是同步的，改为 `await confirm()` 后，调用方在等待期间状态可能变化（如连接已关闭、草稿已保存），确认后要重新检查前置条件再执行。
- **层叠陷阱**：未分层样式优先于所有层；`!important` 在层中优先级反转。按第 6 节的顺序迁移。
- **第三方样式**：xterm、Monaco 的主题通过各自 API 设置，不靠 CSS 变量自动跟随，需在 `terminal-appearance.ts` 与 `code-editor.tsx` 中读取新变量。
- **`appearance: base-select`** 仅新内核支持，`@supports` 回退必须保持可用。
- **已保存设置**：不改写用户已保存的字号；只改新安装默认值与设置页说明。
- **大步提交**：每个功能区、每类机械替换单独提交，便于回退与审阅。

## 10. 本地实施与验证

本轮在 `codex/frontend-improvement` 开发分支合并实施 P0–P3，版本建议留待发布时决定。样式格式化单独提交，使用样式语法树核对等价性。功能变更和对应回归用例集中在实现提交。基线截图从 `ebd0277` 的隔离副本采集，覆盖 1024×768 和 1366×768 下的深浅主题。截图确认了浅色主按钮常态与悬停之间的色差。

原生验收使用隔离 Electron 和模拟 IPC，覆盖主题、最小字号、减少动效、键盘操作、确认与撤销。渲染进程的 sandbox、context isolation 和 Node integration 状态由每个原生用例核对。正式发布时将验收范围纳入对应的版本文档。

| 证据 | 运行目录 |
| --- | --- |
| 原生用例汇总与复测来源 | `.studio/frontend-improvement-20261126/native-summary.json` |
| 改造前的界面截图 | `.studio/frontend-improvement-20261126/baseline-ebd0277/.studio/native-baseline/` |
| 深浅主题、窗口宽度、字号和动效截图及按钮对比度 | `.studio/frontend-improvement-20261126/native-final/` |
| 带画面去重检查的关键页面原生截图 | `.studio/frontend-improvement-20261126/native-frame-verified/` |
| 编辑器、终端、工作台快捷键与焦点 | `.studio/frontend-improvement-20261126/native-keyboard-recheck/` |
| 窄栏结构预览及主题切换后的图表 | `.studio/frontend-improvement-20261126/native-structure-recheck/` |
| 确认、撤销、手动提交与取消、连接面板 | `validation/local/frontend-confirm-final-native/`、`validation/local/frontend-confirm-resource-native-recheck/`、`validation/local/frontend-checked-cancellation-native/` |
| 流程草稿撤销 | `.studio/frontend-workflow-undo-native/` |
| 生产构建的样式层、导航尺寸和主题对比度 | `review-artifacts/frontend-style/` |

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 前端 Node、TypeScript、Vite 生产构建、文档链接 | passed | 前端 Node 共 1,207 项。保留受改动的 89 个 TSX 文件中原有的 570 个字面量 `data-testid`。 |
| 隔离 Electron | passed | 汇总 86 个不同用例，含 20 组主题、窗口、字号和动效组合。复测前的 6 项失败及其来源保留在汇总回执。 |
| 样式检查 | passed | `!important` 为 2，其余指标为 0。对比度审计测量两套主题的 176 个配色样本。 |
| 历史独立日志计时用例 | failed | 3 项在 `ebd0277` 和本轮源码均超时。主回归脚本中的日志保留和终端布局用例通过。 |
| 实机屏幕阅读器、真实模型、真实 SSH、worker 和科学算例 | not_run | 原生交互使用模拟服务。 |

### B2 B3 B4 B5 B8 补齐与验收

补齐工作从 `65b3700` 开始。短暂的成功提示以当前操作的实际回执为准。弹窗打开时，通知放在弹窗底部，可用键盘聚焦，也会为操作区预留空间。历史记录、权限范围和状态观测继续在对应区块显示。

| 项目 | 验收范围 |
| --- | --- |
| B2 反馈分层 | 设置和资源保存成功后才提示。悬停和聚焦时暂停五秒计时，错误通知保留。草稿和科学环境 JSON 的语法错误关联输入字段，提交无效 JSON 时无写入请求。资产登记、终端操作等同时核对了过期响应。 |
| B3 主操作 | 原生计算草稿从应用 JSON 切换到创建快照。集群探测和保存、账号授权和退出、资源工具配置和确认分别按阶段检查主按钮。受限操作提供可聚焦的原因。 |
| B4 折叠区 | 业务 JSX 统一使用 Disclosure。会话分组实测 Enter 和 Space，布局菜单实测 Esc 返回摘要焦点。另测流程缺项定位、集群和终端折叠区、错误技术详情。 |
| B5 纯图标操作 | 检查可访问名称、Tooltip 和命中区。原生用例覆盖会话侧栏、SSH 终端和 PyGAS 组合器，使用可访问性树、键盘和命中区尺寸进行验证。 |
| B8 界面状态 | 运行记录、运行产物、资产、科学资源、账号、连接、工具和流程区分空态、加载和失败。代表路径验证了错误后保留输入或上次记录、展开技术详情和显式重试。 |

全量前端 Node 用例通过 1,208 项。运行观察的定向用例通过 10 项。对照 69 个修改过的 TSX 文件，保留了原有 538 个字面量 `data-testid`。样式检查中，业务 JSX 的原生折叠标签、裸段落提示、缺名称的图标按钮和按钮原生标题均为 0。TypeScript、Vite 生产构建及文档链接检查通过。

隔离 Electron 的 76 个不同用例已通过，其中外观检查通过 16 组，覆盖深浅主题、1024×768 和 1366×768 渲染区域、11 和 17 px 最小字号、正常和减少动效。逐例结果、重测来源和截图存于 `.studio/frontend-completion-20261126/`，汇总见该目录的 `native-summary.json`。

历史会话分页、搜索、分支和归档的 Chromium 用例在当前实现和 `65b3700` 均触发一次额外的 DeepSeek 重连，结果为 failed。基线回执存于 `validation/local/history-baseline-65b3700/`。

屏幕阅读器实际播报、原生按钮全量审计、真实模型与 Materials Project、真实 SSH 与集群、worker 生命周期和科学算例均未运行。此次外观矩阵验证代表界面，业务操作按受改动路径定向验证。

## 附录 A：`window.confirm` 清单

| 位置 | 用途 | 建议处理 |
| --- | --- | --- |
| `frontend/app/App.tsx:563` `confirmReplace` | 编辑器有未保存修改时替换内容 | ConfirmDialog（default），调用方改为 `await` |
| `frontend/features/compute/ComputeConnectionChooser.tsx:86` `back` | 放弃连接的未保存修改 | ConfirmDialog（default） |
| 同文件 `:87` `close` | 同上 | 同上 |
| 同文件 `:88` `openService` | 同上 | 同上 |
| 同文件 `:131` “请 Agent 协助配置” | 同上 | 同上 |
| `frontend/features/runs/RunReview.tsx:75` 丢弃本地草稿 | 恢复当前运行记录 | 直接执行 + 撤销提示 |
| 同文件 `:75` 清理其他本地审阅草稿 | 丢弃其他运行的本地编辑 | 直接执行 + 撤销提示 |
| 同文件 `:82` 修改来源路径 | 丢弃该文件已编辑内容 | ConfirmDialog（default） |
| `frontend/features/terminal/SshConnectionPanel.tsx:509` | 实施时核对具体用途 | 按 4.3 节分类 |

## 附录 B：硬编码颜色重点文件

| 文件 | hex 数 | 说明 |
| --- | --- | --- |
| `frontend/app/style.css` | 75 | 含主题变量定义（迁入 tokens.css）与主按钮、发送、徽标、审批、控制台等写死色 |
| `frontend/features/onboarding/setup-assistant.css` | 54 | 区分插图色（迁入 `--illustration-*`）与界面色 |
| `frontend/features/custom-cv/custom-cv.css` | 49 | 大量 `var(--x,#fallback)` 回退色与写死的 `#b4a4ee`、`#ee9697` |
| `frontend/features/pygas/pygas-composer.css` | 20 | 节点与端口颜色，需深浅主题两套 |
| `frontend/features/workflows/task-flow.css` | 10 | 流程状态色，改用语义变量 |
| `frontend/features/terminal/shared-terminal.css` | 9 | 终端外框色，改用 `--surface-terminal` |
