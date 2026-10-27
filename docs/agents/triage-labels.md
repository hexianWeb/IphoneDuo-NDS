# Triage Labels

分类角色记录在普通任务文件顶部的 Status 字段中，不使用远程标签。

| 技能角色 | Status 值 | 含义 |
| --- | --- | --- |
| needs-triage | needs-triage | 等待维护者评估 |
| needs-info | needs-info | 等待报告者补充信息 |
| ready-for-agent | ready-for-agent | 规格完整，可交给代理执行 |
| ready-for-human | ready-for-human | 需要人工实现 |
| wontfix | wontfix | 不予处理 |

技能要求应用分类标签时，更新 Status 字段。
关闭状态由 State 字段单独记录，不新增第六个分类角色。
Wayfinder 专属的 claimed / resolved 执行状态见 issue-tracker.md。
