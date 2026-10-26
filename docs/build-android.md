# Android 模板构建与安装

负责人 A，T06。已构建并校验 arm64 调试 APK，并在一加 Ace 3 完成安装、显示 Hello World 和重新启动检查。汇总见 [T06 验证记录](setup/T06-共享工程与双端验证.md)。

## 1. 已构建的版本组合

| 配置 | 版本 |
|---|---|
| 共享 SDK | ArkUI-X 26.0.0.28 Beta2 |
| JDK | Eclipse Temurin 17.0.20.1+1 |
| Android Gradle Plugin | 7.4.1，来自 SDK 的 ACE 模板 |
| Gradle wrapper | 8.4，保留模板分发地址，并固定官方 SHA-256 |
| compile/target SDK | 33 |
| 最低 SDK | 26（Android 8.0） |
| Build Tools | 模板显式 30.0.3；本机另有 36.0.0 |
| ABI | arm64-v8a |

此处使用 SDK 自带 ACE 模板，**没有混用 Studio 跨端模板的 AGP 9.1.1 / Gradle 9.4.0**。两套模板的版本不能互相替代。

## 2. 完整跨端构建

先完成 [T01 配置](setup/T01-环境安装与复核.md)，确保 ACE 路径指向匹配 SDK、`JAVA_HOME` 为 JDK 17、`ANDROID_HOME` 指向包含 API 33 与所需 Build Tools 的 SDK。然后在 `client/` 中执行：

```powershell
ace build apk --debug --target-platform arm64
```

ACE 先通过 Hvigor 编译共享 ArkTS，再将共享资源、系统资源、Java adapter 和 arm64 原生运行库放入 Android 宿主，最后调用 Gradle wrapper。生成路径：

```text
.arkui-x/android/app/build/outputs/apk/debug/app-debug.apk
```

首次下载 Gradle 与 Maven 依赖需要网络。本轮实际下载、依赖解析与编译成功，没有为工程添加个人代理。若其他电脑连接失败，按真实网络环境配置本机代理，避免把个人代理地址或凭证提交进仓库。

`buildArkTS` 脚本、`app/libs/` 与 `assets/arkui-x/` 由 ACE 重新生成，已按路径忽略。不要直接用 Gradle 打包已有资源来冒充重新编译了共享源码。iOS 是默认模板附带目录，在 Windows 上没有构建或运行验证。

## 3. 安装包检查与真机运行

本轮 `aapt2 dump badging` 确认包名 `com.campusddl.agent`、min API 26、target API 33、ABI `arm64-v8a`、调试标志和入口 Activity；`apksigner verify --verbose` 确认 v2 调试签名通过。

实际真机：一加 Ace 3，系统报告型号 `PJE110`，Android 16 / API 36，系统版本 `PJE110_16.0.5.701(CN01)`，支持 `arm64-v8a`，内存页大小 4096。`adb install -r` 返回 `Success`，首次冷启动返回 `Status: ok`（1947 ms），停止本应用后再次冷启动也返回 `Status: ok`（988 ms）。截图前后均核对测试应用位于前台，实际看到 Hello World，应用进程仍在运行。此结果只覆盖这台设备及模板页面。

![一加 Ace 3 上的共享 ArkUI-X 模板](images/t06/android-oneplus-ace3.png)

手机开启 USB 调试并允许电脑连接后，执行：

```powershell
adb devices -l
adb -s <实际序列号> shell getprop ro.product.model
adb -s <实际序列号> shell getprop ro.build.version.release
adb -s <实际序列号> shell getprop ro.build.version.sdk
adb -s <实际序列号> shell getprop ro.product.cpu.abilist
adb -s <实际序列号> install -r .arkui-x/android/app/build/outputs/apk/debug/app-debug.apk
adb -s <实际序列号> shell am start -W -n com.campusddl.agent/.EntryEntryAbilityActivity
```

将 `<实际序列号>` 换成查询到的值；设备显示 `unauthorized` 时先在手机允许调试。应用在前台显示 `Hello World` 后记录截图、启动结果及崩溃日志，再退出并重新启动确认。截图仅针对测试页面，设备标识和本机原始日志保留在仓库外。

若手机不支持 arm64，必须根据真实 ABI 重新构建；不能拿构建成功的 arm64 包推断所有 Android 手机兼容。

## 4. 构建中保留的提示

首次构建有 SDK XML 版本提示、Manifest namespace 弃用提示、Gradle 弃用提示，以及部分 SDK 原生库无法 strip 的提示。构建已成功，原生库按原样打包；没有因此安装额外 NDK，也没有把这些提示写成已消除。后续升级工具链需重新验证，真机稳定性仍待检验。
