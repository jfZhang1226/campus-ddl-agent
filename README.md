# campus-ddl-agent

校园通知与 DDL 管理 Agent，使用 ArkUI-X 共享核心业务与 UI 代码，面向鸿蒙和 Android 两端。

## 项目文档

- [文档索引与当前进度](docs/README.md)
- [项目设计与开发总纲](docs/校园通知与DDL管理Agent_项目设计与开发总纲.md)：项目范围、架构、T01～T45 和验收依据。
- [四人分工与交付清单](docs/校园通知与DDL管理Agent_四人分工与交付清单.md)：A、B、C、D 的工作、产出和配合关系。
- [GitHub 四人协作方案](docs/校园通知与DDL管理Agent_GitHub四人协作方案.md)：分支、PR 和评审操作。

## A 的 T01 环境检查

- [环境与工程笔记](docs/setup/A-环境与工程笔记.md)：已核查本机 DevEco Studio、鸿蒙工具与设备条件，整理 ArkUI-X、Android、镜像及 OHPM 启动入口缺项，附共享工程目录草图和下一步操作。
- [环境安装与复核](docs/setup/T01-环境安装与复核.md)：已配置 Studio 26、ArkUI-X API 26 Beta2、Android SDK 与 JDK 17，修复 OHPM 当前进程环境并记录验证与限制。

本机核心工具安装及 ACE 目标环境识别通过；两端模板首次构建也已通过，签名与真机运行状态见 T06。

## A 的 T06 共享工程

- [客户端入口](client/README.md)：真实 ArkUI-X 模板、共享 ArkTS 页面与平台宿主。
- [T06 验证记录](docs/setup/T06-共享工程与双端验证.md)：双端构建结果、版本及待完成验收项。
- [鸿蒙构建与签名](docs/build-harmony.md)、[Android 构建与安装](docs/build-android.md)：可复现命令和设备条件。

