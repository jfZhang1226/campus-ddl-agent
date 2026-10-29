# T08：会话消息与旧数据兼容

负责人：C。初稿日期：2026-10-28，状态更新：2026-10-29。对应 [B 首轮评审](https://github.com/jfZhang1226/campus-ddl-agent/pull/5#issuecomment-6439135644)及[对467a65c的最新普通评论复查](https://github.com/jfZhang1226/campus-ddl-agent/pull/5#issuecomment-6487027103)。**B 已确认接受会话存储契约，复查无剩余修改项；这不代表网关 history 请求协议已经冻结或实现。PR #5 保持草稿、未合并，待最终验收及合并确认。**

## 1. 结构版本与消息字段

- 业务 `task-store` 的 `schemaVersion` 仍为 **1**。
- 会话 `SessionDocument` 新建/成功保存使用 **2**，读取支持 **1、2**。会话自身 `revision` 与全局业务 revision 独立。
- `session` 元数据和 `messages` 的顺序、ID、时间保持。读取不会修改磁盘或增加 revision。

`Message` 对应 [StorageModels.ts](../client/entry/src/main/ets/domain/StorageModels.ts)：

| 字段 | 类型及要求 |
|---|---|
| id / sessionId | 消息 ID 在会话内唯一；sessionId 必须与文件元数据一致 |
| role | user / assistant / system / tool |
| type | text / answer / clarification / tool_calls / tool_result / legacy_tool |
| text | string 或 null；只有工具调用/结果消息允许 null，旧工具摘要保留 string |
| calls | 必填数组，每项 `{id, action, params}`；params 必须是 JSON 对象 |
| results | 必填数组，每项 `{id, action, params, success, data, errorCode, message}` |
| toolName / toolResultSummary | string 或 null；兼容旧版的展示提示，不代替 calls/results |
| status | 保留非空字符串校验；细分状态仍由 A/B/C 在 T11 前对齐，不推定工具成功 |
| createdAt | 带偏移的时间字符串 |

| type | role 与内容约束 |
|---|---|
| text | user/system/assistant；text 为 string，可用于尚未完成的文本显示 |
| answer / clarification | assistant；text 非空；calls/results 为空 |
| tool_calls | assistant；calls 非空，results 为空；text 可为 null |
| tool_result | tool；results 非空，calls 为空；text 可为 null |
| legacy_tool | assistant/tool；仅供旧工具摘要回看，calls/results 为空，不具有可重放调用身份 |

消息 `status=completed` 只表示这条历史记录阶段结束，**不等于工具 success=true，更不等于任务已经提交**。工具真实成功/失败以 results 的结构化字段为准。

## 2. 结构化调用与结果

完整的[合成 v2 会话](../fixtures/sessions/message-v2.json)包含“用户输入 → clarification → 用户补充 → 两个 tool_calls → 一条成功结果和一条失败结果 → answer”。它是存储检查样例，没有调用模型或真实 Repository，也不证明多轮网关已实现。

调用直接沿用当前网关返回的规范化形态 `calls: [{id, action, params}]`，不在存储层解析服务商 `function.arguments`。无文本的回合用 `text:null`，不伪造一句模型回答。clarification 的 question 由接入层映射到 Message.text，并显式保留 type。

结果规则：

- id/action/params 与同一会话中**先前记录的调用**一致；params 按 JSON 内容比较，不因对象键顺序不同而失败。
- 调用 ID 在该会话中唯一；每个调用最多保存一份完成结果。并行结果可按实际完成顺序保存，不要求与 calls 数组同序。未完成的 calls 可以先保存，不能伪造结果补齐。
- success=true 时 errorCode=null；data 可为任意有限 JSON 值，包括对象、数组、字符串、0、false、空字符串和 null。
- success=false 时 data=null、errorCode 为非空字符串；message 始终为 string。业务失败所需的更多上下文应先与 B/C 明确契约，不能把失败数据冒充成功查询结果。
- 调用 ID 是历史关联标识，**不是 operationId**。Agent 若产生另一轮调用，应使用新的调用 ID；单次执行的网络重试不应重复追加完成结果。真实业务重试仍需 T16 的 operationId。

保存前拒绝 NaN/Infinity、undefined、函数、BigInt、Date、循环引用和超过64层的对象/数组嵌套，避免 JSON.stringify 将输入悄悄替换/丢失。调用方应传已解析的 JSON 数据。非法候选返回 INVALID_ARGUMENT，不触碰文件；磁盘中的非法结构返回 CORRUPT_DATA 并保留字节。

## 3. v1 兼容与升级

使用提交前版本的[合成旧会话](../fixtures/sessions/message-v1.json)验证真实文件兼容，未为旧版补造新字段后再当旧数据测试。

1. 读取合法 v1 时，只在内存副本中转换为 v2，revision 不变。普通旧文本成为 type=text；role=tool 或带工具提示的 assistant 成为 legacy_tool，保留原文、toolName 和 toolResultSummary，calls/results 为空。
2. 不从旧摘要猜测调用 ID、参数、执行成功或实际提交结果。legacy_tool 用于回看，不能作为完整 tool_result 发送上游；历史重放由 B 选择合适的转换/上下文策略。
3. 下一次明确调用 save，并通过 expectedRevision 检查后，才按原有临时文件、备份及最后替换流程写入 v2、revision+1。备份保留上一份 v1 **原始字节**；写入/刷新/备份/替换失败时主文件仍是旧版，候选与有效备份按原规则保留。
4. v1 备份可在显式恢复时使用。恢复返回内存 v2，但磁盘恢复的是备份原始 v1 字节，不把恢复伪装成一次新提交。再次成功保存才升级。
5. 未知 schemaVersion（如3）返回 UNSUPPORTED_SCHEMA，主文件保留，即使存在 v1 备份也不允许静默降级。v2 也不再保证旧应用可读；不能用旧二进制直接覆盖新版会话。
6. 未约定的附加 JSON 字段继续保留。v1 若已带 type/calls/results 这些新版保留字段，不猜测它们的协议，报告 CORRUPT_DATA 并保留原文件，交由明确迁移处理。

业务快照、应用级队列、路径和真实文件适配保持原有行为。通用快照引擎由具体 codec 校验支持的结构版本，因此合法的空 v2 会话不会被业务版号1误拒绝。

## 4. 对 B/A 的接入边界

- 继续使用 SessionStore.read/save/list/recoverBackup 和 success/data/errorCode/message；读取 v1 后拿返回的 v2 及相同 revision 继续编辑。
- 返回候选无效、版本冲突、恢复判断时保留用户输入；工具失败的结构化结果可以正常保存为一条历史，不把它当作会话文件保存失败。
- 当前网关仍没有 history/messages 入参，本 PR 不修改 server。存储消息需经接入层转换后送模型，不直接把整个 SessionDocument（含本地元数据）当模型 messages；调用配对、截断、旧工具摘要和系统消息策略需 B 复查确定。
- T07 文档中有 clarification 示例，当前网关实际实现没有独立 clarification 返回分支；本存储格式已预留并校验该回合，不声称网关已经返回它。
- 工具名由 B/C 按 T03/T14 对齐；当前 codec 不把 action 字符串当已授权工具，也不执行调用。网关错误和存储/业务错误由 Agent 分流，不在持久化层统一重试。
- operationId、Proposal、用户确认、版本冲突重新确认和真实业务提交仍归 T16/T17。本次不会把基础 save 暴露为模型工具。

## 5. 验证记录

2026-10-28 首轮修正运行 `node scripts/test-storage.cjs`：10个核心 TS 文件严格检查、76项主机真实文件/受控故障检查通过。其中原26项保留，新增50项覆盖结构化往返、JSON值、关联/角色/空值检查、v1读取不改字节、明确升级与备份、升级失败重试、并发冲突、v1恢复及未知版本保留。主机检查不代替鸿蒙/Android 设备结果。

鸿蒙未签名 HAP 与完整 ACE Android arm64 APK 构建通过，APK 六项适配库和 v2 调试签名校验通过。两端此前导出的 v1 人工会话还在主机离线解码核对，原字段、revision 和原始字节保持；没有重新安装或操作手机。

上述首轮构建及主机兼容检查绑定源码 3cc7200，见 [T08 第13节](setup/T08-本地存储基础与验证.md#13-2026-10-28-b-评审后的会话结构修正)及[首轮机器可读记录](setup/evidence/t08-message-compat-20261028.json)；2026-10-27 设备结果只对应旧提交 f79cb62。

2026-10-29 收尾源码固定为 a9b5310，13个核心 TS 文件严格检查、106项主机检查通过。原76项保留，新增30项覆盖 LocalStore 四个保留集合的非 JSON 拒绝、循环输入不改旧主文件/备份、合法值保留及会话诊断真实文件往返。LocalStore 与 SessionStore 现共用 JsonValues 预检查，防止 stringify 静默丢字段或替换数值。

同一源码的完整 ACE Android APK 与签名鸿蒙 HAP 构建、安装成功。一加 Ace 3（Android16/API36）和 Pura 70（原生 API26）均完成：v1 revision7 读取不改字节、真实替换失败保留原 v1 主文件/备份、重试保存 v2 revision8；七条结构化消息、两个调用及成功/失败结果完整往返；实际停止进程后确认无进程，再冷启动并在无默认网络下全量读取。两端实际文件缺失错误码均为13900002；网络恢复原状态。独立导出的 v1 原始备份、升级后会话、结构化会话与业务人工 JSON 四份文件在两端逐字节一致。

源码核对、产物/人工文件哈希及截图见 [T08 第14节](setup/T08-本地存储基础与验证.md#14-2026-10-29-收尾与新版双端回归)和[本轮机器可读记录](setup/evidence/t08-closeout-20261029.json)。没有执行真实模型请求、Hypium、仪器测试、提交中途杀进程或断电。B 对467a65c复查通过后，仅同步 main 的 T04 资料、保留文档索引双方章节并更新评审状态，运行源码仍为受测a9b5310；详见 [T08 第15节](setup/T08-本地存储基础与验证.md#15-2026-10-29-b-复查通过后同步最新-main)。B 的结论是普通评论，不记作平台正式Approve；PR #5 保持草稿、未合并，待最终验收及合并确认。
