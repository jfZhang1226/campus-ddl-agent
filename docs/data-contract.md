# T03：核心数据字段说明

> 负责人：C  
> 编写日期：2026-10-19  
> 状态：资料初稿完成，待 A、B 对齐接口，D 参考展示字段  
> 依据：[项目设计与开发总纲](校园通知与DDL管理Agent_项目设计与开发总纲.md)第 5、6、8、14 节

## 1. 本次交付范围

本次细化 Notice（通知）、Task（任务）、ChecklistItem（材料清单）三类核心数据，提供[两条关联一致的人工构造示例](../fixtures/task-samples.json)和[本地保存思路](local-storage-plan.md)。字段名称沿用总纲。

本文定义的是确认保存后的数据形态。模型提取草案、待确认方案、排程、会话和操作记录的完整协议分别在后续任务中实现；T03 不直接实现存储、幂等或排程算法。

总纲已确定日期精度、任务状态和材料状态。`kind`、`priority` 的枚举、字段空值及本次提出的值约束是 C 提交的接口草案，供 A、B 评审后共同维护。

## 2. 通用约定

| 项目 | 约定 |
|---|---|
| 字段名称 | 使用总纲已有的小驼峰命名，例如 `publishedAt`、`remainingMinutes` |
| ID | 非空字符串，在各自实体类型内唯一；正式实现由客户端生成并在重启后保留，不使用标题作为 ID |
| 时间戳 | 使用带明确 UTC 偏移的 ISO 8601 字符串，例如 `2026-11-01T09:05:00+08:00`；首版业务时区默认 `Asia/Shanghai` |
| 仅日期 | 使用有效本地日期 `YYYY-MM-DD`，不附加虚构时刻 |
| 空值 | 本文列出的键均保留；未知或不适用的单值使用 JSON `null`，集合使用数组；不以空字符串、`0` 或 `"未知"` 代替未知值 |
| 文本 | 标题、原文、材料名称等必需文本非空；保留通知原文，不由模型改写后覆盖原文 |
| 数值 | 版本和分钟数为整数；`null` 与 `0` 含义不同 |
| 数据来源 | 模型可以生成草案；正式数据保存由客户端校验，并遵守总纲的确认与提交机制 |

## 3. Notice：通知

用于保存用户主动导入的通知原文及来源。发布时间用于解释“明天”“下周五”等相对日期，导入时间单独记录。

| 字段 | 类型 | 允许 null | 含义与约束 |
|---|---|---|---|
| `id` | string | 否 | 通知唯一 ID，供任务和清单关联 |
| `rawText` | string | 否 | 用户导入的非空通知原文 |
| `sourceLabel` | string 或 null | 是 | 用户填写的脱敏来源标签，例如“数据库课程群”；未知时为 null |
| `publishedAt` | 带偏移时间字符串或 null | 是 | 原通知发布时间；未知时为 null，不能用导入时间冒充 |
| `importedAt` | 带偏移时间字符串 | 否 | 本机记录的导入时间 |
| `timezone` | string | 否 | 解释通知日期所用时区，首版默认 `Asia/Shanghai` |
| `contentHash` | string | 否 | `rawText` 原始字符串的 UTF-8 字节经 SHA-256 得到的 64 个小写十六进制字符，不含 BOM，不预先裁剪空格或换行 |

`contentHash` 仅提供内容相同的线索。重复通知判断仍需结合发布时间、课程和候选任务，不能只按哈希或标题决定覆盖。SHA-256 的两端可用实现需要在实际工具链中验证；T03 示例的哈希用于保持示例自洽。

## 4. Task：任务

| 字段 | 类型 | 允许 null | 含义与约束 |
|---|---|---|---|
| `id` | string | 否 | 任务唯一 ID，更新任务保留该 ID |
| `title` | string | 否 | 可供用户理解的非空任务标题 |
| `course` | string 或 null | 是 | 课程名称；非课程事项或未明确时为 null |
| `kind` | string 或 null | 是 | 分类草案：`assignment` 作业、`report` 报告、`registration` 报名、`other` 其他；尚未确定时为 null |
| `deadlinePrecision` | string | 否 | `unknown`、`date_only`、`exact`，具体规则见第 5 节 |
| `deadlineDate` | 日期字符串或 null | 是 | 仅 `date_only` 使用，表示本地日历日期 |
| `dueAt` | 带偏移时间字符串或 null | 是 | 仅 `exact` 使用，表示真实且明确的截止时刻 |
| `timezone` | string | 否 | 解释日期与展示时间所用时区，首版默认 `Asia/Shanghai` |
| `priority` | string 或 null | 是 | 用户确认的优先级草案：`low`、`normal`、`high`；尚未确认时为 null，模型不得静默填入 |
| `status` | string | 否 | `todo`、`in_progress`、`ready`、`submitted`、`done`、`cancelled`，见第 6 节 |
| `remainingMinutes` | integer 或 null | 是 | 用户确认的剩余工时，必须大于或等于 0；未知时为 null，不擅自估成固定分钟数 |
| `submissionChannel` | string 或 null | 是 | 提交渠道，例如“学习通”；未知或不适用时为 null |
| `noticeIds` | string[] | 否 | 关联 Notice ID，数组内不重复，所有引用均存在；来自通知的任务至少关联该通知，纯人工任务可为空数组 |
| `version` | integer | 否 | 单个任务的数据版本，初建为 1，后续实际修改时递增；不同于整个业务快照的 revision |
| `createdAt` | 带偏移时间字符串 | 否 | 首次正式创建时间，后续修改不重写 |
| `updatedAt` | 带偏移时间字符串 | 否 | 最近一次实际修改任务或相关清单状态的时间，不早于 createdAt |

