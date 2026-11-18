# 从 Git 源码日常启动

## 首次使用 Codex

在对话面板点击“连接 Codex”。首次使用者可直接继续，再到“账号与 API”选择 ChatGPT 浏览器登录或设备码登录。尚未安装 Codex CLI 时，先安装官方 CLI，或在“设置 → Agent → 服务商高级配置”指定已有的 Codex 可执行文件。[Codex 登录说明](https://learn.chatgpt.com/docs/auth)

已有 Codex 的用户可以选择首次导入的内容。

- **代理设置**默认勾选。来源是当前用户的 `CODEX_HOME`，未指定时使用用户目录下的 `.codex`。有 `.env` 时提取 HTTP、HTTPS、ALL、NO_PROXY 及 Node、Electron 的代理开关，并给本地回环地址补上直连规则。`config.toml` 里设置的 `features.respect_system_proxy` 也可沿用。
- **整份 .env** 仅在存在可导入的文件时提供。选择后按原样复制，文件中可能含有 API 密钥。已有的 AIMatterLab `.env` 会保留。
- **默认模型和推理强度**单独选择。只读取全局 `config.toml` 的 `model` 与 `model_reasoning_effort`。登录后核对当前账号列出的模型和档位。缺少对应项时，可在对话面板选择并确认。设置用于新对话，已有对话按自己的模型恢复。临时 CLI 参数、项目配置、个人会话和登录凭据各自独立。[Codex 配置优先级](https://learn.chatgpt.com/docs/config-file/config-basic)

可以取消全部勾选。一次选择保存在当前 AIMatterLab 的独立资料目录。若本机已有可读取的 ChatGPT 文件登录态，连接时可复用该订阅。若凭据仅存系统钥匙串且独立实例读不到，可在 AIMatterLab 登录同一账号。个人会话历史保留在原来的 Codex 目录。

## 启动桌面

需要 Windows、Git、Node.js 22.19+ 和 PATH 中的 pnpm 11。源码检出放在支持硬链接的文件系统（如 NTFS），用于并发启动时互斥。使用正常桌面终端，普通非管理员账户即可。

首次：

```powershell
git clone https://github.com/tensor4627/AIMatterLab.git
cd AIMatterLab
.\Launch-AIMatterLab.cmd
```

也可在仓库中执行 `pnpm run source` 或 `node scripts/source-start.mjs`。入口显示当前源码的版本和配置路径，首次安装锁定依赖并构建，然后打开正常桌面；后续未变时直接启动，源码变化时重新构建，依赖或锁文件变化时重新安装。准备状态在 Git 忽略的 `.studio/source-entry/`，无需重新下载安装包。首次安装依赖需要联网。

后续更新：先关闭这个桌面，在同一个目录执行 `git pull`，再双击 `Launch-AIMatterLab.cmd`。入口不自动拉取、不切分支。Git 有冲突时先处理自己的修改；不要用重置命令覆盖配置或工作。

默认始终复用这个仓库根目录的 `.config/`，包括设置、连接登记、凭据和 Agent 缓存。`git pull` 不会删除它。需要沿用安装器的 profile 或固定在仓库外的目录时：

```powershell
.\Launch-AIMatterLab.cmd --profile "D:\AIMatterLab-data"
```

`STUDIO_PROFILE_DIR` 环境变量也可指定，命令行 `--profile` 优先。以后继续使用同一个路径；入口不迁移或复制旧凭据。可创建带该命令的快捷方式。

安装版在所选工作区根目录使用 `.config/`。ZIP 解压版在源码仓库内沿用仓库的 `.config/`，在仓库外使用可执行文件所在目录的 `.config/`。源码版和桌面版如需共用配置，可显式设置相同的 `STUDIO_PROFILE_DIR`。同一配置已运行时再次启动会回到原窗口。源码启动器运行期间重复点击会复用当前实例，关闭桌面后再次启动才应用源码变化。

启动失败时窗口保留错误信息；可从终端再次执行同一命令查看。依赖或构建失败不会启动旧构建冒充新版，现有 profile 保留。科学工具环境及实际作业继续由现有登记与 worker 规则管理。
