# 校园通知与 DDL 管理 Agent：GitHub 四人协作方案

> 适用团队：四名大三学生，成员记为 A、B、C、D  
> 实施方式：按统一任务清单与依赖推进，不设固定开发周期  
> 编写日期：2026-10-19  
> 推荐工具：GitHub 网页 + GitHub Desktop + 各自的开发或文档编辑工具  
> 编写依据：同目录的命题要求与《校园通知与DDL管理Agent_项目设计与开发总纲.md》  
> 修订日期：2026-10-19，任务安排统一引用新总纲

项目依据：[命题要求](创新实践_开放式命题_基于鸿蒙arkui-x的跨端ai_agent应用.md)、[项目设计与开发总纲](校园通知与DDL管理Agent_项目设计与开发总纲.md)。仓库创建者先执行第 3～5 节；全员日常操作按第 6～8 节；任务领取与拆分见第 11 节。设计、范围和验收以总纲为准，本文说明 GitHub 操作方式。

## 1. 方案与基本概念

采用“一个私有仓库、四个独立账号、一个主分支、按任务创建功能分支”的方式。客户端、模型网关、文档和脱敏样例放在同一个仓库。

GitHub Free 支持私有仓库和不限数量的协作者，四个人可以从免费方案开始。[官方说明：邀请协作者](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository)

| 名称 | 在本项目中的含义 |
|---|---|
| Repository，仓库 | 集中保存源码、文档以及它们的修改历史 |
| Clone，克隆 | 把线上仓库下载成电脑上的工作副本，并保留同步关系 |
| Branch，分支 | 从某个版本开始的一条工作线，用于完成一项任务 |
| Commit，提交 | 在本机记录一次文件变化；此时尚未上传到 GitHub |
| Push，推送 | 把本机已经提交的变化上传到远端分支 |
| Pull，拉取 | 把远端分支的新提交同步到本机 |
| Issue，任务单 | 记录要做什么、负责人、完成标准和讨论 |
| PR，Pull Request | 请求把任务分支的改动合并进主分支，并供组员检查 |
| Review，评审 | 阅读 PR 中的改动，提出修改意见或表示同意合并 |

保存文件、提交、推送、合并是不同动作。完成推送后，功能分支的内容也要经过 PR 合并，才会进入 `main`。

## 2. 四人职责与协作边界

| 成员 | 主责 | 主要维护内容 | 重点协作对象 |
|---|---|---|---|
| A：跨端与客户端 | ArkUI-X 工程、页面接入、两端构建 | 客户端工程配置、页面、平台适配、构建说明 | D 配合 UI 与语音；C 提供数据接口 |
| B：模型与 Agent | 模型网关、Agent 状态机、工具分发 | `server/`、客户端 Agent 模块、模型与工具协议 | C 对齐查询和提交接口；D 对齐云端语音 |
| C：数据与排程 | 数据结构、本地存储、日期规则、排程 | 客户端领域与数据模块、脱敏数据样例 | A、B 都依赖数据接口 |
| D：语音与体验 | 鸿蒙 ASR/TTS、页面体验、验证与演示 | 语音适配与组件、页面草图、反馈和演示材料 | A 配合页面集成；B 配合云端语音 |

以上是主责约定，不是文件访问限制。关键模块至少两人了解；每项任务由一人主导，另一名相关成员评审。

仓库创建者负责邀请成员和仓库设置，可由 A 或组长担任。A 的 PR 也应由其他相关成员检查。

## 3. 创建 GitHub 仓库：创建者操作一次

本节采用个人账号持有仓库的方式，适合当前四人课程项目。建议仓库名为 `campus-ddl-agent`，这是示例名称，团队可以自行修改。

