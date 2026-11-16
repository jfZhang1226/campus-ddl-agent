# D/T19：共享通知入口复用确认保存核心

2026-11-15。用户要求继续完成不依赖设备的工作，手机/真实服务联调留到次日。此变更在D的PR #17中供A/B/C复查，不合并远端PR，不代改B的T17或网关。

此前NoticeConfirmedWriter/NoticeSaveController/NoticeVoiceController在probes中，正式NoticeImport页面仍走基础NoticeImportRepository。现把三份纯逻辑实现移入共享client/notice目录，旧probe路径仅re-export兼容，同一个构造器承担业务；原有数据schema、T12请求、T16 v2及固定导入命名空间不变。

正式NoticeImport接应用唯一ClientStorage.local/commits，经明确屏幕确认、原request重试、pending恢复/取消及实际回读，不回退基础CRUD。NoticeImportOwner仅管理当前页面控制器和生命周期，不另建存储或聊天历史；过期页面释放不能清掉新的控制器。初始化版本检查拒绝页面关闭后的异步初始化。EntryAbility显式转发后台/销毁。

正式入口本增量先支持文字。默认UnavailableSpeechSession不会请求麦克风、生成转写或播放；平台owner仍可注入真实SpeechSession。鸿蒙独立语音导出复用同一共享页面/核心，额外接原生语音端口；不将CoreSpeechKit写入共享层，也不把文字入口当新语音验收。

来源字段默认折叠。待确认内容锁定时字段禁用，重试确认/显式取消/重新读取仍可用。旧T13普通导入创建的任务和材料不迁移、不删除；“最近确认”回读只依据本入口T16已提交回执，不声称展示全量旧任务。

受控导出共用跟踪文件白名单、空签名和拒绝覆盖机制。另准备com.campusddl.noticeentry/100验证包，使用原共享Index/路由、仅INTERNET，避免覆盖组员业务包；原生语音独立noticeprobe升级300。两者本轮仅编译未签名包，不安装、不录音、不调用真实模型；实际构建及次日检查以验证记录为准。

该步是正式通知页接入，不表示正式聊天owner、自然语言自由补充、完整T17、多任务或系统提醒完成。新页面、后台、签名安装及真实模型端到端需次日另验，不拿此前版本200设备结果替代。
