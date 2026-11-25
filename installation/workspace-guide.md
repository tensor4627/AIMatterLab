# AIMatterLab 工作区

从本目录的 `AIMatterLab.exe` 或桌面快捷方式启动。科学软件源码放在 [sources](sources/) 下，例如 `sources/PyDyn`。在「科学资源与技能」选择需要的源码，在计算资源中登记实际运行环境。

个人技能的默认位置是 [user-cache/skills/user](user-cache/skills/user/)。每个技能使用一个目录，以 `SKILL.md` 为入口。项目级提示词位于 `user-cache/skills/<项目摘要>/AGENTS.md`，可在文档内用相对链接指向该项目使用的个人技能。在设置中选用其他技能缓存目录后，项目提示词与技能位于所选目录中。

在工作台会话中，使用 `project_skill_catalog` 读取当前项目提示词与技能目录。`instructions.relativePath` 是该提示词在技能缓存内的相对路径。根据文档中的链接和任务，使用 `read_project_skill` 读取对应的技能。个人技能使用 `scope: "user"`，项目技能使用 `scope: "current"`。

未绑定项目时，`current` 指当前会话的私有库。某个集群账号专用的流程，保存在已取得访问权的 `resource_id` 对应的资源技能库。工具通过目标资源上的配置测试后，可从该库读回执行技能。

在聊天中查询软件功能、界面入口和源码位置，可用 `scientific_skill_catalog` 查 `product.workbench`，再按需阅读其中的参考文档。查询科学工具，例如 HotHam，可查 `software.catalog`；`search_software_docs({})` 列出本版登记的源码仓库，按名称查询可获得对应版本的指南。实际安装和测试状态在目标资源的配置记录中核对。

接入自己的程序或脚本时，可从 `tool.onboarding` 准备并登记带版本的工具定义。配置某台 SSH 资源时使用 `cluster.resource-tools`，按当前配置记录核对测试和激活。保存个人操作笔记用个人技能库，课题约定和产物引用用项目或会话技能库。
