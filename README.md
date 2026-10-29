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

## C 的 T03 交付

- [核心数据字段说明](docs/data-contract.md)：Notice、Task、ChecklistItem 的字段、关联与校验规则。
- [两条人工构造示例](fixtures/task-samples.json)：明确截止时刻、仅有截止日期两种情况。
- [本地保存思路](docs/local-storage-plan.md)：存储组织、读写恢复流程和 T08 待验证事项。

## C 的 T08 存储基础（复查通过，待合并确认）

`feat/c-t08-local-store` 已普通合入 `main@f34865a`（包含 T07 网关、T04 原型资料和 T10 文本接入），实现共享文件适配、LocalStore、会话存储、备份与显式恢复，并提供隔离人工数据的开发验证页；[T08 草稿 PR #5](https://github.com/jfZhang1226/campus-ddl-agent/pull/5) 面向 `main` 交付。2026-10-29 收尾补齐业务快照的有限 JSON 校验，13个核心 TS 文件严格检查、106项主机检查通过；同一源码 `a9b5310` 在 Android 一加 Ace 3 和鸿蒙 Pura 70 完成新版结构化会话、v1 升级失败保护、实际停止进程后冷启动及离线读取回归，两端网络已恢复。[会话消息约定](docs/session-message-contract.md)、[完整记录](docs/setup/T08-本地存储基础与验证.md)和[本轮结构化证据](docs/setup/evidence/t08-closeout-20261029.json)区分旧版与本次验证。A 原范围通过；[B 对467a65c的普通评论复查](https://github.com/jfZhang1226/campus-ddl-agent/pull/5#issuecomment-6487027103)确认无剩余修改项，并接受会话契约及后续任务边界。本次同步保留 T10 文本页与 T08 存储验证入口，存储内核、codec 和诊断不变；新增组合入口的检查另行记录；最终验收及合并确认仍待完成，PR 保持草稿、未合并。

本分支已同步 main 的 T07 最小模型网关（`server/`）和 T10 文本对话；主入口为 T10，共享网关设置页保留 T08 存储开发验证入口。T10 消息与配置仍仅在内存中，尚未接入 T08 持久化或 T11 历史；任务业务与语音也未接入本分支页面。T08 技术复查通过与最终验收、合并确认分别记录，模型调用能力见 [T07](docs/setup/T07-B最小模型网关与接口约定.md)，存储样例不代替模型验证。
