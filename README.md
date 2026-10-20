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

本机核心工具安装及 ACE 目标环境识别通过；两端模板构建、签名和真机安装尚未完成，后续在 T06 验证。

## C 的 T03 交付

- [核心数据字段说明](docs/data-contract.md)：Notice、Task、ChecklistItem 的字段、关联与校验规则。
- [两条人工构造示例](fixtures/task-samples.json)：明确截止时刻、仅有截止日期两种情况。
- [本地保存思路](docs/local-storage-plan.md)：存储组织、读写恢复流程和 T08 待验证事项。

当前已有现行设计文档、T01 本机首轮环境检查和 T03 资料初稿。客户端、服务端和两端本地存储尚未实现；示例数据不代表真实模型提取结果或已经通过设备验证。
