# 发布 Windows 工作区增量更新

南大 GitLab 是主发布源，GitHub 是备用源。每个正式版本在两站分发同一次构建、验收通过的签名附件。日常开发将源码合入南大 `main`，GitLab CI 的 `mirror-main-to-github` 作业负责镜像该分支。版本标签和 Release 附件由维护者在正式发版时单独发布。[源码镜像配置](../../.gitlab-ci.yml)

## 准备签名附件

1. 确定正式版本号 `X.Y.Z`，对齐 `package.json` 的 `version`、`build.directories.output` 和 `installation/manifest.json` 的 `version`、`release_revision`、`source_ref`。同步安装说明中的版本和标签，更新 `CHANGELOG.md` 和对应的 `docs/releases/` 版本记录。修订已发布的安装包时使用新的版本号。
2. 在持有项目签名私钥的 Windows 发布机上，从仓库根目录运行 `pnpm run pack`。打包命令把成品写入 `release/vX.Y.Z/`。取命令成功结束后该目录中的三个文件，保留原名。[打包配置](../../package.json) · [签名清单生成脚本](../../scripts/package-companions.mjs)

| 附件 | 客户端用途 |
| --- | --- |
| `AIMatterLab-X.Y.Z-win-x64-setup.exe` | 提供新版程序的字节，也可用于手动安装。 |
| `AIMatterLab-X.Y.Z-win-x64-setup.exe.blockmap` | 记录安装包中各块的大小和校验值，供不同版本比较。 |
| `latest.yml` | 签名清单。客户端通过它发现新版，并取得安装包和块索引的大小及 SHA-512。 |

单独上传 `.exe` 可供用户手动安装。要让“检查更新”发现新版，发布源还需提供该版的签名清单。保留本次构建的 `SHA256SUMS.txt`，用于核对两站附件。

## 推送到两站

1. 核对成品版本、安装包签名者，以及签名清单中安装包和块索引的摘要后，在构建提交上创建 `vX.Y.Z` 标签。获得发布授权后，同步南大 `main` 并向两站推送本次标签。下面以 `v0.1.22` 为例。完成后核对源码镜像结果，并确认两站标签都指向构建提交。

   ```powershell
   git -c push.followTags=false push nju refs/tags/v0.1.22
   git -c push.followTags=false push origin refs/tags/v0.1.22
   ```

2. 在**南大 GitLab** 上传三个文件，例如存入项目的 Generic Package Registry。为 `vX.Y.Z` 创建正式 Release，一次挂上三个资产链接，每个链接的 `direct_asset_path` 都设为 `/<原文件名>`。客户端从项目 API 的 `releases/permalink/latest/downloads/latest.yml` 取清单，从 `releases/vX.Y.Z/downloads/<原文件名>` 取附件。GitLab 默认按 `released_at` 选择最新 Release。[GitLab Release API](https://docs.gitlab.com/api/releases/)
3. 在 **GitHub** 为同一标签创建草稿 Release，从同一个本地输出目录上传三个文件，再发布为最新正式版。公开清单位于仓库的 `releases/latest/download/latest.yml`，私有附件通过 Release Assets API 读取。客户端以南大返回的有效清单为准，即便 GitHub 已经发布了更高版本。主站无法提供清单时客户端会查询 GitHub，收到签名无效的清单则停止并报错。[发布源实现](../../desktop/platform/update-feeds.mjs) · [更新器实现](../../desktop/platform/workspace-updater.mjs)

## 跳过一个内测版本

假设上一次正式发布的是 **0.1.20**，**0.1.21** 仅供内测，下一次可以直接发布 **0.1.22** 的三个附件。更新器比较用户当前版本和目标版本，直接组装目标安装包。

| 用户当前的工作区 | 点击“更新”后的结果 |
| --- | --- |
| 0.1.20 正式版，本地有可复用的安装包数据，0.1.20 和 0.1.22 的块索引可读，安装包下载地址支持 Range | 直接从 0.1.20 增量升到 0.1.22，跳过 0.1.21。 |
| 0.1.21 内测版，两站均未提供该内测构建的块索引 | 自动下载 0.1.22 完整安装包，校验后照常安装。若能按 0.1.21 标签读到匹配的块索引，且本地保有对应安装包，也可走增量。 |

保留仍需支持增量升级的旧版本 `.exe.blockmap`，使其可从原标签下载。若事后补发内测版索引，核对两站的最新清单仍指向 0.1.22。客户端复用工作区 `user-cache/updates/installer.exe` 中相同的块，通过 HTTP Range 获取变化的字节。缓存缺失、索引不可用、服务器未返回请求的字节范围或重组校验失败时，一键更新会改取完整包。安装前会核对完整安装包的 SHA-512，安装成功后缓存新版作为下次更新的基准。

## 发布后验收

1. 用普通用户的访问权限分别从两站读回最新 `latest.yml`，核对签名和目标版本，并把两站三个附件的 SHA-256 逐一与发布机的 `SHA256SUMS.txt` 比对。私有发行页可在软件更新面板的“私有仓库访问”中按站点配置只读令牌。GitLab 使用 `read_api`，GitHub 使用该仓库的 Contents 只读权限。[GitLab 私有发行附件](https://docs.gitlab.com/user/project/releases/release_fields/) · [GitHub 发行附件](https://docs.github.com/en/rest/releases/assets)
2. 分别通过两站的版本附件入口向安装包发送 `Range: bytes=0-0`。跟随下载重定向后，应返回 `206 Partial Content`、`Content-Range: bytes 0-0/<安装包总字节数>` 和 1 字节正文。再确认准备支持的旧版块索引能按原标签下载。
3. 在保有旧安装包缓存的独立 Windows 工作区点击“检查更新”，核对目标版本和预计增量下载量，点击“更新”并在重启后核对实际版本。将发布源、起止版本、下载方式和结果记入该版的发布文档，标明使用线上发行源还是本机测试端点。[0.1.16 验证记录示例](../releases/aimatterlab-0.1.16.md)
