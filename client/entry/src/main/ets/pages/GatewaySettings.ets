import { AppTheme } from '../ui/AppTheme';
import { AppTabBar } from '../ui/AppTabBar';
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
  @State helpOpen: boolean = false;
  private navigate(page: string): void {
    if (this.onBackPress()) return;
    if (page === 'pages/TaskAssistant') router.back({ url: page });
    else router.pushUrl({ url: page }, router.RouterMode.Single).catch(() => { this.notice = '暂时无法打开页面。'; });
  }
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
        Button('返回').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(12).id('settings-back').fontSize(12).onClick(() => { if (!this.onBackPress()) router.back(); })
        Text('设置').fontSize(23).fontWeight(FontWeight.Bold).layoutWeight(1)
      }.width('100%')
      Scroll() {
        Column({ space: 12 }) {
          Text('连接你的助手').fontSize(24).fontWeight(FontWeight.Medium)
          Text(this.configured ? '本次运行已应用网关设置；实际连接以发送后的结果为准。' : '尚未配置模型连接。已有任务、历史与待确认草案仍可离线查看和核对保存。')
            .id('settings-state').fontSize(14).fontColor(AppTheme.primary)
          Text('连接助手后即可分析通知；你的任务和草案保存在本机。').fontSize(13)
          Text('服务地址').fontSize(15)
          TextInput({ text: this.baseUrl, placeholder: 'http://127.0.0.1:8000' }).id('gateway-url').maxLength(500)
            .onChange((text: string) => { this.baseUrl = text; })
          Text('访问凭证').fontSize(15)
          TextInput({ text: this.projectToken, placeholder: this.configured ? '留空保留本次已配置的项目凭证' : '填写团队项目凭证' })
            .id('gateway-token').type(InputType.Password).maxLength(1000).onChange((text: string) => { this.projectToken = text; })
          Button('保存连接设置').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(12).id('gateway-apply').width('100%').onClick(() => { this.apply(); })
          if (this.notice.length > 0) { Text(this.notice).id('settings-notice').fontSize(13).fontColor('#9A541B') }
          if (this.dirty()) { Button('放弃输入并返回').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(12).id('settings-discard').fontSize(12).onClick(() => { this.projectToken = ''; router.back(); }) }
          Button(this.helpOpen ? '收起连接帮助' : '连接帮助与隐私说明').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(12).id('settings-help').width('100%').fontSize(13).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { this.helpOpen = !this.helpOpen; })
          if (this.helpOpen) {
          Text('电脑连接方式').fontSize(18)
          Text('地址为 127.0.0.1 时，需要电脑启动团队网关，并通过 USB 数据线恢复转发。仅连接数据线不会自动恢复模型服务。').fontSize(13)
          Text('设置仅保留在本次运行内存中。完全关闭或重启应用后，需要重新填写并应用项目凭证；任务、草案和安排不会因此删除。').fontSize(13)
          }
          Text('课事清 · 将校园通知整理成可确认的任务').fontSize(12).fontColor(AppTheme.muted)
          Button('调试工具').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(12).id('open-debug-tools').fontSize(12).enabled(!this.dirty())
            .onClick(() => { router.pushUrl({ url: 'pages/DebugTools' }).catch(() => { this.notice = '无法打开调试工具。'; }); })
        }.width('100%').alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%')
      AppTabBar({ active: 'settings', onSelect: (page: string): void => { this.navigate(page); } })
    }.padding({ left: 18, right: 18, top: 16 }).width('100%').height('100%').backgroundColor(AppTheme.canvas)
  }
}
