# AIMatterLab 0.1.1 验收记录

| 范围 | 结果 | 验证 |
| --- | --- | --- |
| SSH 终端与作业服务 | passed | 201 项定向测试通过。Windows ConPTY 和 WSL OpenSSH 回环实测一个登录连接、两个独立会话终端、跨会话读取拒绝、切回与超时唤醒、复用同一远端作业服务及退出清理。超时场景使用可控时钟。 |
| 空闲设置 | passed | 隔离 Electron 实例默认 60 分钟。界面保存为 75 分钟后重启，设置读回一致。 |
| 工具调用显示 | passed | 隔离 Edge 验证 7 个场景，含窄栏、键盘、流式追加、操作按钮和阅读位置。13 项相关 Node 测试通过。 |
| Markdown | passed | 16 项解析测试通过。隔离 Chromium 和 Electron 的实时、历史消息渲染共 4 项通过。 |
| 项目技能工作区 | passed | 91 项定向检查通过。五类服务商经实际 MCP 读回项目技能，修改、重启、隔离、冲突和中断恢复通过。官方 DSH 子进程使用模拟模型响应验证工具转发。 |
| 集群增量更新和位置登记 | passed | 173 项 Node、22 项 Linux 测试通过。回环服务首次安装、两次零 worker 字节重连，以及单文件修改、新增、删除通过。SQLite 重开后读回位置，并在 Chromium 和隐藏 Electron 中核对设置页。[传输字节与验证范围](../development/ssh-service-delta-validation.md)。 |
| Git 源码启动 | passed | 32 项 Node 检查、6 项隐藏 Electron 场景通过。首次准备、重复启动、改源码重构、改锁文件重装、设置读回、与便携版共用 profile 的互斥均已验证。[源码启动指南](../source-desktop.md)。 |
| 真实集群和科学计算 | not_run | 本轮的会话和传输验收采用回环服务。 |
