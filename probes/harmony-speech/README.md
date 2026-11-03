# T09：鸿蒙原生语音能力探测

日期：2026-11-02。D 的本地工作，基于团队 main `b6032c0`。本目录是有限能力探测源码，不是第二套业务客户端，不改变 `client/`、网关、任务模型或确认协议。

当前结果：控制逻辑严格 TypeScript 检查及 21 项主机/模拟原生边界检查通过；工程导出、团队 main 基础客户端和本探测页的真实 API 26 ArkTS/SDK 编译通过。独立探测包已签名、安装并启动；观察到原生实时识别返回和编辑后的文字，操作者反馈录音可用。固定合成句最终文本尚未完成独立回读，**TTS 实际声音/停止、离线和后台取消仍待验证**。最新更新取消清掉未确认的临时结果、保留编辑文字，播报区增加就近“停止播报”。更新重新构建、签名和安装成功，未启动录音或播放；新版布局待方便时在手机复核。

## 探测路径

- `SpeechProbeController.ts`：权限、录音、结束、转写编辑、播报、取消、超时与迟到结果隔离。没有 Agent 调用或任务写入。
- `HarmonySpeechPort.ets`：只在鸿蒙探测工程使用 Core Speech Kit，候选为中文离线识别与离线播报。模式为引擎直接采集麦克风，不落录音文件，也没有音频上传代码。
- `SpeechProbe.ets`：可见的录音、结束、取消/停止、可编辑转写与播报按钮。首次启动不请求麦克风，点击录音后才请求。
- `SpeechProbeOwner.ets` / `EntryAbility.ets`：离页、转后台、窗口或 Ability 销毁时取消原生操作，晚返回不得重新启动录音/播报。

本次只验证一条候选原生路径。初始化失败会记录受控数字错误码；不能创建引擎时保持未验证，再根据设备错误与 A/B 对齐备选服务，不自行另建后端。

## 本地主机检查

可使用本机 Studio 随附 TypeScript（本轮 4.9.5 复现通过），不要求加入团队生产依赖：

```powershell
$env:DEVECO_CLI_STUDIO_PATH='<本机 DevEco Studio 安装目录>'
node scripts/test-speech-probe.cjs
```

也可配置已有 TypeScript 包路径：

```powershell
$env:TYPESCRIPT_PATH='<已安装的 TypeScript 包目录>'
node scripts/test-speech-probe.cjs
```

该检查驱动控制逻辑及真实适配文件的模拟 SDK 边界，覆盖权限拒绝、取消初始化、转写编辑保护、空识别、超时、重复启动、迟到回调、停止失败、资源释放、参数映射及合成结束/播报结束区别。它不能检查真正的 ArkTS 类型声明、录音权限、声音或系统服务。

## 生成独立探测工程

从仓库根目录执行：

```powershell
node scripts/prepare-speech-probe.cjs
```

脚本将 Git 跟踪且未修改的 `client/` 源码导出到本目录忽略的 `.generated/<编号>/`，换成独立的 `com.campusddl.speechprobe` 包名和探测入口，仅声明麦克风权限，清空签名配置。不会覆盖已有导出目录，也不会复制未跟踪的签名、依赖、缓存或产物。也可传入新的本机英文路径作为脚本参数；构建记录使用临时英文路径。

导出沿用团队 API 26 / ArkUI-X 插件 4.24.1，仅用于验证鸿蒙 HAP；不要从导出工程构建 Android。Core Speech Kit 不属于跨平台接口，初次编译如实报错；按[官方平台差异化说明](https://github.com/arkui-x/docs/blob/master/zh-cn/application-dev/quick-start/platform-different-introduction.md)，**仅在探测导出**设置 `.arkui-x/arkui-x-config.json5` 的 `buildOption.ignoreCrossPlatform=true`。该字段位置已按本机插件 schema 核对，原生适配构造时检查 `deviceInfo.osFullName`，其他 OS 不得创建该适配。生产 `client/` 未加入此配置，不宣称其他端兼容。后续正式装配仍需与 A 对齐，见[探测边界决策](../../docs/decisions/D-T09-native-probe.md)。

本轮实际工具为 Studio 26.0.0.865、HarmonyOS SDK 26.0.0.105 Release、ArkUI-X 26.0.0.28 Beta2、Node 24.14.1、OHPM 26.0.0.630。使用 Studio 随附 `hvigorw`、当前进程的 `DEVECO_SDK_HOME` 和 `ARKUIX_SDK_HOME`，在导出根执行：

```text
hvigorw --mode module -p module=entry@default -p product=default -p buildMode=debug assembleHap --no-daemon
```

首次构建生成 `entry/build/default/outputs/default/entry-default-unsigned.hap`；未签名包不能直接安装。用户本人完成调试签名授权并保存到本机导出后，后续构建生成 `entry-default-signed.hap`，实际 HDC 安装与启动成功。命令还编译了模板 ohosTest 目标，但未执行设备测试。保留 targetSdkVersion 未显式指定、模板测试资源/Hypium、原生 API 及异常处理提示；不将有警告的构建称为全绿。签名材料及带个人 Profile 的 HAP 仅留本机，不提交。

手机已存在团队包 `com.campusddl.agent` 1.0.0，仓库 `EntryAbility_label` 为 `label`；仅核对安装元数据，未读取其任务/聊天/配置，也没有覆盖或卸载。新探测包 `com.campusddl.speechprobe` 已独立安装，桌面入口为“课事清语音探测”。

## 真机执行与边界

1. 安装后确认名称为“课事清语音探测”，不会覆盖团队 `com.campusddl.agent`。
2. 先拒绝麦克风权限，核对仍可编辑文字；之后由本人在系统权限设置允许，再测试录音。
3. 口述合成文本“请记录2026年11月6日18点交数据库实验报告”，结束后核对真实转写、编辑和重录。期望文本不能填成实际结果。
4. 播报页面的合成提示文字，核对实际声音；录音/播放期间取消、离页、切后台，核对麦克风指示和声音确实结束。回调不代替听觉验证。
5. 实际测试无语音、服务不可用、取消后迟到返回。离线能力需本人临时断网实测并恢复网络，不能只根据 `online:1` 宣称离线验收。
6. 记录工程版本、SDK、系统/API、实际格式配置、输出与错误。PCM/16000Hz/16bit/单声道是请求配置，尚未通过独立音频采样测量。

正式 T15/T19 接入仍需与 A 对齐平台装配；不得把本目录鸿蒙 Kit 导入共享 Android 页面。语音文本须先供编辑，由用户发送进同一个 Agent；任务写入仍通过屏幕确认。此探测页没有模型、持久化或系统提醒。

当前对接准备见 [T15 语音接入准备](../../docs/setup/T15-speech-handoff.md)，仅核对真实 T10 方法和边界，尚未接入生产页面或执行模型请求。

依据：[华为语音识别 API](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/hms-ai-speechrecognizer)、[文本转语音 API](https://developer.huawei.com/consumer/cn/doc/doccenter-references/api/hms-ai-texttospeech)、[团队语音设计](../../docs/ui-and-speech.md)。具体支持情况以本机所装 SDK 声明和实测为准。
