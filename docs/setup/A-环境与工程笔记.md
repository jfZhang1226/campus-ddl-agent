# T01：A 的环境与工程笔记

负责人：A。检查日期：2026-10-20。依据：总纲 T01/T06。检查基线：`43cf456`，任务分支：`docs/a-t01-environment`。

本机首轮环境核查、跨端工程结构阅读和下一步操作整理已完成；环境尚未齐备，T06 两端构建安装未开始。其他成员的设备条件仍待汇总。本文件使用路径占位符，本机安装绝对路径保留在仓库外的本地核查记录中。

**后续更新：** 已按用户授权补齐核心工具，见 [环境安装与复核](T01-环境安装与复核.md)。ArkUI-X/Android/JDK 与 ACE 路径已配置，OHPM 问题确认为当前进程缺少 OS 变量并已通过激活脚本解决。以下保留首轮检查快照，最新安装状态以前述复核记录为准。

## 1. 结论与缺项

DevEco Studio 和鸿蒙基础工具已经安装，配置 CLI 安装根目录后可以查询设备和模拟器。当前阻塞共享模板验证的主要问题是：

1. 未发现已配置的 ArkUI-X SDK 和 ACE Tools，`ace` 命令不可用。
2. 未发现 Android Studio、Android SDK、adb 和 sdkmanager 的可用安装或配置。
3. 鸿蒙存在 4 个已停止的模拟器配置，但未检测到已下载镜像，协议状态为未同意，当前无连接中的设备。
4. OHPM 的 Windows `.bat` 启动脚本查询版本出现递归栈错误；直接用随 Studio 提供的 Node 运行 `pm-cli.js` 可成功返回版本，需在依赖安装和 ACE 接入前解决启动入口问题。
5. 尚未选定经过两端验证的 DevEco / ArkUI-X / SDK / Android AGP / Gradle / JDK 版本组合。

“未发现”的范围为当前进程和用户/系统环境变量、已安装软件注册信息、默认目录、已知开发工具目录及 IDE 的相关配置，不代表全盘任意自定义位置一定不存在。

## 2. 本机检查结果

| 项目 | 实测结果 | 当前判断 |
|---|---|---|
| 系统 | Windows 11 24H2，build 26100.6584，AMD64 | 可继续准备 Windows 工具链 |
| 硬件 | AMD Ryzen 7 8845HS，16 逻辑处理器，约 31.3 GiB 内存 | 已记录；模拟器启动性能未测试 |
| 磁盘 | 检查时 C 盘约 48.1 GiB、D 盘约 152.9 GiB 可用 | 建议后续 SDK/镜像放在空间较充足且受支持的路径 |
| 虚拟化 | VirtualizationFirmwareEnabled=true，HypervisorPresent=true | 不能由此直接断言模拟器启动成功 |
| DevEco Studio | 26.0.0.821，build 261.23567.138.36.2600821 | product-info 与软件注册信息一致 |
| 鸿蒙 SDK | HarmonyOS 26.0.0，API 26，组件 26.0.0.105 Release | 来自 SDK 清单；不等于 ArkUI-X SDK |
| hdc | 3.2.0f；设备列表返回 `[]` | 工具能运行，目前无在线设备 |
| Hvigor / OHOS plugin | 均为 6.26.4；Hvigor 版本命令通过 | 工具存在，尚无工程构建验证 |
| OHPM | 26.0.0.630；Node 入口通过，`.bat` 入口失败 | 部分可用，需处理启动脚本问题 |
| Studio 自带 Node | v24.14.1 | 版本命令通过 |
| 全局 Node / npm | v24.18.0 / 11.16.0 | 版本命令通过；后续固定实际用于构建的 Node |
| deveco-cli | 1.3.0-stable | 设置 Studio 路径后，设备/模拟器清单命令通过 |
| Studio 自带 JDK | JBR/OpenJDK 25.0.2，javac 25.0.2 | 直接路径执行通过；终端无全局 java/JAVA_HOME |
| 鸿蒙 Emulator | 26.0.0.400 | 可查询清单；未启动实例 |
| ArkUI-X SDK / ACE Tools | 已检查位置未发现 SDK；PATH 与 npm 全局模块中无 ace | 按缺项准备，版本待选择 |
| Android Studio | 注册信息与常见安装目录未发现 | 按缺项准备；IDE 本身和 SDK 分别核查 |
| Android SDK / adb / sdkmanager | 无对应环境变量，默认 SDK 目录不存在，命令不可用 | Android 构建和安装条件尚未具备 |
| Gradle | 无全局命令，无项目 wrapper | T06 使用实际模板的 wrapper，不单独要求全局安装 Gradle |
| Git | 2.55.0.windows.2 | 工作区基线和远端 main 一致 |

