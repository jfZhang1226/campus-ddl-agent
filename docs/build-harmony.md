# 鸿蒙模板构建、签名与运行

负责人 A，T06。2026-10-26 已补做从提交导出到新目录的未签名 HAP 构建复核；机主升级 Pura 70 后，已实测原生鸿蒙 API 26（Release），HDC 正常；开发者认证、签名、安装和真机启动仍待完成。汇总见 [T06 验证记录](setup/T06-共享工程与双端验证.md)。

## 1. 版本与设备条件

本轮使用 DevEco Studio 26.0.0.821、内置 HarmonyOS SDK API 26（26.0.0.105 Release）、ArkUI-X 26.0.0.28 Beta2、Studio Node 24.14.1、OHPM 26.0.0.630。跨端插件固定为 `@ohos/hvigor-ohos-arkui-x-plugin` 4.24.1，来自此次 ACE 模板。

`client/build-profile.json5` 的 `compatibleSdkVersion` 为 `26.0.0`，本轮使用 API 26 SDK 编译；模板未显式设置 target，构建有相应提示。该默认产品目前要求 API 26 真机；需先读取实际手机系统/API。如果手机低于此版本，必须另行核对并验证最低兼容版本或正式版工具链组合，不能直接宣称支持。Android 兼容要求见另一份构建说明。

2026-10-26 初始接入 ADY-AL10 / HarmonyOS 4.2.0.245 时，仅 ADB 可用、HDC 无目标；其中 Android API 31 属于兼容层，不能与鸿蒙 API 26 直接比较。随后机主自行升级，实测固件为 `ADY-AL10 7.0.0.109(SP6C00E105R5P2)`，原生系统参数为 `OpenHarmony-7.0.0.105` / API 26 / Release，HDC 已正常识别。当前设备版本满足工程要求，无需降低 compatible；仍需完成开发者认证、调试签名及真实 HAP 安装运行，不能仅凭版本匹配认定验收通过。

每次在本机已有终端中构建前加载 T01 配置的环境。尤其要保留标准 Windows `OS=Windows_NT`，并确保 Node/OHPM 与 Studio 路径正确，详见 [OHPM 问题说明](setup/T01-环境安装与复核.md#4-ohpm-启动问题的真实原因)。本机路径记录在仓库外。

## 2. 编译

在 `client/` 中运行：

```powershell
devecocli build --modules entry@default
```

首次自动安装 OHPM 依赖及跨端 Hvigor 插件，随后构建 `entry` 的默认目标。本轮首次也执行过不限定模块的 `devecocli build`，因此生成了模板测试目标；它的编译成功不代表测试已运行。

未配置签名时，正常输出为：

```text
entry/build/default/outputs/default/entry-default-unsigned.hap
```

日志中的 `Will skip sign` 表示没有签名；即使显示 `BUILD SUCCESSFUL`，也不能将未签名 HAP 当作可直接安装的真机包。

## 3. 真机签名与安装（待执行）

1. 手机开启开发者模式和 USB 调试，连接电脑并允许调试授权。
2. 执行 `devecocli device list`，确认设备在线，再用 `devecocli device view` 记录实际系统/API；多设备时按命令帮助指定目标。
3. 使用本人的华为开发者账号登录并为本项目、实际设备配置调试签名。可用 DevEco Studio 的自动签名，或依次执行：

```powershell
devecocli auth login
devecocli signature generate --product default
devecocli run --module entry --device <实际设备序列号>
```

登录需要用户在官方页面完成。签名依赖开发者权限和设备注册结果，不提前承诺成功。CLI 会写入本机密钥、证书和签名配置；不要把签名材料、密码、设备标识及本机绝对路径提交到共享工程。提交前检查 `build-profile.json5`，仓库中保留的是无个人签名材料的模板配置。

## 4. 验收记录

- 使用同一源码提交与 Android 构建。
- 记录手机型号、系统/API、签名配置方式、安装与启动命令、真实输出。
- 确认页面显示 `Hello World`，退出应用后可再次启动。
- 应用在前台时使用 `devecocli ui screenshot --device <实际设备序列号> --path <本机证据目录>` 保存截图，并检查崩溃日志。

目前没有鸿蒙真机运行截图或安装成功证据，以上步骤不能写成已通过。
