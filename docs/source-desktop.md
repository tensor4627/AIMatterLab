# 从 Git 源码日常启动

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