涉及任务或其清单变化时，本草案建议同时更新所属 Task 的 `updatedAt` 与 `version`，使待确认方案能够发现相关变化。具体幂等和版本提交语义在 T16 与 B 对齐并验证。

## 5. 截止日期的三种形态

| `deadlinePrecision` | `deadlineDate` | `dueAt` | 页面应表达什么 |
|---|---|---|---|
| `exact` | null | 明确的带偏移截止时刻 | 显示具体日期与时间 |
| `date_only` | 有效的 `YYYY-MM-DD` | null | 当天到期，具体截止时刻待确认 |
| `unknown` | null | null | 截止日期待补充 |

- 三种形态互斥，不同时填写 `deadlineDate` 和 `dueAt`。
- “当天提交”“周五交”未给出具体时刻时，不补成 23:59。
- 通知发布时间未知且只有相对日期时，先追问；没有充分依据时保持 unknown。
- 截止时间已过去时提示用户确认，可以保留历史任务，不自动改成未来日期。
- “当天到期”可以用于日期级展示与排程；如果需要严格保证某个时刻前完成，先补齐确切时刻。

## 6. 任务状态与材料状态

| Task.status | 含义 |
|---|---|
| `todo` | 尚未开始 |
| `in_progress` | 正在处理 |
| `ready` | 用户确认已准备好，仍未确认提交 |
| `submitted` | 有提交要求的任务，由用户明确确认已经提交 |
| `done` | 普通待办已经完成 |
| `cancelled` | 用户确认不再执行 |

`overdue` 根据当前时间、截止字段与任务状态派生，不作为新的持久化状态。材料勾选只表示用户认为已经准备，不能证明文件内容正确，也不自动把 Task 改成 submitted。

详细状态转换规则在 T22 实现。用户说“做完了”时仍需结合任务类型和提交清单澄清；剩余工时为 0 也不代表已经提交。

## 7. ChecklistItem：材料清单项

| 字段 | 类型 | 允许 null | 含义与约束 |
|---|---|---|---|
| `id` | string | 否 | 清单项唯一 ID |
| `taskId` | string | 否 | 所属 Task ID，必须存在 |
| `label` | string | 否 | 非空材料名称，例如“PDF 报告”“源代码” |
| `state` | string | 否 | `pending` 待准备、`prepared` 用户已确认准备 |
| `sourceNoticeId` | string 或 null | 是 | 材料要求来自哪条通知；人工添加且无来源时为 null；非空时须存在并在所属 Task.noticeIds 内 |
| `confirmedAt` | 带偏移时间字符串或 null | 是 | 当前 prepared 状态的用户确认时间；pending 时为 null，退回 pending 时清空 |

一个 Task 可以有多个 ChecklistItem；材料列表通过 `taskId` 关联，不把整份清单重复存到 Task 里。用户确认提交记录到任务状态及后续 Operation，ChecklistItem 不另设 submitted 状态。

## 8. 关联与保存前应检查的规则

1. 各类 ID 不重复，必需文本非空，字段类型和枚举合法。
2. Task.noticeIds 全部能找到对应 Notice；清单的 taskId 和非空 sourceNoticeId 有效。
3. 截止精度与两个日期字段符合第 5 节，日期是真实有效的日历日期。
4. 时间戳带明确偏移；createdAt 不晚于 updatedAt，不能用发布时间代替导入时间。
5. version 为正整数；remainingMinutes 为 null 或非负整数；未知工时不以 0 表示。
6. prepared 材料有 confirmedAt，pending 材料的 confirmedAt 为 null。
7. 来源通知和材料要求可以追溯；用户自行修改的内容不反向篡改原通知。
8. 真正新增、修改、删除仍遵守总纲的方案与确认机制，不能因为 JSON 结构合法就跳过用户确认。

