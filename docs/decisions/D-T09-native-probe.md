# D / T09：鸿蒙原生探测与共享工程的边界

日期：2026-11-02。状态：D 本地能力探测选择，尚未提交或经 A/B/C 评审；不替代正式客户端装配决策。

## 已观察事实

- 团队 main `b6032c0` 的干净客户端在 API 26、ArkUI-X 26.0.0.28 Beta2 与固定插件 4.24.1 下编译通过。
- 同一配置下直接调用 Core Speech Kit 的探测页被编译器以 `11706007 can't support crossplatform application` 拦截。该结果说明 API 不在共享跨平台接口范围，不证明手机原生语音不可用。
- 本轮只验证 Pura 70 的鸿蒙原生语音，不将探测页接入正式 Agent，也不声明 Android/iOS 语音支持。

## 有限处理

保留生产 `client/`、其平台检查、包名、共享页面与插件版本。生成另一个无个人签名材料的鸿蒙探测导出，仅在该导出的 `.arkui-x/arkui-x-config.json5` 使用 `buildOption.ignoreCrossPlatform=true`。这是[官方平台差异化文档](https://github.com/arkui-x/docs/blob/master/zh-cn/application-dev/quick-start/platform-different-introduction.md)说明的选项；嵌套位置以本机插件 `arkui-x-config-schema.json` 为准。

原生适配只在 `deviceInfo.osFullName` 以 `OpenHarmony` 开头时允许创建，其他 OS 拒绝。该限制有确定性检查；跨端检查改为警告仍被保留，不隐藏编译日志。导出只构建鸿蒙 HAP，不构建 Android/iOS；API 26 不降低。

使用独立 `com.campusddl.speechprobe` 包名，避免覆盖手机已安装的团队调试应用。首次录音仍由用户点击并决定麦克风授权；无任务写入、模型调用、录音文件持久化或音频上传代码。

## 证据与后续

最新 21 项主机/模拟 SDK 边界检查通过，修正后的探测页已完成真实 ArkTS/SDK 编译。用户本人完成签名授权后，独立包实际签名、安装与启动成功。恢复后已有原生实时识别返回和用户录音可用反馈；固定合成句最终文本、实际播报/停止、离线与后台行为仍待核对。课堂期间只完成停止入口与取消清理的安静更新，构建和签名通过、更新安装成功，未启动音频。正式接入 T15 前需与 A 确定平台装配及其他端能力不可用的交互，不能直接把探测页或其平台检查配置复制进共享生产目录。
