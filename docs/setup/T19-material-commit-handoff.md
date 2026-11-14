# T19 接入发现：材料清单尚未进入 T16 提交能力

日期：2026-11-12。源码依据：T13@5cf6d0d、T16@d38bfe7。本项是跨模块接口缺口，不据此否定T16已明确限定的任务create/update范围，也不直接修改C的数据契约。

2026-11-14更新：C已在T16@bf8ec3a补齐创建型材料，D复查批准；D现已在独立导出接入确认保存、原方案重试、恢复及实际回读，232项主机/导出检查通过。电脑SDK已恢复，3fb5677同源新导出ArkTS/HAP构建成功；新包未签名/未安装，尚无手机验证。详见[最新确认保存记录](T19-confirmed-save-validation.md)。以下保留当时交接基线。

## 当前接口的区别

- T13的NoticeImportRepository.create会在一个快照创建Notice、Task与ChecklistItem；但没有T16的持久方案、受信确认和operation回执。
- T16的TaskChangeDraft仅含action/taskId/expectedVersion/draft，ProposalDraft含notices/changes；CommitEngine.apply目前只创建/编辑Task、增加Notice、更新方案和回执，没有新增ChecklistItem的路径。
- 因而T19不能把T13材料静默丢掉后只提交Task，也不能在T16成功后另调基础save补写材料；后者会破坏要求的一致提交与重试语义。

## 请 A/B/C 对齐的最小能力

1. C：确认是否在T16后续增量支持创建型材料条目。具体字段由C现有契约细化；任务/材料/来源、方案applied和操作回执须在同一快照提交。新增材料默认pending，不能由模型自称已准备或已提交。
2. C/B：说明材料如何绑定预留的新Task ID与Notice ID，非法字段和不支持的变化明确拒绝；同operation重试不能重复生成材料。范围若暂不包含材料变更，工具层应明确报不支持。
3. A/B：确定T13编辑稿转受信ProposalDraft的入口；客户端按屏幕所见内容确认，模型不得获得confirm/apply能力。修改后的旧确认失效，失败保留卡片，回读真实任务/材料再显示成功。
4. D：能力齐备后以同一条合成通知复测“2材料→修改/清空→确认→重复点击→失败重试→冷启动回读”；卡片播报只能依据实际状态表达。

## 本轮处理

只在独立T19联调导出中接只读NoticeCommitGate，保存按钮标注“正式保存待接通”并禁用。程序直接调用confirm同样拒绝，原文和材料保留；没有生成正式任务或伪造回执。这个处理不是完整T19验收，也没有移除产品的保存要求。