自带 JDK 25 不能直接标记为 Android 构建环境通过。Gradle 官方矩阵中，Java 25 运行 Gradle 的支持从 9.1.0 开始；Android 的 JDK 还需要与模板的 AGP 和 wrapper 一起核对。后续若模板不兼容，配置适配它的独立 JDK，不改动 Studio 自带运行时。[Gradle 兼容矩阵](https://docs.gradle.org/current/userguide/compatibility.html)、[Android 构建 JDK 说明](https://developer.android.com/build/jdks)。

## 3. 鸿蒙设备与模拟器

| 配置名称 | 类型 | 报告的系统 | 状态 |
|---|---|---|---|
| Pura 90 Pro | phone | HarmonyOS 7.0.0(26.0.0) | stopped |
| Mate X7 | foldable | HarmonyOS 7.0.0(26.0.0) | stopped |
| MatePad Pro 13 | tablet | HarmonyOS 7.0.0(26.0.0) | stopped |
| MateBook Pro | 2in1 | HarmonyOS 7.0.0(26.0.0) | stopped |

`emulator image list` 报告没有匹配的已下载镜像；配置所引用的镜像目录也不存在。实例名称和配置可列出，不代表镜像、启动和安装已验证。模拟器全局配置中的两项协议均为 `disagree`，下载/启动前由用户在官方界面阅读并接受所需协议。

T06 优先选择一个手机目标验证。若使用真机，先记录系统/API、调试连接及签名条件；若使用模拟器，先补齐一个与 SDK 匹配的镜像并验证启动。其他成员设备仍需补充，不虚构为可用。

## 4. CLI 路径识别与复核命令

本机原先只配置了自定义名称的 Studio 变量和 `bin` 的 PATH 项；它们没有让 deveco-cli 自动发现安装。检查已安装 CLI 的解析逻辑后，使用它支持的 `DEVECO_CLI_STUDIO_PATH`，指向 **Studio 安装根目录**，即可恢复查询。本次仅在检查进程中设置，没有修改用户或系统的永久环境变量。

先将下列路径占位符替换成自己的安装根目录，再在 PowerShell 中执行：

```powershell
$studioRoot = '<DevEco Studio 安装根目录>'
$env:DEVECO_CLI_STUDIO_PATH = $studioRoot

devecocli --version
devecocli device list --format json
devecocli emulator list --format json
devecocli emulator image list --format json

& (Join-Path $studioRoot 'jbr/bin/java.exe') -version
& (Join-Path $studioRoot 'jbr/bin/javac.exe') -version
& (Join-Path $studioRoot 'tools/node/node.exe') --version
& (Join-Path $studioRoot 'tools/node/node.exe') (Join-Path $studioRoot 'tools/ohpm/bin/pm-cli.js') --version
& (Join-Path $studioRoot 'tools/node/node.exe') (Join-Path $studioRoot 'tools/hvigor/bin/hvigorw.js') --version
```

设备/模拟器程序在受限沙箱内最初返回 `spawn EPERM`；相同只读命令在允许执行这些程序的环境下正常返回。因此本记录区分了执行权限限制和安装缺项。OHPM `.bat` 的递归问题在沙箱外也复现，不能归为同一类权限问题。

## 5. 跨端工程结构阅读

已阅读官方 ArkUI-X 工程结构、环境配置和 ACE Tools 说明。核心认识是：共享 ArkTS 页面和资源由同一工程编译，Android 平台目录承接原生入口、权限、Gradle 与打包配置；不能另写一套 Android 业务页面。[官方工程结构](https://github.com/arkui-x/docs/blob/master/zh-cn/application-dev/quick-start/package-structure-guide.md)。

结合现行总纲，拟采用以下目录草图；实际文件以选定版本的真实模板为准：

```text
campus-ddl-agent/
├── client/                         # T06 创建，目前不存在
│   ├── .arkui-x/
│   │   ├── android/                # Android 平台工程和 Gradle wrapper
│   │   └── arkui-x-config.json5    # 跨端模块配置
│   ├── AppScope/
│   ├── entry/src/main/ets/
│   │   ├── pages/                  # A：共享页面
│   │   ├── components/             # A/D：卡片和交互组件
│   │   ├── adapters/               # 各端必要能力适配
│   │   ├── agent/                  # B：Agent 编排
│   │   ├── data/                   # C：LocalStore、Repository
│   │   └── domain/                 # C：日期与排程规则
│   ├── build-profile.json5
│   ├── hvigorfile.ts
│   └── oh-package.json5
├── server/                         # B 后续实现
├── docs/
└── fixtures/
```

## 6. 补齐顺序与下一步操作

### 6.1 先固定可复现的工具链组合

1. 保留当前 Studio 安装，先检查此版本可用的 ArkUI-X 设置入口及对应 SDK 获取渠道。
2. 从官方发行说明选择能支持目标鸿蒙版本与 Android 的 ArkUI-X SDK，记录它要求的 Studio、SDK/API 和 ACE 版本。不能用已安装的普通鸿蒙 API 26 SDK 推断跨端兼容。
3. 若当前 Studio 不支持所选 SDK，按其配套说明准备独立版本，保留现有安装。公开快速指南含旧版示例，不能把示例中的 API 数字当作本项目已选版本。

官方支持通过 Studio 的 ArkUI-X 设置或发行说明获取 SDK；下载后再核对实际版本和目录结构。[SDK 获取说明](https://github.com/arkui-x/docs/blob/master/zh-cn/application-dev/tools/how-to-use-arkui-x-sdk.md)。

### 6.2 准备 Android 与 ACE

1. 从 Android 官方渠道安装 Android Studio，或准备完整的命令行 SDK 路径。针对本组需要图形化配置与模拟器的情况，优先使用 Studio 的 SDK Manager。[官方下载入口](https://developer.android.com/studio)。
2. 准备 platform-tools、command-line tools，以及实际模板要求的 SDK Platform 和 Build Tools；需要模拟器时增加 emulator 和一个系统镜像。NDK/CMake 是否需要及版本由所选模板决定。
3. 配置 ANDROID_HOME 和 platform-tools 路径，核查 `adb version`、`sdkmanager --list_installed`、`adb devices -l`。
4. 按模板的 AGP/wrapper 选择构建 JDK，记录版本。没有全局 Gradle 命令本身不作为阻塞项。
5. 将所选 ArkUI-X SDK 随附的 ACE 入口加入当前环境，先检查帮助和版本，再配置实际路径并执行 `ace check -v`。

ACE 的路径配置参数包括 `--deveco-studio-path`、`--arkui-x-sdk`、`--android-sdk`、`--java-sdk`、`--ohpm-dir`；具体值与可用参数按安装版本的帮助核对。[ACE 官方命令说明](https://github.com/arkui-x/cli)。

### 6.3 处理 OHPM 与鸿蒙运行目标

- 在安装依赖前排查当前 OHPM `.bat` 递归问题，包括启动参数和实际工具版本；直接 Node 入口已验证可查询版本，但它不等于 ACE 调用 OHPM 已通过。
- 由用户阅读并接受官方协议后，获取一个匹配的鸿蒙手机镜像，或连接符合条件的真机。复查设备列表并记录系统版本和调试可用性。
- 若采用模拟器，实际启动后再记录虚拟化和图形兼容结果；本次没有启动、下载镜像或更改协议状态。

### 6.4 T06 的创建与验证步骤草案

在环境检查通过后，从最新 main 建立 T06 分支，使用真正的 ArkUI-X 应用模板创建 `client/`；ACE 路径可使用 `ace create client`，选择 HarmonyOS 及匹配 SDK，并核对所选平台模板能否由 Studio 打开。普通 `devecocli create` 生成的鸿蒙项目不能直接算作跨端工程。

随后检查共享页面与 `.arkui-x/android/`，读取实际模板的 AGP、Gradle wrapper 和 SDK 配置；分别构建、安装、启动鸿蒙与 Android 模板，记录同一提交、命令、版本、设备、产物和截图。ACE 支持分别构建 HAP/APK；命令以所装版本帮助为准，当前没有执行 `ace create` 或 `ace build`。[ACE 创建与构建说明](https://github.com/arkui-x/cli)。

## 7. 本次交付边界与完成核对

- [x] 记录本机已有工具、实际版本、设备/模拟器配置与缺项。
- [x] 解释 CLI 无法自动发现 Studio 的原因，并验证临时路径配置。
- [x] 阅读共享工程与平台目录关系，提供目录草图和创建步骤。
- [x] 给出按依赖排序的补齐、复核及 T06 操作计划。
- [ ] 补齐 ArkUI-X / Android 工具链与匹配构建 JDK，处理 OHPM 启动入口。
- [ ] 汇总其他成员设备条件，确定两端运行目标。
- [ ] T06：同一套模板在两端构建、安装、启动并留下证据。

本次为 T01 本机首轮核查和资料交付；工具链与两端模板运行不能提前标记通过。未安装软件、修改永久环境变量、接受协议或申请签名。