鸿蒙已在 Pura 70（7.0.0.109 / 原生 API 26）完成调试签名、HAP 安装、Hello World 和停止后重新启动；Android 已在一加 Ace 3（Android 16 / API 36）通过相同模板验证。源码新目录的双端构建也已复核。T06 经 C 复查通过后，已于 2026-10-27 通过 [PR #4](https://github.com/jfZhang1226/campus-ddl-agent/pull/4) Squash 合入 `main`，提交为 `9f08105`。

### 组员先行使用

T06 基础工程已进入 `main`，供 B、C、D 接入后续模块；原 `feat/a-t06-arkui-x` 分支保留。新任务从最新 `main` 创建任务分支：

```sh
git clone --branch main https://github.com/jfZhang1226/campus-ddl-agent.git
cd campus-ddl-agent
```

已克隆仓库的组员先保存自己的改动，再 `git fetch origin`，同步本机 `main` 后创建个人任务分支；进行中的任务应按协作方案合入最新 `main`，不直接覆盖他人的分支。DevEco Studio 打开 `client/`，在自己电脑配置实际 SDK 与工具路径，按 [客户端说明](client/README.md) 构建。B、C、D 可在共享 `entry/src/main/ets/` 中接入各自模块，平台能力以两端实测为准。

T06 的模板验收不代表 T08 存储或后续业务通过。签名和设备标识只保留在验证者本机；组员需要为自己的设备配置调试签名，见 [鸿蒙构建说明](docs/build-harmony.md)。

## A 的 T10 文本对话

[T10 接入说明](docs/setup/T10-文本对话与网关接入.md)记录两端共享文本页、T07 HTTP 适配、运行时配置、加载/超时/错误和手动重试。T10 已通过 [PR #9](https://github.com/jfZhang1226/campus-ddl-agent/pull/9) 合入 main（`f34865a`）；其既有同源双端真实模型证据按原提交保留，不作为本次 T08 合并入口的新真机结果。内存对话不是持久历史，每次提问仍独立处理。

## B 的 T12 通知提取与多轮补齐

[T12 接入说明](docs/setup/T12-通知提取与多轮补齐.md)记录新增的 `POST /api/agent/extract-notice`：把通知原文提取成 Notice/Task/ChecklistItem 的可编辑草案，缺项追问或标记未知，保留发布时间与来源，多轮通过客户端回传 `draft`+`answers` 确定性合并。实现为 [server/notice_extraction.py](server/notice_extraction.py)（纯逻辑）加网关新端点；主机自测 [server/verify_t12.py](server/verify_t12.py) 66 项通过，并经 [server/.env](server/.env) 真实 DeepSeek 调用通过三条样例（exact/date_only/相对日期缺截止），[草案样例](fixtures/extraction/notice-draft-samples.json) 供 A 的 T13 确认卡对接。

## C 的 T11 会话历史（任务分支）

[T11 接入说明](docs/setup/T11-会话历史与恢复接入.md)记录实际聊天持久化、启动恢复、正式列表/详情、切换/新建与保存重试。2026-11-05 由 C 完成页面、50项T11及既有29/106/85项回归、新目录双端构建和同源一加Ace3/Pura70技术验证；[设备证据](docs/setup/evidence/t11-device-validation-20261105.json)区分人工HTTP与真实模型、正式页与隔离故障检查。现发布任务分支供A/B评审；独立评审和最终验收仍待完成，暂不合并。

2026-11-06 按B评审修正保存失败后的退出：空闲失败时可只读浏览，离开未保存会话需可取消且绑定当前内容/保存尝试的确认。25TS严格、66T11及29/106/85既有回归、新目录双端构建与包核验通过，[主机构建证据](docs/setup/evidence/t11-p2-host-build-20261106.json)绑定修正源码d3e4fd9；[本轮双端新交互与对照](docs/setup/evidence/t11-p2-device-comparison-20261106.json)已完成，分别限定Android真实写失败和鸿蒙持续版本冲突，未用旧包结果代替。原数据与网络保持，人工服务已清理，无真实模型。本轮按授权将修正发布到原PR #14并以普通评论请B复查；暂不合并，独立复查/CI/最终验收另行完成。

## C 的 T16 幂等提交（当前任务分支）

T11 已于2026-11-11经PR #14合入main/3a22a02，以上为交付阶段历史记录。当前从该main推进T16：[接口与验证说明](docs/setup/T16-幂等提交与业务快照.md)。任务创建/编辑方案由客户端明确确认后，将业务变化、方案状态与操作回执一次快照提交；相同operationId重试返回原回执，版本冲突需重新生成并确认。T16不替代T17正式Agent串联或T30关联删除。现按授权发布原任务分支供A/B独立评审，测试/构建与设备结果分别记录，暂不合并。

T16原v1源码3f02e4a已完成29TS严格、56项幂等/确认检查及既有回归，新目录双端构建和包核验通过；[原主机/构建摘要](docs/setup/evidence/t16-host-build-20261111.json)绑定同源106个客户端文件。[原Android](docs/setup/evidence/t16-android-device-20261111.json)与[鸿蒙真机](docs/setup/evidence/t16-harmony-device-20261111.json)均已完成隔离人工确认/取消、受控替换失败/同操作重试、版本不一致阻断和真实冷启动/离线回执；106/110份旧文件保持，网络恢复/保持。[原双端实际文件对照](docs/setup/evidence/t16-device-comparison-20261111.json)的9个对象排除生成ID与审计时间后业务字段一致。这些空材料案例不覆盖后续材料增量。正式页面/Agent联调、独立评审、CI与最终验收仍另行推进；当前发布状态以GitHub PR为准，暂不合并。

2026-11-12按B/D意见在同一T16分支补创建型材料：新建任务的checklistCreates由客户端预留ID，默认pending，与任务/来源/方案/回执一次保存；重复或重启重放原材料结果。新记录使用v2 tag，旧v1继续读取，旧客户端拒绝v2；新生成ID去掉多余task-，旧ID不改。29TS严格、92项T16和既有回归、同源双端构建与包核验通过，见[材料增量摘要](docs/setup/evidence/t16-materials-host-build-20261112.json)。新增路径真机待复验，完整协议与限制见[T16说明第11节](docs/setup/T16-幂等提交与业务快照.md#11-创建型材料及-bd-意见修正2026-11-12)。材料勾选及已有清单编辑仍按T22推进；本次修正尚未推送，PR #15暂不合并。

## C 的 T03 交付

- [核心数据字段说明](docs/data-contract.md)：Notice、Task、ChecklistItem 的字段、关联与校验规则。
- [两条人工构造示例](fixtures/task-samples.json)：明确截止时刻、仅有截止日期两种情况。
- [本地保存思路](docs/local-storage-plan.md)：存储组织、读写恢复流程和 T08 待验证事项。

## C 的 T08 存储基础（复查通过，待合并确认）

`feat/c-t08-local-store` 已普通合入 `main@f34865a`（包含 T07 网关、T04 原型资料和 T10 文本接入），实现共享文件适配、LocalStore、会话存储、备份与显式恢复，并提供隔离人工数据的开发验证页；[T08 草稿 PR #5](https://github.com/jfZhang1226/campus-ddl-agent/pull/5) 面向 `main` 交付。2026-10-29 收尾补齐业务快照的有限 JSON 校验，13个核心 TS 文件严格检查、106项主机检查通过；同一源码 `a9b5310` 在 Android 一加 Ace 3 和鸿蒙 Pura 70 完成新版结构化会话、v1 升级失败保护、实际停止进程后冷启动及离线读取回归，两端网络已恢复。[会话消息约定](docs/session-message-contract.md)、[完整记录](docs/setup/T08-本地存储基础与验证.md)和[本轮结构化证据](docs/setup/evidence/t08-closeout-20261029.json)区分旧版与本次验证。A 原范围通过；[B 对467a65c的普通评论复查](https://github.com/jfZhang1226/campus-ddl-agent/pull/5#issuecomment-6487027103)确认无剩余修改项，并接受会话契约及后续任务边界。本次同步保留 T10 文本页与 T08 存储验证入口，存储内核、codec 和诊断不变；新增组合入口的检查另行记录；最终验收及合并确认仍待完成，PR 保持草稿、未合并。

本分支已同步 main 的 T07 最小模型网关（`server/`）和 T10 文本对话；主入口为 T10，共享网关设置页保留 T08 存储开发验证入口。T10 消息与配置仍仅在内存中，尚未接入 T08 持久化或 T11 历史；任务业务与语音也未接入本分支页面。T08 技术复查通过与最终验收、合并确认分别记录，模型调用能力见 [T07](docs/setup/T07-B最小模型网关与接口约定.md)，存储样例不代替模型验证。

本次 main 同步的组合源码43646d3已通过存储106项/对话29项主机检查、鸿蒙与完整Android构建及原生库/签名检查，见 [集成记录](docs/setup/evidence/t08-main-sync-20261029.json)。未新增真机或真实模型请求；最终确认保留新增组合入口的检查范围，B 对467a65c的结论不当作其已审后续差异。
