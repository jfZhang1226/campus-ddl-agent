# 鸿蒙模板构建、签名与运行

负责人 A，T06。2026-10-26 已完成源码新目录构建复核，并在 Pura 70 / 原生鸿蒙 API 26（Release）上完成开发者登录、调试设备登记、签名、HAP 安装、Hello World 和停止后重启。T06 技术证据已齐，待相关成员评审和最终验收确认。汇总见 [T06 验证记录](setup/T06-共享工程与双端验证.md)。

## 1. 版本与设备条件

本轮使用 DevEco Studio 26.0.0.821、内置 HarmonyOS SDK API 26（26.0.0.105 Release）、ArkUI-X 26.0.0.28 Beta2、Studio Node 24.14.1、OHPM 26.0.0.630。跨端插件固定为 `@ohos/hvigor-ohos-arkui-x-plugin` 4.24.1，来自此次 ACE 模板。

`client/build-profile.json5` 的 `compatibleSdkVersion` 为 `26.0.0`，本轮使用 API 26 SDK 编译；模板未显式设置 target，构建有相应提示。该默认产品目前要求 API 26 真机；需先读取实际手机系统/API。如果手机低于此版本，必须另行核对并验证最低兼容版本或正式版工具链组合，不能直接宣称支持。Android 兼容要求见另一份构建说明。

2026-10-26 初始接入 ADY-AL10 / HarmonyOS 4.2.0.245 时，仅 ADB 可用、HDC 无目标；其中 Android API 31 属于兼容层，不能与鸿蒙 API 26 直接比较。随后机主自行升级，实测固件为 `ADY-AL10 7.0.0.109(SP6C00E105R5P2)`，原生系统参数为 `OpenHarmony-7.0.0.105` / API 26 / Release，HDC 已正常识别。当前设备版本满足工程要求，保持 compatible 不变并已通过实际 HAP 安装运行；该结果仅覆盖已记录的设备、版本与模板。

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

## 3. 真机签名与安装（已实测）

1. 手机开启开发者模式和 USB 调试，连接电脑并允许调试授权。
2. 执行 `devecocli device list`，确认设备在线，再用 `devecocli device view` 记录实际系统/API；多设备时按命令帮助指定目标。
3. 使用本人的华为开发者账号登录。账号首次没有调试设备时，当前 CLI 1.3.0-stable 预检查会报告 `missing devices`，即使本地真机已在线；应先在官方开发者中心“ID、证书和Profile > 设备”登记实际手机。可通过 `hdc shell bm get -u` 读取 UDID，在机主授权后提交到其开发者账号。网页如要求确认协议，由账号持有人阅读并决定；不要将设备标识或账号材料发到共享仓库。
4. 为本项目和实际设备配置调试签名。可使用 DevEco Studio 的自动签名；本轮实际采用 CLI，在仓库外的源码导出目录依次执行：

```powershell
devecocli auth login
devecocli signature generate --product default
devecocli run --module entry --device <实际设备序列号>
```

登录需要用户在官方页面完成。签名依赖开发者权限和设备注册结果，不提前承诺成功。CLI 会写入本机密钥、证书和签名配置；不要把签名材料、密码、设备标识及本机绝对路径提交到共享工程。提交前检查 `build-profile.json5`，仓库中保留的是无个人签名材料的模板配置。

本轮生成签名成功，`run` 输出 `App installed successfully` 与 `start ability successfully`。签名产物为 `entry/build/default/outputs/default/entry-default-signed.hap`；Profile 只覆盖已登记的调试设备，其他组员需配置自己的调试签名。

## 4. 验收记录

- 使用同一源码提交与 Android 构建。
- 记录手机型号、系统/API、签名配置方式、安装与启动命令、真实输出。
- 确认页面显示 `Hello World`，退出应用后可再次启动。
- 应用在前台时使用 `devecocli ui screenshot --device <实际设备序列号> --path <本机证据目录>` 保存截图，并检查崩溃日志。

本轮以上操作已通过，[鸿蒙停止重启后截图](images/t06/harmony-pura70.png) 已核对。强制停止后确认进程不存在，再启动取得新的进程；可见布局仍为 Hello World，按包名查询未找到崩溃日志。签名 HAP 的 SHA-256 为 `67de102755074ce6aa28a39d8ff27ee601014ef67e110bfd4535b656040c571e`。

导出源码的 85 个文件中，仅本机 build-profile 增加了 signingConfigs，其余 84 个文件哈希不变；移除签名字段后配置结构与仓库一致。Android 原始验证提交与本次导出基线之间的 client 无差异。未执行 Hypium 设备测试；模板 target、测试资源和依赖类型警告保留在日志中。T08 存储能力需按其独立源码与步骤另行验证。
