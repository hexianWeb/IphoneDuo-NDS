# Issue tracker: Local Markdown

规格与任务保存在仓库的 .scratch/ 中，所有跟踪操作直接读写本地文件，不依赖 gh 或远程服务。

## 文件约定

- 每个功能一个目录：`.scratch/<feature-slug>/`。
- 规格：`.scratch/<feature-slug>/spec.md`。
- 实施任务：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 01 编号，每个任务单独一个文件，不合并为大任务清单。
- 普通任务顶部用 `Status: <角色>` 记录分类，角色见 triage-labels.md；另用 `State: open` / `State: closed` 区分未关闭与已关闭。
- 评论和处理记录追加到文件末尾的 `## Comments` 下。
- 关闭任务时写明结论并设为 `State: closed`，保留文件，不删除历史记录。

## 技能操作映射

- “publish to the issue tracker”：在对应功能目录创建规格或任务文件，仅在实际需要时创建目录。
- “fetch the relevant ticket”：读取用户指定的任务路径；只有编号时，先在对应功能目录解析，歧义时询问。
- 列出任务：扫描任务文件，根据 State 和 Status 筛选。
- 应用分类标签：更新任务的 Status 字段，不创建远程标签。
- 阻塞关系：在顶部写 `Blocked by: 01, 02`；编号限同一功能目录，跨功能使用仓库相对路径。所有阻塞任务关闭后才可开始。

## Wayfinding

- Map：`.scratch/<effort>/map.md`，包含 Notes、Decisions-so-far、Fog。
- 子任务：`.scratch/<effort>/issues/<NN>-<slug>.md`，问题写入正文，顶部用 `Type:` 记录 research / prototype / grilling / task。
- Wayfinder 子任务的执行生命周期使用 `Status: claimed` / `Status: resolved`，区别于普通任务的五个分类状态。
- Frontier：按编号选择尚未关闭、未认领且所有阻塞任务已解决的子任务。
- Claim：开工前写入 `Status: claimed` 并保存。
- Resolve：在 `## Answer` 下记录答案，设为 `Status: resolved` 和 `State: closed`，再向 Map 的 Decisions-so-far 追加结论与相对链接。
