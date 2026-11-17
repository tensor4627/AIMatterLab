# AIMatterLab 工作区

从本目录的 `AIMatterLab.exe` 或桌面快捷方式启动。科学软件源码放在 [sources](sources/) 下，例如 `sources/PyDyn`。在「科学资源与技能」选择需要的源码，在计算资源中登记实际运行环境。

个人技能的默认位置是 [user-cache/skills/user](user-cache/skills/user/)。每个技能使用一个目录，以 `SKILL.md` 为入口。项目级提示词位于 `user-cache/skills/<项目摘要>/AGENTS.md`，可在文档内用相对链接指向该项目使用的个人技能。在设置中选用其他技能缓存目录后，项目提示词与技能位于所选目录中。

在工作台会话中，使用 `project_skill_catalog` 读取当前项目提示词与技能目录。`instructions.relativePath` 是该提示词在技能缓存内的相对路径。根据文档中的链接和任务，使用 `read_project_skill` 读取对应的技能。个人技能使用 `scope: "user"`，项目技能使用 `scope: "current"`。
