# 发布 Windows 工作区增量更新

项目在 GitHub 开发和发布，`origin` 指向 GitHub。维护者把提交、版本标签和签名 Release 附件发布到 GitHub。南大 GitLab 的镜像由仓库所有者配置和维护。

## 准备签名附件

1. 确定正式版本号 `X.Y.Z`，对齐 `package.json` 的 `version`、`build.directories.output` 和 `installation/manifest.json` 的 `version`、`release_revision`、`source_ref`。同步安装说明中的版本和标签，更新 `CHANGELOG.md` 和对应的 `docs/releases/` 版本记录。修订已发布的安装包时使用新的版本号。
2. 在持有项目签名私钥的 Windows 发布机上，从仓库根目录运行 `pnpm run pack`。打包命令把成品写入 `release/vX.Y.Z/`。按下表取出更新附件并保留原名。清单登记了 `appPayload` 时一并分发应用载荷。[打包配置](../../package.json) · [签名清单生成脚本](../../scripts/package-companions.mjs)

| 附件 | 客户端用途 |
| --- | --- |
| `AIMatterLab-X.Y.Z-win-x64-setup.exe` | 提供新版程序的字节，也可用于手动安装。 |
| `AIMatterLab-X.Y.Z-win-x64-setup.exe.blockmap` | 记录安装包中各块的大小和校验值，供不同版本比较。 |
| `AIMatterLab-X.Y.Z-win-x64-app.gz` | 兼容的 Windows 工作区可以直接更新应用及随包资源。 |
| `latest.yml` | 签名清单。安装器和块索引沿用原签名。另一份签名绑定 `runtimeAbiVersion` 和应用载荷的名称、大小及 SHA-512。 |

单独上传 `.exe` 可供用户手动安装。应用内“检查更新”还需要签名清单。保留当次构建的 `SHA256SUMS.txt`，用于核对 GitHub 附件。

## 核对内置指导

这项回归适用于每个版本标签，包括开发版和内测版。准备标签的维护者在本版 `docs/releases/` 记录中填写以下三项结果。

1. **核对当前操作。** 沿每份内置 SKILL.md 及其引用，检查科学功能目录、系统提示和逐轮提示。涉及按钮时从当前窗口入口走到对应操作，写明何时出现。涉及工具时对照实际名称、参数、返回字段和授权范围。检查普通聊天、已有工作流与显式共享终端各自的入口，也检查恢复旧对话后的新提示。源码版本有变的科学参考需核对相应解析器或声明，记录适用版本。把有变化的指引和已复核可继续使用的指引分别记入版本记录。
2. **运行源码回归。** 在准备打标签的源码上运行下面的命令。`python3` 表示 Python 3 解释器，Windows 上也可使用 `py -3`。检查覆盖契约副本、开发者分发 ZIP、文档链接、引擎与技能路由、代表性界面控件、产品源码引用摘要及内置文档实际读回。主仓库在版本标签、Pull Request 和默认分支推送时运行源码检查。外部工具及个人技能按实际登记和共享范围处理。[GitHub Actions 配置](../../.github/workflows/check-source.yml)

   ```powershell
   node scripts/sync-tool-contracts.mjs --check
   python3 scripts/package-developer-kit.py --check
   node scripts/check-doc-links.mjs
   node scripts/check-bundled-guidance.mjs --source
   node --test tests/agent/scientific-context.test.mjs tests/agent/scientific-skill-router.test.mjs tests/agent/skill-context.test.mjs tests/agent/harness-guidance.test.mjs tests/contracts/engine-enum-consistency.test.mjs
   ```

3. **复核待发布成品。** Windows 打包的 `afterPack` 会运行以下检查。再对本版安装器和便携 ZIP 分别隔离提取，在每份包含 `resources/` 的应用目录运行同一命令。若按需提取，须包含 `app.asar`、`app.asar.unpacked/worker/`、`studio-skills/`、`studio-dsh/dsh-policy.mjs` 以及 `studio-tools/localize-skill.mjs`，并保留它们在 `resources/` 下的相对位置。保留版本、程序资源和技能文件摘要、路由数、覆盖文档数。检查从该包 ASAR 提取并加载实际读取模块，核对外置技能目录、DeepSeek 策略和本地化脚本。混合路由先验证未共享时的结果，再用隔离的上游公开技能样本验证内置正文和引用。若要验证实际第三方技能内容，另用明确登记的源码核对，并记录范围。

   ```powershell
   node scripts/check-bundled-guidance.mjs <成品展开目录>
   ```

   将成品里的运行提示、技能正文和映射模块同本次提交的 Git blob 原始字节逐项核对。打标签前可用 `git ls-files --stage` 确认暂存对象，再用 `git cat-file --batch` 读取。Windows 工作树里的混合换行可能被 Git 自动规范化，两边的文件名和文字一致时，模型回执中的 SHA-256 仍可能不同。

