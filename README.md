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

鸿蒙已在 Pura 70（7.0.0.109 / 原生 API 26）完成调试签名、HAP 安装、Hello World 和停止后重新启动；Android 已在一加 Ace 3（Android 16 / API 36）通过相同模板验证。源码新目录的双端构建也已复核。T06 已于 2026-10-27 通过 PR #4 合入 main（`9f08105`），不代表后续业务已通过。

### 组员先行使用

当前基础工程和 T07 网关已合入 `main`。组员从最新 main 创建自己的任务分支；A 的 T10 正在 `feat/a-t10-text-chat` 开发，尚未合并：

```sh
git clone https://github.com/jfZhang1226/campus-ddl-agent.git
cd campus-ddl-agent
```

已克隆仓库的组员先保存自己的改动，再 `git fetch origin`，从最新 `origin/main` 创建个人任务分支，保留依赖关系，不直接覆盖他人的分支。DevEco Studio 打开 `client/`，在自己电脑配置实际 SDK 与工具路径，按 [客户端说明](client/README.md) 构建。B、C、D 可在共享 `entry/src/main/ets/` 中接入各自模块，平台能力以两端实测为准。

后续任务仍通过 PR 和相关成员评审交付。签名和设备标识只保留在验证者本机；组员需要为自己的设备配置调试签名，见 [鸿蒙构建说明](docs/build-harmony.md)。

## A 的 T10 文本对话

[T10 接入说明](docs/setup/T10-文本对话与网关接入.md) 记录两端共享文本页、T07 HTTP 适配、配置、加载/超时/错误和手动重试。Android 已在本机人工测试服务下检查页面与错误恢复，修正了键盘避让；实际网关尚未部署，真实模型与鸿蒙真机待联调。内存对话列表不是持久历史，每次提问仍独立处理。

## C 的 T03 交付

- [核心数据字段说明](docs/data-contract.md)：Notice、Task、ChecklistItem 的字段、关联与校验规则。
- [两条人工构造示例](fixtures/task-samples.json)：明确截止时刻、仅有截止日期两种情况。
- [本地保存思路](docs/local-storage-plan.md)：存储组织、读写恢复流程和 T08 待验证事项。

本分支在现行设计文档、T01/T03 资料、T06 模板与 T07 网关基础上开发 T10。C 的存储基础工作独立在 [T08 草稿 PR #5](https://github.com/jfZhang1226/campus-ddl-agent/pull/5) 推进，未引入本次接入；示例数据不代表真实模型提取结果。
