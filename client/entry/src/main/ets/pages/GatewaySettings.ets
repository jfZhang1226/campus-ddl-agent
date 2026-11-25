import { AppTheme } from '../ui/AppTheme';
import { AppTabBar } from '../ui/AppTabBar';
import router from '@ohos.router';
import common from '@ohos.app.ability.common';
import { chatOwner } from '../chat/ChatOwner';
import { GatewayConfig } from '../chat/ChatModels';
import { validateConfig } from '../chat/GatewayProtocol';
import { GatewaySettings, GatewaySettingsView } from '../chat/GatewaySettings';

@Entry
@Component
struct GatewaySettingsPage {
  @State baseUrl: string = '';
  @State projectToken: string = '';
  @State configured: boolean = false;
  @State notice: string = '';
  private appliedUrl: string = '';
  @State helpOpen: boolean = false;
  @State secure: GatewaySettingsView = new GatewaySettingsView();
  @State confirmClear: boolean = false;
  private navigate(page: string): void {
    if (this.onBackPress()) return;
    if (page === 'pages/TaskAssistant') router.back({ url: page });
    else router.pushUrl({ url: page }, router.RouterMode.Single).catch(() => { this.notice = '暂时无法打开页面。'; });
  }
  private context(): common.UIAbilityContext { return this.getUIContext().getHostContext() as common.UIAbilityContext; }
  private configuration(): GatewayConfig { return chatOwner.get(this.context().filesDir).configuration(); }
  private connection(): GatewaySettings { return chatOwner.settings(this.context().filesDir); }
  private applyConfiguration(config: GatewayConfig): boolean { return this.connection().save(config); }
  aboutToAppear(): void {
    const config = this.configuration();
    this.configured = validateConfig(config).length === 0;
    this.secure = this.connection().snapshot(); this.notice = this.secure.notice;
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
    if (!this.applyConfiguration(config)) { this.secure = this.connection().snapshot(); this.notice = this.secure.notice; return; }
    this.secure = this.connection().snapshot();
    this.projectToken = ''; this.appliedUrl = config.baseUrl; this.configured = true;
    router.back();
  }
  private clear(): void {
    const cleared = this.connection().clear();
    this.secure = this.connection().snapshot(); this.notice = this.secure.notice;
    if (!cleared) return;
    this.confirmClear = false; this.projectToken = ''; this.configured = false;
    this.baseUrl = 'http://127.0.0.1:8000'; this.appliedUrl = this.baseUrl;
  }
  private restore(): void {
    this.connection().restore(); this.secure = this.connection().snapshot(); this.notice = this.secure.notice;
    const config = this.configuration(); this.configured = validateConfig(config).length === 0;
    if (this.configured) { this.baseUrl = config.baseUrl; this.appliedUrl = config.baseUrl; }
  }
  build() {
    Column({ space: 12 }) {
      Row({ space: 10 }) {
        Button('返回').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('settings-back').fontSize(12).onClick(() => { if (!this.onBackPress()) router.back(); })
        Text('设置').fontSize(23).fontWeight(FontWeight.Bold).layoutWeight(1)
      }.width('100%')
      Scroll() {
        Column({ space: 12 }) {
          Text('连接你的助手').fontSize(24).fontWeight(FontWeight.Medium)
          Text(this.configured ? (this.secure.saved ? '连接信息已安全保存，下次打开自动恢复。' : '本次连接已应用。') : '连接助手，开始整理通知。')
            .id('settings-state').fontSize(14).fontColor(AppTheme.primary)
          Text('连接助手后即可分析通知；你的任务和草案保存在本机。').fontSize(13)
          Text('服务地址').fontSize(15)
          TextInput({ text: this.baseUrl, placeholder: 'http://127.0.0.1:8000' }).fontColor(AppTheme.ink).placeholderColor(AppTheme.muted).backgroundColor(AppTheme.surface).borderRadius(14).id('gateway-url').maxLength(500)
            .onChange((text: string) => { this.baseUrl = text; })
          Text('访问凭证').fontSize(15)
          TextInput({ text: this.projectToken, placeholder: this.configured ? '已设置，留空保留原凭证' : '填写团队项目凭证' }).fontColor(AppTheme.ink).placeholderColor(AppTheme.muted).backgroundColor(AppTheme.surface).borderRadius(14)
            .id('gateway-token').type(InputType.Password).maxLength(1000).onChange((text: string) => { this.projectToken = text; })
          Button('保存连接设置').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('gateway-apply').width('100%').onClick(() => { this.apply(); })
          if (this.notice.length > 0) { Text(this.notice).id('settings-notice').fontSize(13).fontColor(AppTheme.amber) }
          if (this.secure.errorCode === 'READ_FAILED') {
            Button('重新读取连接').id('gateway-reload').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { this.restore(); })
          }
          if (this.secure.saved || this.configured || this.secure.errorCode === 'READ_FAILED') {
            Button('清除连接信息').id('gateway-clear').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).onClick(() => { this.confirmClear = true; })
          }
          if (this.confirmClear) {
            Text('清除后需要重新填写连接信息。任务和聊天记录会保留。').fontSize(12).fontColor(AppTheme.muted)
            Row({ space: 10 }) {
              Button('取消').id('gateway-clear-cancel').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { this.confirmClear = false; })
              Button('确认清除').id('gateway-clear-confirm').fontColor(AppTheme.onPrimary).backgroundColor(AppTheme.primary).onClick(() => { this.clear(); })
            }
          }
          if (this.dirty()) { Button('放弃输入并返回').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('settings-discard').fontSize(12).onClick(() => { this.projectToken = ''; router.back(); }) }
          Button(this.helpOpen ? '收起连接帮助' : '连接帮助与隐私说明').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('settings-help').width('100%').fontSize(13).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).onClick(() => { this.helpOpen = !this.helpOpen; })
          if (this.helpOpen) {
          Text('电脑连接方式').fontSize(18)
          Text('地址为 127.0.0.1 时，需要电脑启动团队网关，并通过 USB 数据线恢复转发。仅连接数据线不会自动恢复模型服务。').fontSize(13)
          Text(this.secure.supported ? '地址和项目凭证保存在本机安全存储中，重启自动恢复，不上传同步。清除连接不会删除任务；卸载应用后需重新配置。' : '当前平台尚未接入安全存储，连接仅在本次运行生效。').fontSize(13)
          }
          Text('课事清 · 将校园通知整理成可确认的任务').fontSize(12).fontColor(AppTheme.muted)
          Button('调试工具').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('open-debug-tools').fontSize(12).enabled(!this.dirty())
            .onClick(() => { router.pushUrl({ url: 'pages/DebugTools' }).catch(() => { this.notice = '无法打开调试工具。'; }); })
        }.width('100%').alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').align(Alignment.Top)
      AppTabBar({ active: 'settings', onSelect: (page: string): void => { this.navigate(page); } })
    }.padding({ left: 18, right: 18, top: 16 }).width('100%').height('100%').backgroundColor(AppTheme.canvas)
  }
}