1. 登录 GitHub，点击右上角 `+` → `New repository`。
2. `Owner` 选择负责创建仓库的个人账号。
3. `Repository name` 填写 `campus-ddl-agent`。
4. 简介填写“校园通知与 DDL 管理 Agent，ArkUI-X 鸿蒙与 Android 跨端课程项目”。
5. 可见性选择 `Private`。
6. 当前从文档开始的新项目，勾选初始化 `README`。
7. `.gitignore` 可稍后按实际工程补充；许可证由团队确定后添加。
8. 点击 `Create repository`，复制仓库网页链接给组员。
9. 查看默认分支名称。本文统一使用 `main`，如实际名称不同，先由创建者统一。

这里的初始化方式适用于新建仓库；如果以后导入一个已经有 Git 历史的项目，应采用对应导入流程，避免同时初始化两份历史。[官方说明：创建仓库](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)

创建后，在 `README.md` 中逐步写明项目目标、成员职责、目录、启动方法和已验证的工具版本，并将新总纲作为项目设计入口。准备材料可先提交，实际环境与构建验证完成后补齐相应说明。

## 4. 邀请另外三名成员

### 4.1 仓库创建者

1. 向另外三人收集各自的 GitHub 用户名。
2. 打开仓库网页，进入 `Settings`。
3. 在侧边栏的 `Access` 区域找到 `Collaborators`。
4. 点击 `Add people`，搜索并核对一名组员的用户名。
5. 点击添加该用户的按钮，发送邀请。
6. 对另外两名组员重复以上操作。

### 4.2 被邀请成员

1. 登录自己的 GitHub 账号。
2. 从邀请邮件或 GitHub 的邀请入口打开邀请并接受。
3. 打开仓库链接，确认能看到私有仓库内容。
4. 克隆后尝试发布自己的任务分支，确认具备协作权限。

个人仓库的持有者与协作者权限有区别；本方案不依赖对不同目录分别授权。成员接受邀请后才获得协作者访问权限。[官方说明：邀请协作者](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository)

## 5. 克隆仓库并放入现有材料

### 5.1 四个人分别克隆