上述是接口与校验要求，不代表当前已经有运行中的校验器或存储实现。

## 9. 两条示例如何阅读

示例文件为 [fixtures/task-samples.json](../fixtures/task-samples.json)。根层的 `fixtureFormatVersion`、`description`、`samples`，以及每条中的 `sampleId`、`userConfirmedInputs` 是样例说明结构，不是 Notice/Task/ChecklistItem 字段，也不是可直接替换正式 task-store.json 的完整业务快照。

每条样例包含一条 Notice、一条由用户确认保存的 Task 和两条 ChecklistItem。样例采用固定的 2026 年 11 月日期，与项目开发进度无关；样例不来自真实同学或真实平台。

| 样例 | 重点 | 预期理解 |
|---|---|---|
| `exact-deadline` | 数据库实验报告，明确 2026-11-06 23:59 截止 | exact，dueAt 有值，deadlineDate 为 null；两项材料 pending，任务 todo |
| `date-only-deadline` | 高等数学作业，2026-11-08 当天提交 | date_only，deadlineDate 有值，dueAt 为 null；一项材料 prepared、一项 pending，任务仍 in_progress |

示例中的优先级与剩余工时来自 `userConfirmedInputs`，不是根据通知臆测。第二条的材料准备时间是人为构造的用户勾选记录，version 为 2；第一条为初次保存状态，version 为 1。

unknown 的字段组合见第 5 节，缺项追问、补充通知及重复导入等回归样例在后续任务继续扩充，本次维持两条核心示例。

## 10. 与 A、B、D 的对齐内容

| 成员 | 请共同检查什么 | 对齐后如何使用 |
|---|---|---|
| A | 页面能否表达 null、当天到期、来源和材料准备/任务提交的不同状态 | 页面使用相同字段，不自行补日期或工时 |
| B | 模型提取草案能否映射到字段，kind/priority 草案是否适合工具协议，缺项如何追问 | 模型输出先校验成草案，查询与正式提交使用约定接口 |
| D | 卡片、语音转写与反馈能否表达两类日期和清单状态 | 草图和交互样例使用相同名称与状态 |
| C | 根据共同反馈维护类型、关系、样例与保存约束 | 在 T08、T14、T16、T22 中逐步实现并提供验证记录 |

T03 资料交付：三类字段表、两条关联样例、本地保存方案均已提供。A、B 的实际评审意见与两端验证结果在发生后记录，不预先标记通过。

## 11. T08 存储基础接续（2026-10-23）

共享客户端已添加 LocalStore 和 SessionStore 基础接口，详见 [T08 实现与验证](setup/T08-本地存储基础与验证.md)。它们返回 success/data/errorCode/message，并对候选快照作基本结构与引用校验；save(candidate, expectedRevision) 返回真实已保存内容。

当前未提供任务 Repository、完整日历校验、operationId 或确认记录校验；不得将基础 save 直接作为模型写入工具。全局业务 revision、单任务 version、会话文档自身 revision 与 schemaVersion 仍需分开使用。

2026-10-28 会话接口补充：SessionDocument 新写入使用 schemaVersion=2，支持文本、回答、追问、工具调用数组与结构化结果；旧 v1 在内存中兼容读取，明确保存后才升级。完整字段、合成样例、调用关联和备份兼容见 [会话消息约定](session-message-contract.md)。业务快照的 schemaVersion 仍为1；不代表多轮网关或 T16 确认协议已实现。

2026-10-29 收尾：LocalStore 与 SessionStore 保存前共用有限 JSON 校验，保留集合也拒绝 NaN/Infinity、undefined、函数、BigInt、Date、循环引用及超过64层的对象/数组嵌套，非法候选返回 INVALID_ARGUMENT 且不调用 FilePort。合法的 0、false、null、中文与 emoji 原样保存，不在此补做未来集合的业务校验。新版会话同源双端回归与106项主机检查已通过，见 [T08 本轮证据](setup/evidence/t08-closeout-20261029.json)；[B 对467a65c的普通评论复查](https://github.com/jfZhang1226/campus-ddl-agent/pull/5#issuecomment-6487027103)已确认无剩余修改项并接受会话契约。本次同步 main 的 T04/T10 并保留对话和诊断入口，存储内核、codec 与诊断不变，组合入口检查另行记录，最终验收及合并确认仍待完成。ChecklistItem.state 继续按本文的 pending/prepared 约定；任务提交仍由 Task/Operation 表达，不在本次为清单添加 submitted。
