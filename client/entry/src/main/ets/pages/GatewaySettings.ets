import router from '@ohos.router';
import common from '@ohos.app.ability.common';
import { chatOwner } from '../chat/ChatOwner';
import { GatewayConfig } from '../chat/ChatModels';
import { validateConfig } from '../chat/GatewayProtocol';

@Entry
@Component
struct GatewaySettingsPage {
  @State baseUrl: string = '';
  @State projectToken: string = '';
  @State configured: boolean = false;
  @State notice: string = '';
  private appliedUrl: string = '';
  private context(): common.UIAbilityContext { return this.getUIContext().getHostContext() as common.UIAbilityContext; }
  private configuration(): GatewayConfig { return chatOwner.get(this.context().filesDir).configuration(); }
  private applyConfiguration(config: GatewayConfig): boolean { return chatOwner.get(this.context().filesDir).configure(config); }
  aboutToAppear(): void {
    const config = this.configuration();
    this.configured = validateConfig(config).length === 0;
    this.baseUrl = config.baseUrl || 'http://127.0.0.1:8000'; this.appliedUrl = this.baseUrl;
  }
  aboutToDisappear(): void { this.projectToken = ''; }
  private dirty(): boolean { return this.projectToken.length > 0 || this.baseUrl !== this.appliedUrl; }
  onBackPress(): boolean {
    if (this.dirty()) { this.notice = '设置尚未应用，请应用后返回，或放弃本页输入。'; return true; }
    return false;
  }
  private apply(): void {
    const current = this.configuration();
    const config = new GatewayConfig(this.baseUrl.trim(), this.projectToken.length > 0 ? this.projectToken : current.token, 45000);
    if (validateConfig(config).length > 0) { this.notice = '请填写有效的网关根地址和项目访问凭证；地址以 http:// 或 https:// 开头。'; return; }
    if (!this.applyConfiguration(config)) { this.notice = '当前尚不能应用设置，请停止正在进行的请求后重试。'; return; }
    this.projectToken = ''; this.appliedUrl = config.baseUrl; this.configured = true;
    router.back();
  }
  build() {
    Column({ space: 12 }) {
      Row({ space: 10 }) {
        Button('返回').id('settings-back').fontSize(12).onClick(() => { if (!this.onBackPress()) router.back(); })
        Text('设置').fontSize(23).fontWeight(FontWeight.Bold).layoutWeight(1)
      }.width('100%')
      Scroll() {
        Column({ space: 12 }) {
          Text('模型连接').fontSize(20).fontWeight(FontWeight.Medium)
          Text(this.configured ? '本次运行已应用网关设置；实际连接以发送后的结果为准。' : '尚未配置模型连接。已有任务、历史与待确认草案仍可离线查看和核对保存。')
            .id('settings-state').fontSize(14).fontColor('#176766')
          Text('继续使用团队 DeepSeek 网关。手机只填项目访问凭证（GATEWAY_TOKEN），服务商 API Key 留在电脑服务端。').fontSize(13)
          Text('网关根地址').fontSize(15)
          TextInput({ text: this.baseUrl, placeholder: 'http://127.0.0.1:8000' }).id('gateway-url').maxLength(500)
            .onChange((text: string) => { this.baseUrl = text; })
          Text('项目访问凭证').fontSize(15)
          TextInput({ text: this.projectToken, placeholder: this.configured ? '留空保留本次已配置的项目凭证' : '填写团队项目凭证' })
            .id('gateway-token').type(InputType.Password).maxLength(1000).onChange((text: string) => { this.projectToken = text; })
          Button('应用设置并返回').id('gateway-apply').width('100%').onClick(() => { this.apply(); })
          if (this.notice.length > 0) { Text(this.notice).id('settings-notice').fontSize(13).fontColor('#9A541B') }
          if (this.dirty()) { Button('放弃输入并返回').id('settings-discard').fontSize(12).onClick(() => { this.projectToken = ''; router.back(); }) }
          Text('电脑连接方式').fontSize(18)
          Text('地址为 127.0.0.1 时，需要电脑启动团队网关，并通过 USB 数据线恢复转发。仅连接数据线不会自动恢复模型服务。').fontSize(13)
          Text('设置仅保留在本次运行内存中。完全关闭或重启应用后，需要重新填写并应用项目凭证；任务、草案和安排不会因此删除。').fontSize(13)
          Button('调试工具').id('open-debug-tools').fontSize(12).enabled(!this.dirty())
            .onClick(() => { router.pushUrl({ url: 'pages/DebugTools' }).catch(() => { this.notice = '无法打开调试工具。'; }); })
        }.width('100%').alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%')
    }.padding(16).width('100%').height('100%').backgroundColor('#F2F6F7')
  }
}
