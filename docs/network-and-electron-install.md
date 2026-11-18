# 安装与运行时代理、Electron 下载

## Clash 系统代理的适用范围

Codex 首次连接时可单独选择导入本机 `.env`。仅勾选代理会导入 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`、`NODE_USE_ENV_PROXY`、`ELECTRON_GET_USE_PROXY` 及其大小写形式。含变量引用或特殊转义的代理值可通过整份复制保留。全局配置里的 `features.respect_system_proxy` 也可按用户选择沿用。新用户无需创建文件，直接使用独立配置即可继续登录。在 AIMatterLab 中明确选择整份复制后，Codex 将按自己的规则读取整个文件。

Clash 的系统代理设置、Rule/Global 路由模式和 TUN 是不同机制。系统代理供支持该系统设置的程序使用；Rule/Global 决定进入 Clash 后如何分流；TUN 用于捕获流量。切换 Global 本身不会让不读取系统代理的子进程开始读取系统代理。[Mihomo 模式说明](https://github.com/MetaCubeX/Meta-Docs/blob/main/docs/config/general.md)、[TUN 说明](https://wiki.metacubex.one/en/config/inbound/tun/)。

AIMatterLab 在启动时自动发现代理。优先复用显式 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY（大小写均可），没有显式代理时读取 Windows 当前用户已启用的系统代理及绕过列表。Clash 常用的单个 HTTP/mixed 地址和按 http/https 分开的系统代理均支持；没有代理时保持原系统/TUN 网络行为。

发现 HTTP 代理后，源码 Launch 在安装依赖前准备环境，单提示词安装器的 pnpm 安装、构建、Electron 下载与后续桌面使用同一组设置。自动启用 ELECTRON_GET_USE_PROXY 和 NODE_USE_ENV_PROXY，并将代理变量传给 Agent CLI/DSH 子进程。桌面先设置默认 Chromium session 的代理，再初始化服务和请求。所有设置仅存在于当前进程及其子进程，不更改 Windows 或 Clash，不写入用户配置。[Electron 代理接口](https://www.electronjs.org/docs/latest/api/structures/proxy-config)。

保留用户绕过列表，并补入本机 worker/MCP 的回环地址。Windows 明确设置 `<local>` 时，桌面也会绕过不带点的内网主机名。显式代理 URL 若包含凭据，下载器和 CLI 继续接收原 URL，Chromium 的手动代理规则只接收协议、主机和端口。桌面未提供代理口令输入或自动应答 407 的功能。配置格式错误时，启动器提示检查设置。CMD 只报告代理来源和适用范围。重启应用可重新读取系统设置。

仅有 PAC 的系统配置仍由 Chromium 处理；安装器和 CLI 无法把按 URL 变化的 PAC 等价转换为固定环境变量，会给出明确提示，需提供实际 HTTP/mixed 代理。此处的自动下载支持 HTTP/mixed 代理；各 CLI 的额外 SOCKS 支持遵循其自身实现。WSL/SSH 内的网络独立配置，不把 Windows 回环代理地址当作远端代理。环境传递不是每个服务商的真实连通验证，复制 Codex `.env` 也不代表所有请求已经验证可达。

## Electron 下载的实际地址

当前 `package.json` 与锁文件固定 Electron **44.5.1**，其下载器为 **@electron/get 5.1.0**。源码启动先执行锁定依赖安装，运行时缺失时再执行本地 `node_modules/electron/install.js`；源码没有写死第三方镜像。用户环境或 npm 配置中的 `ELECTRON_MIRROR` / `ELECTRON_CUSTOM_DIR` / `ELECTRON_CUSTOM_FILENAME` 等仍可覆盖默认 URL。

Windows x64 默认文件：

- [electron-v44.5.1-win32-x64.zip](https://github.com/electron/electron/releases/download/v44.5.1/electron-v44.5.1-win32-x64.zip)
- [SHASUMS256.txt](https://github.com/electron/electron/releases/download/v44.5.1/SHASUMS256.txt)

2026-11-18 从开发节点检查：npm 元数据与 GitHub 官方 release 均存在，两个 URL 的 HEAD 请求返回 200，并跳转到 `release-assets.githubusercontent.com`；ZIP 声明长度为 157,998,329 字节。本次没有下载整个 ZIP，不证明用户本机链路可用。代理分流需要同时允许 GitHub 与实际资源域名。

## 自动发现不可用时，仅为当前终端配置代理

通常只需开启 Clash 系统代理后启动应用。需要显式配置时，先在 Clash 本机设置中确认真实 HTTP 或 mixed 监听地址与端口，不能猜测默认端口。需要时在启动 AIMatterLab 的 PowerShell 中设置，不写全局配置：

```powershell
$aimlabProxy = Read-Host '请输入 Clash 实际 HTTP/mixed 代理 URL（不含账号密码）'
$env:HTTP_PROXY = $aimlabProxy
$env:HTTPS_PROXY = $aimlabProxy
$env:http_proxy = $aimlabProxy
$env:https_proxy = $aimlabProxy
# 下列示例仅在当前终端没有既有绕过列表时补充本机回环。
if (-not $env:NO_PROXY -and -not $env:no_proxy) {
    $env:NO_PROXY = 'localhost,127.0.0.1,::1'
    $env:no_proxy = $env:NO_PROXY
}
$env:ELECTRON_GET_USE_PROXY = '1'
.\Launch-AIMatterLab.cmd
```

有既有绕过列表时保留它，并确认回环地址在列表中；AIMatterLab 的本地作业服务和 MCP 不应经过外部代理。完全退出旧桌面后从该终端重启，旧实例不自动获取新环境变量。各服务商 CLI 是否支持相应变量须按其版本核对，环境传递本身不是连通验证；WSL/SSH 内的安装网络独立配置，不把 Windows 的回环代理地址直接当作远端代理。

`@electron/get 5.1.0` 用 `ELECTRON_GET_USE_PROXY` 启用 undici 的环境代理，读取 HTTP_PROXY/HTTPS_PROXY/NO_PROXY；只设置 npm registry 不能改变 Electron ZIP 的 GitHub 地址。网上针对老版下载器的 `GLOBAL_AGENT_*` 配方不适用于此处锁定的下载器。[该版本代理实现](https://github.com/electron/get/blob/v5.1.0/src/proxy.ts)、[URL 生成规则](https://github.com/electron/get/blob/v5.1.0/src/artifact-utils.ts)。

若依赖已安装但 Electron 仍缺失，可在同一终端运行 `node node_modules/electron/install.js`，查看真实退出错误。不要在已有可用运行时上强制重下。手动下载须选锁定版本、正确平台/架构，并对照官方 SHASUMS256.txt 核对 SHA-256；保留具体失败原因，不关闭 TLS 或完整性校验。不要将本机代理地址、私有日志或凭据写入仓库。
