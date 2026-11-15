# Agent 本地技能工作区

在普通对话说「把这个做法保存为本机技能，以后新聊天也能用」，Agent 会写入个人技能库。指定「只用于这个项目」时，技能随项目共享。未选项目时，指定「只用于这次对话」会保存到该对话的私有目录。以上操作均可在断开 SSH 和作业服务时完成。

## 保存位置

在「设置 → 科学资源与技能 → 本地用户缓存目录」查看或更改路径。Windows 全新安装默认使用 `%LOCALAPPDATA%\AIMatterLab\user-cache\skills`。已有安装如果使用过 `project-skills`，升级后沿用原目录。个人库位于 `user/<技能名>/SKILL.md`，项目和对话库位于 `<作用域摘要>/<技能名>/SKILL.md`。

保存新目录设置时，桌面端复制已有技能并保留原件。遇到同名且内容不同的技能时，显示冲突并继续使用原目录。

## Agent 工具

| 用途 | 调用 |
| --- | --- |
| 查个人库 | `project_skill_catalog({"scope":"user"})` |
| 查当前项目或私有对话库 | `project_skill_catalog({})` |
| 读取技能 | `read_project_skill`，传入同一 `scope` 和技能名 |
| 新建或更新 | `write_project_skill`，传入同一 `scope`、`name`、`body` 和 `expected_sha256` |
| 查内置科学指导 | `scientific_skill_catalog`，再用 `read_scientific_skill` 读取匹配的条目 |

新建时传 JSON `null`，更新时传上次读取的 SHA256。正文须包含匹配的 `name` 和一行 `description` 前置信息。服务商若显示写入确认，接受后完成保存。写入后按同一作用域读回正文与摘要。每个库最多 64 个单文件技能，单文件最大 16 KiB。模型只能通过桌面端读写技能名对应的文件。集群上的副本需单独管理。

五种 Agent 服务商均使用同一份[运行时技能工具清单](../agent/context/skill-directory.md)。