1. 安装并打开 [GitHub Desktop](https://desktop.github.com/)，使用自己的 GitHub 账号登录。
2. 按提示配置提交作者姓名和邮箱；邮箱使用账号关联邮箱或账号提供的隐私邮箱。
3. 点击 `File` → `Clone repository`。
4. 在 `GitHub.com` 列表中选择团队仓库，或在 `URL` 标签页填写仓库链接。
5. `Local Path` 选择新的空目录，例如 `D:\projects\campus-ddl-agent`。
6. 点击 `Clone`，完成后确认 `Current Repository` 是团队仓库。

当前 `D:\huawei` 中已有项目材料，建议先保留，再把需要的文件复制进新的仓库目录。之后在克隆目录中编辑和开发，GitHub Desktop 才能跟踪这些改动。[官方说明：克隆仓库](https://docs.github.com/en/desktop/adding-and-cloning-repositories/cloning-and-forking-repositories-from-github-desktop)

### 5.2 由创建者导入已有文档

按第 6～8 节的流程创建 `docs/project-plan` 分支，将当前文件夹中的命题要求、新总纲和本协作方案复制到仓库的 `docs/`，发起 PR，由另一人检查后合并。旧版设计和启动任务文档如需保留，应保留其历史版本提示。

建议逐步形成以下结构；`client/`、`server/` 在实际开始开发时添加，客户端内部以真实 ArkUI-X 模板为准：

```text
campus-ddl-agent/
├── client/                     # 共享客户端与必要的平台工程配置
├── server/                     # 模型与可选语音网关
├── docs/
│   ├── [已有设计、分工、协作等 Markdown 文档]
│   ├── setup/                  # 环境、模型、数据与页面准备材料
│   └── images/                 # 草图与文档配图
├── fixtures/                   # 脱敏通知和后续验收样例
├── .gitignore
└── README.md
```

把相关文档一起移动到 `docs/` 可保留它们之间的同目录关系；移动后检查文档链接和图片链接。仓库中的文档链接使用相对路径，方便组员在不同电脑上阅读。

## 6. 使用分支完成一项任务

### 6.1 分支约定

`main` 保存已经检查和合并的共同版本。除仓库首次初始化外，后续改动通过任务分支和 PR 进入 `main`。

每个分支围绕一项任务，推荐名称如下：

| 类型 | 示例 | 用途 |
|---|---|---|
| 文档 | `docs/a-environment` | A 的环境与工程笔记 |
| 功能 | `feat/task-list` | 任务列表功能 |
| 功能 | `feat/model-gateway` | 模型网关 |
| 功能 | `feat/local-store` | 本地存储 |
| 功能 | `feat/harmony-speech` | 鸿蒙语音 |
| 修复 | `fix/deadline-validation` | 截止日期校验问题 |

按任务创建分支，完成后结束该分支；本项目暂时采用 `main` 加短期任务分支即可。

### 6.2 创建分支的操作

1. 在 GitHub Desktop 中确认当前仓库正确，上一项工作的改动已提交或妥善保存。
2. 在 `Current Branch` 中切换到 `main`。
3. 点击 `Fetch origin`；如果随后出现 `Pull origin`，继续点击以同步最新版本。
4. 点击 `Current Branch` → `New Branch`。
5. 输入任务分支名，例如 `docs/a-environment`。
6. 确认基于最新 `main` 创建，点击 `Create Branch`。
7. 确认顶部显示新分支名，再开始编辑仓库中的文件。

分支基于已有版本创建，发布后其他成员才能在线查看。[官方说明：管理分支](https://docs.github.com/en/desktop/making-changes-in-a-branch/managing-branches-in-github-desktop)

### 6.3 提交并推送

1. 在编辑器中修改文件并保存。
2. 回到 GitHub Desktop 的 `Changes`，逐个查看本次变化。
3. 勾选本任务需要提交的文件；确认没有误删或混入本机配置。
4. 在 `Summary` 中填写清楚的说明，例如 `docs: 补充 A 的环境准备与工程笔记`。
5. 点击 `Commit to 当前分支名`，完成本机提交。
6. 首次上传分支点击 `Publish branch`；之后的新提交点击 `Push origin`。
7. 到 GitHub 网页切换至该分支，确认文件和最新提交已经上传。

任务需要多次提交时，重复保存、检查、提交、推送即可。[官方说明：提交与推送](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop)

## 7. 创建 PR：请求合并进 main

分支上传后，通过 GitHub 网页操作：

1. 打开仓库 → `Pull requests` → `New pull request`；如果首页出现 `Compare & pull request`，也可以从该入口进入。
2. 检查方向：`base` 选择 `main`，`compare` 选择自己的任务分支。
3. 阅读下方差异，确认只包含本次任务的改动。
4. 填写标题，例如“补充 A 的环境与工程笔记”。
5. 描述本次变化、验证方式、关联任务和待确认问题。
6. 点击 `Create pull request`，并在 `Reviewers` 中选择相关成员。

PR 的含义是“把 compare 分支合并到 base 分支”，创建前务必核对方向。[官方说明：创建 PR](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-a-pull-request)

推荐使用以下描述格式。`Closes #1` 中的编号仅为示例，请替换为真实任务编号；没有对应任务时删去该行。

```markdown
本次变化：
- 补充已安装工具、可用设备与缺少的环境。
- 增加共享工程目录草图和下一周建工程步骤。

验证情况：
- 已检查文档可以阅读，配图和链接有效。
- 实际检查了哪些环境，按真实情况填写。

待确认：
- 仍需准备哪些设备或工具，按真实情况填写。

Closes #1
```

只有整项 Issue 的完成标准都满足时才使用 `Closes`；仅完成部分内容时写“关联 #1”。开发中的 PR 可在标题中标明“进行中”，完成后再请组员正式评审。

## 8. 评审、修改、合并与同步

### 8.1 另一名成员评审

1. 打开 PR，先读描述和关联 Issue 的完成标准。
2. 点击 `Files changed`，查看具体改动。
3. 对需要调整的行添加评论，说明具体问题和期望结果。
4. 点击 `Review changes`：通过选 `Approve`；需要修改选 `Request changes`；一般讨论选 `Comment`。
5. 点击 `Submit review`，提交评审结果。

文档重点检查内容是否符合分工、说明是否清楚；代码重点检查行为、接口和实际验证证据。PR 作者不能批准自己的 PR。[官方说明：评审 PR](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request)

### 8.2 作者按意见修改

1. 回到本机原来的任务分支。
2. 修改并保存文件，重新提交，再点击 `Push origin`。
3. 原 PR 会包含该分支的新提交，无需新建一个 PR。
4. 在原评论下说明修改情况，请评审者复查。
5. 如果有新的实质性改动，评审者重新检查最新内容。

### 8.3 合并 PR

团队约定：至少一名其他相关成员同意，必要验证完成，阻塞问题解决后，才合并 PR。可以由作者在上述条件满足后操作；工程公共配置等改动由相关负责人共同确认。

1. 再次确认 PR 的目标分支为 `main`。
2. 在合并按钮的下拉菜单中选择 `Squash and merge`，将该任务的提交整理成一个提交。
3. 检查合并说明，点击确认按钮。
4. 确认页面显示 `Merged`。
5. 该分支不再有未合并工作或依赖它的其他任务时，可点击 `Delete branch` 删除远端任务分支。

如果看不到 `Squash and merge`，仓库持有者可在 `Settings` → `General` 的 `Pull Requests` 区域检查是否允许 squash 合并。普通合并也是有效方式，团队统一使用一种即可。[官方说明：合并 PR](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request)、[配置 squash 合并](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests)

### 8.4 合并后四个人同步

1. 妥善保存当前任务分支上的工作。
2. 切换到本机 `main`。
3. 点击 `Fetch origin`，如有新提交，再点击 `Pull origin`。
4. 确认能看到刚合并的文件或功能。
5. 新任务从更新后的 `main` 创建新分支。

合并线上 PR 不会自动更新每个人电脑上的文件。同步主分支与更新正在开发的任务分支也是两件不同的事。[官方说明：同步分支](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/syncing-your-branch-in-github-desktop?platform=windows)

## 9. 开发过程中同步 main 与处理冲突

### 9.1 把其他人的最新成果合入自己的任务分支

当自己的任务尚未完成，但需要使用别人已经合并到 `main` 的改动时：

1. 先提交当前任务的工作，保持工作区清楚。
2. 切到 `main`，执行 `Fetch origin` 和需要时的 `Pull origin`。
3. 切回自己的任务分支。
4. 打开 `Current Branch` → `Choose a branch to merge into 当前任务分支`。
5. 选择 `main`，确认将 `main` 合入当前任务分支。
6. 处理冲突并检查功能，再点击 `Push origin`。

此处方向是“main → 自己的任务分支”；正式交付仍通过 PR 将任务分支合并回 `main`。仅在任务分支点击 `Pull origin`，不会自动引入 `main` 的改动。[官方说明：同步与合并分支](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/syncing-your-branch-in-github-desktop?platform=windows)

### 9.2 出现冲突时

冲突通常表示两项任务改动了相同位置，需要共同确定最终内容。

1. 查看 GitHub Desktop 提示的冲突文件。
2. 与相关成员对齐要保留的行为或内容。
3. 在编辑器中处理冲突，形成正确的最终文件，并移除冲突标记。
4. 保存后按 Desktop 提示标记已解决、继续并完成合并提交。
5. 检查文档或运行相关功能，再推送任务分支。

遇到工程配置、依赖文件或数据协议冲突，由对应负责人一起处理。不要仅为消除冲突而整份覆盖对方文件。

## 10. 使用 Issues 和看板安排工作

### 10.1 每项任务建立 Issue

在仓库打开 `Issues` → `New issue`，填写标题、任务内容和完成标准；选择 `Assignees` 指定负责人。可以增加 `docs`、`client`、`agent`、`data`、`speech`、`bug` 等标签。

一项任务应能在几天内完成或展示。任务太大时拆成多个可以独立检查的结果；依赖其他任务时记录对应 Issue 编号。[官方说明：使用 Issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues)

### 10.2 建立一个简单看板

在 GitHub 的 `Projects` 入口创建项目，选择 Board 布局，将仓库的 Issues 加入，状态采用：待开始、进行中、待检查、已完成。创建者为其他三人授予可编辑该 Project 的权限；私有仓库的访问权限与 Project 的访问权限分别确认。

Project 的成员权限可在项目右上角菜单 → `Settings` → `Manage access` 中设置，邀请其他三人并授予 `Write` 权限。[官方说明：管理 Project 访问权限](https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/managing-access-to-your-projects)

使用看板追踪完成情况，在任务同步时确认进展、阻塞和下一项优先工作。按新总纲第 14.3 节的完成条件开展基础能力、核心业务、交付候选与最终交付检查。[官方说明：Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects)

## 11. 从新总纲领取与拆分任务

开发任务统一使用新总纲第 14 节的 T01～T45。建立 Issue 时注明对应总纲编号、负责人、实际依赖和完成标准；较大的任务可以拆成多个子任务，完成范围仍以总纲为准。总纲编号与 GitHub 自动分配的 Issue 编号分别记录，例如“总纲 T01，对应 Issue #7”。

准备工作可以从下表领取，具备条件时按依赖继续推进工程和功能实现：

| 成员 | 对应总纲任务 | 推荐分支 | 准备材料 | 建议评审者 |
|---|---|---|---|---|
| A | T01 环境准备与工程了解 | `docs/a-environment` | 环境准备与工程笔记 | C 或 D |
| B | T02 模型候选与流程草案 | `docs/b-agent` | 模型候选与流程笔记 | C |
| C | T03 核心字段与示例准备 | `docs/c-data` | 字段表、两条示例和保存笔记 | B |
| D | T04 页面草图；T05 通知样例与需求验证 | `docs/d-experience` | 两张草图、脱敏通知和反馈记录；T05 的后续调研继续跟踪 | A |

材料放入 `docs/setup/`，各人维护独立文件；图片放入 `docs/images/` 并在文档中引用。全组共同提供脱敏通知，由 D 汇总。一个 PR 可以关联多个 Issue，但仅关闭完成标准全部满足的任务。

准备材料按对应任务验收。工程运行、模型真实调用、本地存储、语音和三个业务闭环均需在相应实现任务中分别验证；资料提交完成不等于功能已经实现。

## 12. 共同约定的接口与环境

### 12.1 接口先给出最小约定和示例

| 对接双方 | 需要明确的内容 | 推荐记录位置 |
|---|---|---|
| A、D | 页面由谁集成，组件输入输出，录音和播报状态 | `docs/ui-and-speech.md` |
| B、C | 工具名称、参数、返回值、错误码、确认与版本机制 | `docs/tool-contract.md` |
| A、B | 模型网关地址、请求响应示例、超时与错误反馈 | `docs/model-api.md` |
| A、C | Repository 方法、异步返回、读取与保存失败行为 | `docs/data-contract.md` |

以上文件按实际需要逐步补充。接口修改在同一个 PR 中同步更新约定和示例，并请受影响成员评审；尚未实现的依赖可先使用符合约定的模拟返回进行独立开发。

### 12.2 固定实际验证过的环境

A 汇总 DevEco Studio、ArkUI-X SDK、鸿蒙设备与 SDK、Android SDK、JDK、Gradle 等实际版本。B 记录服务端环境、依赖和启动方法。工程可运行后，联调时选定同一个 `main` 提交版本进行两端验证，留下提交编号与验证记录。

真实服务商 API Key 放在服务端环境变量中；仓库只提交占位配置示例。签名私钥、本机绝对路径、未脱敏通知、会话和录音不纳入仓库。必要的源码、依赖声明与锁文件、两端工程配置保留；按实际工程忽略缓存与构建产物。

自动检查从稳定可复现的内容开始，例如服务端检查、日期规则和排程验证。鸿蒙与 Android 构建先在已配置的本机跑通，再决定是否接入自动构建；语音和真机验收继续按设计文档实际操作。

## 13. 免费私有仓库的规则说明

本方案中的“通过 PR 合并、至少一人评审、主分支保持可联调”首先是四人的工作约定。

GitHub 官方说明：GitHub Free 的分支保护适用于公开仓库；私有仓库的分支保护需要符合 GitHub Pro、Team 等套餐条件。个人仓库与组织仓库应分别选择适用套餐。[官方说明：分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

因此，免费私有仓库里即使界面允许跳过评审或直接推送 `main`，四人仍按约定操作。`Approve`、`Request changes` 以及目录负责人约定本身不等于强制权限控制。以后确实需要强制执行时，再评估套餐和保护设置。

## 14. 常见问题

| 现象 | 优先检查与处理 |
|---|---|
| 组员打不开私有仓库 | 登录账号是否正确，邀请是否已经接受 |
| Desktop 看不到仓库 | 核对登录账号、仓库权限；尝试用 URL 克隆 |
| 文件保存了，Changes 没变化 | 是否编辑了真正的克隆目录，文件是否被忽略 |
| Commit 后线上没有变化 | 是否点击了 `Publish branch` 或 `Push origin` |
| 网页看不到同学刚上传的文件 | 是否正在查看对方的任务分支；进入 main 需完成 PR 合并 |
| 创建 PR 时没有差异 | `base`、`compare` 是否正确；改动是否已经提交并推送 |
| PR 提示不能自动合并 | 先把最新 main 合入任务分支，与相关成员处理冲突 |
| PR 合并后本机没有更新 | 切换到 main，再 Fetch 与 Pull |
| 自己的功能分支缺少别人已合并的功能 | 在任务分支中合入最新 main，参见第 9 节 |
| 误将内容提交到了 main，但还没推送 | 暂停推送，先在当前提交处建立任务分支保存成果，再请熟悉 Git 的成员协助调整本地主分支 |
| 误提交真实密钥 | 立即撤销或更换密钥，再处理仓库中的文件与历史；仅删最新文件不能消除旧提交中的内容 |

## 15. 可选：熟悉命令行后的常用操作

下面与 Desktop 流程等价，按需要选择一种操作方式。命令示例不会替你创建线上仓库或接受邀请。先完成克隆和 GitHub 身份验证；HTTPS 验证使用凭据管理器或令牌等支持方式。

在克隆后的仓库目录打开终端，先检查当前状态。存在未提交改动时，先妥善保存，再切换分支。

```powershell
git status
git switch main
git pull --ff-only origin main
git switch -c docs/a-environment
```

编辑并保存材料后，检查差异，只添加本次需要的文件。下方文件名是示例，请替换为实际已经创建的文件名。

```powershell
git status
git diff
git add -- "docs/setup/A-环境与工程笔记.md"
git diff --cached
git commit -m "docs: 补充 A 的环境与工程笔记"
git push -u origin docs/a-environment
```

然后到 GitHub 网页按第 7～8 节创建、评审和合并 PR。

需要在进行中的任务分支引入最新 main 时，先确保工作已提交。执行下面第一条命令，确认当前分支是自己的任务分支且工作区干净，再依次执行后两条命令：

```powershell
git status
git fetch origin
git merge origin/main
```

若发生冲突，按第 9 节处理并完成合并提交，检查通过后再执行 `git push`。PR 合并后，回到 main 拉取最新版本，并为下一项任务建立新分支。

## 16. 启动完成清单

- [ ] 四个人使用各自的 GitHub 账号。
- [ ] 一人创建私有仓库，另外三人接受协作邀请。
- [ ] 四个人分别克隆仓库并确认编辑目录。
- [ ] 已有项目文档通过 PR 导入共同仓库。
- [ ] 已从总纲建立当前要推进的 Issues，写明任务编号、负责人、依赖和完成标准。
- [ ] 每人完成一次任务分支、提交、推送和 PR。
- [ ] 每个 PR 由另一名相关成员检查。
- [ ] 四份准备材料合并后，四个人都同步到最新 main。
- [ ] 完成一次任务同步，确认当前阻塞和下一项优先工作。
