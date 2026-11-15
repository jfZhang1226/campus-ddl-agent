# T19：共享通知入口接确认保存（电脑验证）

2026-11-15。按用户要求，设备、真实模型和音频联调留到下一次；本轮没有查询/操作手机、启动真实网关、调用真实模型或处理签名授权。

后续同日执行结果分别为[300包无声设备记录](T19-native300-device-20261115.md)与[本人签名后的共享入口保存/冷读](T19-shared-entry-device-20261115.md)。下文保留此前离线阶段事实，不将其“未签名/未安装”当最新状态，也不扩大为声音/完整设备矩阵已通过。

## 这次实际完成

此前独立noticeprobe已验证的NoticeConfirmedWriter、NoticeSaveController、NoticeVoiceController移入共享客户端notice目录，原probe路径只转出同一构造器。正式NoticeImport页面现在用应用唯一ClientStorage.local/commits，经T16 v2明确确认保存、保留原request重试、恢复/取消pending并回读真实任务材料，不再走基础NoticeImportRepository保存。没有修改T12网关、业务schema或T17。

新增NoticeImportOwner管理当前导入页，应用后台/销毁显式暂停/释放；过期页面不能清掉新owner，初始化代次拒绝页面关闭后的结果。来源信息默认折叠，pending时字段禁用但重试确认/取消/重新读取可用。正式入口本轮支持文字，默认UnavailableSpeechSession不请求麦克风、不生成转写/声音；原生验证包仍注入真实SpeechSession。两种入口共用确认核心和卡片。

旧T13基础导入创建的任务/来源/材料不删除或迁移，已用实际主机文件验证继续新增T16任务时旧记录不变。“最近确认”回读只查本入口已提交回执，不等于全量任务列表。不同包的数据独立，不自动把noticeprobe或团队业务应用数据搬进新验证包。

详见[决策说明](../decisions/D-T19-shared-confirmation-entry.md)。运行提交d4cdb92，首次完整SDK构建暴露ArkTS不接受未知类型直接重抛，已在`d63931e709001a2ca2ad48b05630e1fa93501547`显式转为Error；保留旧失败目录，不覆盖其证据，成功产物来自之后全新导出。

## 电脑检查

| 范围 | 通过 |
| --- | --- |
| 确认保存/实际主机文件/owner生命周期 | 28 |
| 原文/语音组合（模型与语音端口模拟） | 19 |
| T13通知及原生HTTP适配模拟 | 19 |
| T11历史/切换/异常恢复 | 66 |
| 原生通知导出 | 6 |
| 新共享入口导出 | 7 |
| 原T15语音导出回归 | 7 |

合计152项及相关严格TS通过。新增7项保存/生命周期检查与7项共享导出检查；同一套件复跑不重复计数。涵盖同一共享构造器、默认文字确认/冷读、不伪造转写、旧任务材料保留、后台迟到响应、过期页面释放、恢复中关闭和实际导出身份/路由/来源字节一致。生命周期测试为控制器/主机模拟，不等于手机后台验收。

## 新版本实际SDK构建

沿用API26 / SDK26.0.0.105 / ArkUI-X26.0.0.28 Beta2 / 插件4.24.1，均从干净d63931e导出119份跟踪客户端文件、空签名。共享入口保留生产Index、原路由和跨端配置；仅包身份/标签/空签名作验证隔离。原生导出仅追加语音端口和入口，不复制另一份确认实现。

| 产物 | 共享页面验证 | 原生语音验证 |
| --- | --- | --- |
| 包名/版本 | com.campusddl.noticeentry / 100 | com.campusddl.noticeprobe / 300 |
| 权限 | INTERNET | INTERNET、MICROPHONE |
| 构建结果 | 25秒180毫秒，67条Finished记录 | 24秒565毫秒，67条Finished记录 |
| 未签名HAP字节 | 1139673 | 835106 |
| SHA256 | de8d2958538ad2dd1234bc64472c36f4e79f9d29618f851abe83449b2be4f1b6 | 5e4f63dad0d526a27836c598bfe5c6b7bcc6dc3d4c4b63e9143bfe01dbcbed6f |

两包分别8份关键装配源码指纹保持，6份共享核心逐字节一致；解包ABC确认包含对应NoticeImportPage/NoticeChatPage、NoticeConfirmedWriter、NoticeSaveController和NoticeImportOwner。签名配置为空，无signed HAP，没有安装。保留SDK/Hypium、文件API、路由及原生语音等既有警告；没有三端验收或性能结论。

本机成功目录分别为临时目录下campus-ddl-t19-entry-verified-20261115、campus-ddl-t19-voice-verified-20261115；包和检查文件只在本机忽略目录，不提交HAP、签名或私有配置。[脱敏结构化证据](evidence/t19-shared-entry-validation-20261115.json)。

## 留到下一次

按[下一次设备检查清单](T19-next-device-session.md)验证签名/安装、新入口真实提取与确认保存、原生300语音、页面离开/后台/重启及pending场景。此前版本200的设备证据保留旧范围，不能当作本次共享页面或300包已验收。

正式聊天owner与自然语言自由补充仍未接入，T17仍需B修复并对齐；多任务、完整失败/pending/冲突设备矩阵和系统提醒未完成。本步完成共享通知页确认链路，不将整个产品标为完成。
