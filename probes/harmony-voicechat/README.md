# T15 鸿蒙语音对话联调

本地开发装配，已在 Pura70 完成一次 ASR→人工发送→真实模型回复→人工播报，尚未接入生产主页面或任务保存。复用共享 T10 控制器/HTTP 适配及 T09 原生语音实现，无新增依赖；一次成功不等同完整T15异常/跨端验收。

## 操作顺序

1. 打开“课事清语音联调”，先在设置中配置团队网关；仅验证流程时可选择明确标注的本机合成服务。
2. 周围安静时由用户点开始录音，读合成短句后立即结束，等待输入框中的最终文字；可以修改。不要让录音等待代理操作。
3. 用户核对后点发送；确认页面只出现一次回复。合成服务的回复不是真实模型。
4. 用户手动点播报回复，听到声音后可点同一区域停止；切后台也应停止，返回不续播。

本页不保存任务，关闭应用不保留对话和网关设置。工具调用、通知草案确认保存留 T19 及其前置任务。不要把真实学生通知用于开发截图。

## 主机检查与导出

激活 DevEco 环境或设置 `DEVECO_CLI_STUDIO_PATH` 后，在仓库根运行：

```powershell
node scripts/test-voice-chat.cjs
node scripts/test-chat.cjs
node scripts/test-speech-probe.cjs
node scripts/prepare-voice-chat.cjs C:/Temp/campus-ddl-t15-new
```

导出目录必须全新，不能覆盖已有签名目录；生成时不会复制个人签名配置。打开导出工程，按本机既有 SDK 环境编译并由本人处理必要的签名授权。不要把签名配置或 HAP 提交到 Git。

若使用仓库已有 `scripts/t10-test-gateway.py`，它只监听电脑 127.0.0.1:18765，手机通过 USB `hdc rport tcp:18765 tcp:18765` 连接；项目凭证是公开人工测试值 `t10-device-check`。测试结束只移除本轮映射、停止本轮服务，不处理其他映射或进程。

实际进展见 [T15 联调记录](../../docs/setup/T15-voice-chat-validation.md)，装配边界见 [决定](../../docs/decisions/D-T15-validation-assembly.md)。