源码或成品检查失败时先修正并重跑。版本文档分别记载 `passed / failed / blocked / not_run` 及实际范围，核对通过后再创建或推送标签。部署兼容标识、旧聊天正文及个人库有自己的生命周期。审核新产品称呼时保留现有路由 ID、资源路径和旧记录的读取兼容性。

## 推送到 GitHub

1. 完成「核对内置指导」中的三项核对。将已验收的构建提交推送到 GitHub，在该提交上创建 `vX.Y.Z` 标签并推送到 `origin`，核对远端标签解引用后的提交。下面以 `v0.1.22` 为例。

   ```powershell
   git -c push.followTags=false push origin refs/tags/v0.1.22
   ```

2. 在 **GitHub** 为该标签创建草稿 Release，上传上表所需附件，再发布为最新正式版。公开清单位于仓库的 `releases/latest/download/latest.yml`，私有附件通过 Release Assets API 读取。

0.2.1 源码中的桌面更新器优先采用 GitHub 的有效签名清单。GitHub 清单不可用时查询南大，清单签名无效时停止并报错。已分发的旧客户端仍按其原有顺序查找更新。[发布源实现](../../desktop/platform/update-feeds.mjs) · [更新器实现](../../desktop/platform/workspace-updater.mjs)

## 跳过一个内测版本

假设上一次正式发布的是 **0.1.20**，**0.1.21** 仅供内测，下一次可以直接发布 **0.1.22** 的三个附件。更新器比较用户当前版本和目标版本，直接组装目标安装包。

| 用户当前的工作区 | 点击“更新”后的结果 |
| --- | --- |
| 0.1.20 正式版，本地有可复用的安装包数据，0.1.20 和 0.1.22 的块索引可读，安装包下载地址支持 Range | 直接从 0.1.20 增量升到 0.1.22，跳过 0.1.21。 |
| 0.1.21 内测版，两站均未提供该内测构建的块索引 | 自动下载 0.1.22 完整安装包，校验后照常安装。若能按 0.1.21 标签读到匹配的块索引，且本地保有对应安装包，也可走增量。 |

保留仍需支持增量升级的旧版本 `.exe.blockmap`，使其可从原标签下载。若事后补发内测版索引，核对两站的最新清单仍指向 0.1.22。客户端复用工作区 `user-cache/updates/installer.exe` 中相同的块，通过 HTTP Range 获取变化的字节。缓存缺失、索引不可用、服务器未返回请求的字节范围或重组校验失败时，一键更新会改取完整包。下载后的安装器与签名清单中的 SHA-512 核对，通过的文件在同一进程中按文件身份复用校验。安装成功后缓存新版作为下次更新的基准。

## 应用更新包

已安装工作区和目标发行版具有相同的 `runtimeAbiVersion` 时，更新器优先选择经过签名的 `appPayload`。Electron 壳、原生运行时和安装器结构变化时会使用签名安装包。应用更新成功后，差分仍按最近一次 NSIS 安装版本查找基准包和块索引。应用更新交接要在退出旧进程前确认文件和权限。新版工作台未能启动时，更新辅助进程恢复应用文件，下一次检查继续使用安装包。[应用更新实现](../../desktop/platform/layered-update.mjs)

## 发布后验收

1. 从 GitHub 读回最新 `latest.yml`，核对签名和目标版本，再把清单所需更新附件的 SHA-256 与发布机的 `SHA256SUMS.txt` 比对。私有发行页可在更新面板配置该仓库的 Contents 只读权限。[GitHub 发行附件](https://docs.github.com/en/rest/releases/assets)
2. 通过 GitHub 版本附件入口向安装包发送 `Range: bytes=0-0`。跟随下载重定向后应返回 `206 Partial Content`、`Content-Range: bytes 0-0/<安装包总字节数>` 和 1 字节正文。再确认支持的旧版块索引也能按原标签下载。
3. 在保有旧安装包缓存的独立 Windows 工作区点击“检查更新”，核对目标版本和预计增量下载量，点击“更新”并在重启后核对实际版本。将发布源、起止版本、下载方式和结果记入该版的发布文档，标明使用线上发行源还是本机测试端点。[0.1.16 验证记录示例](../releases/aimatterlab-0.1.16.md)
4. 提供应用更新载荷时，在相同 ABI 的工作区核对应用更新成功与失败回滚，再在不同 ABI 的工作区核对安装器选择。保留用户文件、程序文件及差分基准的验证结果。
