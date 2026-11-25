# 本机安全保存项目连接信息

2026-11-25，用户明确要求访问凭证在划掉后台/重启后自动恢复，并提供主动清除。此前“仅运行内存”限制在已接入安全存储的鸿蒙装配中由本决策替代；服务商 Key 继续只在电脑网关，业务确认与任务数据模型不变。

## 选择

原生鸿蒙采用 Asset Store Kit，固定应用内别名 `campusddl.gateway.connection.v1`。地址、项目凭证和超时连同版本放进同一 SECRET，保存成功后应用到运行时；别名/公开属性不含凭证。不写 Preferences、任务快照、会话、日志或自制加密文件。

ACCESSIBILITY=DEVICE_UNLOCKED，AUTH_TYPE=NONE：手机解锁后自动读，不额外要求每次指纹。SYNC_TYPE=NEVER、WRAP_TYPE=NEVER，不参与设备/账号同步或导出；不设置 IS_PERSISTENT，不要求卸载后保留数据的权限。首次在当前设备设置/授权已由用户明确要求，卸载需重新配置。锁屏限制针对安全存储的读取；不把它宣称为抹除应用所有运行时内存。

一条资产覆盖替换旧记录，不先删后写。SECRET 最大1024字节，编码后的完整JSON超限时拒绝保存，保留原连接。新增/读取/删除服务异常只转成固定提示，不显示平台异常细节或秘密。读取失败保留记录，解锁后可重读，亦可主动确认清除；不会默默改用明文文件。

共享代码通过 GatewaySecretStore/GatewayRuntime 隔离平台能力。默认共享装配明确不支持安全持久化，仅本次运行生效；仅鸿蒙原生装配注入 HarmonyGatewaySecretStore，其他平台不冒充已接入。GatewaySettings 只管理连接，不持有任务、文件或模型请求端口。

## 行为

- Native VoiceChatOwner 创建时读取资产并应用，任务助手复用同一网关配置；启动不自动发模型消息。
- 设置中凭证不回显，留空保留当前凭证；保存成功才声称已保存。忙碌时拒绝保存/清除，存储失败不激活候选连接，不影响原设置。
- 清除有二次确认，只删固定资产并清空运行时连接；任务/聊天/草案保留。下次启动不得恢复旧凭证。
- 清除后返回任务助手将无效配置替换为空运行时配置，不能继续持有可用旧令牌发送。
- 安全存储与运行时内存不构成跨系统事务；同步预检后应用若发生异常拒绝，明确提示已保存但需重新打开，不假称正在使用新连接。

主机确定性检查与真实系统安全存储、杀进程回读/清除分别记录；没有完成设备检查前不宣称已验收。构建和设备证据在后续状态与交付说明中补充。

## 依据

- [华为：Adding an Asset](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/asset-js-add/)：SECRET/ALIAS限制、属性信息不加密、同步/访问限制。
- [华为：Asset API](https://developer.huawei.com/consumer/en/doc/harmonyos-references/js-apis-asset/)：同步接口、覆盖策略、查询结果、错误及持久属性权限。
- 本机 SDK `@ohos.security.asset.d.ts` 与 API26 编译、Pura70实际运行单独核对。
