# ArkUI-X 共享客户端

T06 从 ArkUI-X SDK 26.0.0.28 Beta2 随附 ACE 的 `app` 模板创建。主入口保留 `Hello World`，T08 分支增加共享存储基础及开发验证入口，尚未接入模型或任务业务。鸿蒙与 Android 复用同一份 `entry/src/main/ets/` 页面和 Ability；Android Java 文件仅负责承载 ArkUI-X 页面。

## 工程入口

```text
client/
├── entry/src/main/ets/          # 共享 ArkTS 页面与 Ability
├── AppScope/                   # 鸿蒙应用元信息
├── build-profile.json5         # 鸿蒙产品、API 和模块配置
├── hvigor/                     # 固定跨端构建插件版本
└── .arkui-x/
    ├── arkui-x-config.json5     # 跨端模块入口
    ├── android/                # Android 宿主、Gradle wrapper
    └── ios/                    # 默认模板附带；本项目未验证 iOS
```

## 构建与运行

T08 开发验证入口为“T08 存储验证（开发用）”，只写隔离的人工数据目录。2026-10-27 同版源码在 Android 一加 Ace 3 和鸿蒙 Pura 70 完成写入、实际停止进程后冷启动读取、离线读取、七项文件检查及五项保存/恢复失败保护。A 在其范围通过；2026-10-28 会话结构与旧版兼容修正待 B 复查，旧设备结果不当作本轮 v2 消息设备证据。接口与完整证据见 [T08 记录](../docs/setup/T08-本地存储基础与验证.md)和[会话消息约定](../docs/session-message-contract.md)，不要将基础 save 直接暴露为 Agent 写入工具。

先按 [T01 环境记录](../docs/setup/T01-环境安装与复核.md) 配置 ACE、SDK、JDK 17 和 Node/OHPM 路径，在本目录运行：

```powershell
# 鸿蒙：使用已安装的 DevEco CLI 与 Studio 工具链
devecocli build --modules entry@default

# Android：ACE 先编译共享 ArkTS，再复制运行库和资源，最后调用 wrapper
ace build apk --debug --target-platform arm64
```

详细步骤见 [鸿蒙构建与签名](../docs/build-harmony.md)、[Android 构建与安装](../docs/build-android.md)，实际证据与待验收项见 [T06 记录](../docs/setup/T06-共享工程与双端验证.md)。DevEco Studio 打开本目录即可查看共享工程，ArkUI-X SDK 位置按本机环境配置。

不要只执行 Android 的 `gradlew assembleDebug` 来代替完整跨端构建：模板默认关闭独立 Gradle 触发 ArkTS 编译，可能打入旧资源。ACE 自动生成的运行库、跨端资源和包含本机路径的 `buildArkTS` 脚本均已忽略；每台电脑由 ACE 重新生成。`oh-package-lock.json5` 和 Gradle wrapper 属于共享源码。

T08 实测还发现增量构建可能遗漏新增 API 原生库。新增原生 API 或真机出现模块缺失时，先 `devecocli build clean` 再完整 ACE 构建，并从 client/ 执行 `& ../scripts/check-storage-apk.ps1` 检查文件/路由依赖库；不手工修改 SDK 或向源码提交运行库。

当前鸿蒙模板的 `compatibleSdkVersion` 为 API 26（`26.0.0`），本轮使用 API 26 SDK 编译；模板未显式设置 target，构建保留相应提示。接入真机时必须先核对系统/API，不能把编译通过当作该手机可安装的证据。Android 当前为 min API 26、target/compile API 33、arm64 调试包。

2026-10-26 已在 Pura 70（固件 7.0.0.109，原生 API 26）完成调试签名、HAP 安装、Hello World 和强制停止后的重新启动；Android 一加 Ace 3 的相同模板验证已通过。已核对两次设备验证之间 `client/` 无源码差异；本机导出目录只增加个人签名配置，未回写仓库。T06 经 C 复查通过后已于 2026-10-27 通过 PR #4 合入 main；该结果不代表 T08 存储或后续业务通过。

## 模板与许可

工程来自 [ArkUI-X ACE Tools](https://github.com/arkui-x/cli) 的默认跨端模板，保留源文件中的华为版权及 Apache 2.0 声明。模板 Apache 2.0 原文保存在 [third_party/Apache-2.0.txt](third_party/Apache-2.0.txt)；此记录不替项目整体选择许可证。Gradle wrapper 来自模板，Gradle 分发包已对照发布方 SHA-256 校验并固定；Hypium 1.0.6 依赖由 OHPM 锁文件记录。

APK 中 ArkUI-X 的原生库和 Java adapter 来自所选 SDK，由 ACE 在本机打包，不提交二进制运行库。模板自带的测试示例仅保留为模板内容，本次未执行 Hypium 设备自动化测试；两端模板的真实安装运行证据见 T06 记录，不将测试目标编译成功当作业务测试通过。
