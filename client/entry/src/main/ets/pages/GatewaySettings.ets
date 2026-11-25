import { openAppTab, prepareTabBack, appTabArrived } from '../ui/TabNavigation';
import { displayPreferences } from '../ui/UiPreferencesOwner';
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
  @StorageLink('largeSimpleMode') @Watch('syncDisplaySwitch') largeSimpleMode: boolean = false;
  @StorageLink('tabTravelDirection') tabTravelDirection: number = 1;
  @State baseUrl: string = '';
  @State projectToken: string = '';
  @State configured: boolean = false;
  @State notice: string = '';
  private appliedUrl: string = '';
  @State helpOpen: boolean = false;
  @State secure: GatewaySettingsView = new GatewaySettingsView();
  @State confirmClear: boolean = false;
  @State displayBusy: boolean = false;
  @State displaySelection: boolean = false;
  @State connectionExpanded: boolean = false;
  @State displayNotice: string = '';
  private syncDisplaySwitch(): void { this.displaySelection = this.largeSimpleMode; }
  private async changeDisplay(value: boolean): Promise<void> {
    if (this.displayBusy) return;
    this.displayBusy = true;
    try {
      const settings = displayPreferences(this.context().filesDir);
      await settings.setEnabled(value); this.displayNotice = settings.notice;
    } finally { this.displaySelection = this.largeSimpleMode; this.displayBusy = false; }
  }
  private navigate(page: string): void {
    if (this.onBackPress()) return;
    openAppTab('pages/GatewaySettings', page).catch(() => { this.notice = '暂时无法打开页面。'; });
  }
  private context(): common.UIAbilityContext { return this.getUIContext().getHostContext() as common.UIAbilityContext; }
  private configuration(): GatewayConfig { return chatOwner.get(this.context().filesDir).configuration(); }
  private connection(): GatewaySettings { return chatOwner.settings(this.context().filesDir); }
  private applyConfiguration(config: GatewayConfig): boolean { return this.connection().save(config); }
  onPageShow(): void { appTabArrived('pages/GatewaySettings'); }
  aboutToAppear(): void {
    const uiContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
    displayPreferences(uiContext.filesDir).restore().then(() => {
      this.syncDisplaySwitch(); this.displayNotice = displayPreferences(uiContext.filesDir).notice;
    });
    const config = this.configuration();
    this.configured = validateConfig(config).length === 0;
    this.secure = this.connection().snapshot(); this.notice = this.secure.notice;
    this.baseUrl = config.baseUrl || 'http://127.0.0.1:8000'; this.appliedUrl = this.baseUrl;
  }
  aboutToDisappear(): void { this.projectToken = ''; }
  private dirty(): boolean { return this.projectToken.length > 0 || this.baseUrl !== this.appliedUrl; }
  onBackPress(): boolean {
    if (this.displayBusy) return true;
    if (this.dirty()) { this.notice = '设置尚未应用，请应用后返回，或放弃本页输入。'; return true; }
    prepareTabBack('pages/GatewaySettings'); return false;
  }
  private apply(): void {
    const current = this.configuration();
    const config = new GatewayConfig(this.baseUrl.trim(), this.projectToken.length > 0 ? this.projectToken : current.token, 45000);
    if (validateConfig(config).length > 0) { this.notice = '请填写有效的网关根地址和项目访问凭证；地址以 http:// 或 https:// 开头。'; return; }
    if (!this.applyConfiguration(config)) { this.secure = this.connection().snapshot(); this.notice = this.secure.notice; return; }
    this.secure = this.connection().snapshot();
    this.projectToken = ''; this.appliedUrl = config.baseUrl; this.configured = true;
    prepareTabBack('pages/GatewaySettings'); router.back();
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
  pageTransition() {
    PageTransitionEnter({ type: RouteType.Push, duration: 240, curve: Curve.EaseInOut })
      .slide(this.tabTravelDirection > 0 ? SlideEffect.Right : SlideEffect.Left)
    PageTransitionEnter({ type: RouteType.Pop, duration: 240, curve: Curve.EaseInOut })
      .slide(this.tabTravelDirection > 0 ? SlideEffect.Right : SlideEffect.Left)
    PageTransitionExit({ type: RouteType.Push, duration: 240, curve: Curve.EaseInOut })
      .slide(this.tabTravelDirection > 0 ? SlideEffect.Left : SlideEffect.Right)
    PageTransitionExit({ type: RouteType.Pop, duration: 240, curve: Curve.EaseInOut })
      .slide(this.tabTravelDirection > 0 ? SlideEffect.Left : SlideEffect.Right)
  }
  build() {
    Column() {
      Row({ space: 10 }) {
        Button('返回').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('settings-back').fontSize(AppTheme.font(12, this.largeSimpleMode)).onClick(() => { if (!this.onBackPress()) router.back(); })
        Text('设置').fontSize(AppTheme.font(23, this.largeSimpleMode)).fontWeight(FontWeight.Medium).fontColor(AppTheme.ink).layoutWeight(1)
      }.width('100%').padding({ left: 18, right: 18, top: 16, bottom: 12 })
      Scroll() {
        Column({ space: 18 }) {
          Column({ space: 10 }) {
            Row({ space: 12 }) {
              Text('大字简洁模式').fontSize(AppTheme.font(18, this.largeSimpleMode)).fontColor(AppTheme.ink).fontWeight(FontWeight.Medium).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.displaySelection }).id('settings-large-simple').width(64).height(40)
                .selectedColor(AppTheme.primary).enabled(!this.displayBusy)
                .accessibilityText('大字简洁模式')
                .onChange((value: boolean) => { if (value !== this.largeSimpleMode) { this.displaySelection = value; this.changeDisplay(value); } })
            }.width('100%')
            if (!this.largeSimpleMode) { Text('字体更大，辅助说明更少。').fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.muted) }
            if (this.displayNotice.length > 0) { Text(this.displayNotice).id('settings-display-notice').fontSize(AppTheme.font(14, this.largeSimpleMode)).fontColor(AppTheme.amber) }
          }.width('100%').padding(16).backgroundColor(AppTheme.surface).borderRadius(18)
          Column({ space: 9 }) {
            Row({ space: 8 }) {
              Circle().width(7).height(7).fill(this.configured ? AppTheme.primary : AppTheme.amber)
              Text(this.configured ? '连接已配置' : '尚未配置连接').fontSize(AppTheme.font(13, this.largeSimpleMode)).fontWeight(FontWeight.Medium).fontColor(AppTheme.primary)
            }
            if (!this.largeSimpleMode) {
              Text(this.configured ? (this.secure.saved ? '连接信息已安全保存，下次打开自动恢复。' : '本次连接已应用。') : '连接助手，开始整理通知。')
                .id('settings-state').fontSize(AppTheme.font(13, this.largeSimpleMode)).lineHeight(AppTheme.line(21, this.largeSimpleMode)).fontColor(AppTheme.muted)
            }
          }.width('100%').alignItems(HorizontalAlign.Start).padding(16).backgroundColor(AppTheme.soft).borderRadius(18)
          if (this.largeSimpleMode && this.configured) {
            Button(this.connectionExpanded ? '收起连接设置' : '连接设置').id('settings-expand-connection')
              .fontSize(AppTheme.font(14, this.largeSimpleMode)).height(56).width('100%')
              .fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius)
              .onClick(() => { this.connectionExpanded = !this.connectionExpanded; })
          }
          if (!this.largeSimpleMode || this.connectionExpanded || !this.configured || this.secure.errorCode === 'READ_FAILED' || this.dirty() || this.confirmClear) {
          Column({ space: 12 }) {
            Text('助手连接').fontSize(AppTheme.font(18, this.largeSimpleMode)).fontWeight(FontWeight.Medium).fontColor(AppTheme.ink)
            Text('服务地址').fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.muted)
            TextInput({ text: this.baseUrl, placeholder: 'http://127.0.0.1:8000' }).fontSize(AppTheme.font(16, this.largeSimpleMode)).fontColor(AppTheme.ink).placeholderColor(AppTheme.muted).backgroundColor(AppTheme.surface).borderRadius(14).id('gateway-url').maxLength(500)
              .height(this.largeSimpleMode ? 56 : 48).caretColor(AppTheme.primary).border({ width: 1, color: AppTheme.border })
              .onChange((text: string) => { this.baseUrl = text; })
            Text('访问凭证').fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.muted)
            TextInput({ text: this.projectToken, placeholder: this.configured ? '已设置，留空保留原凭证' : '填写团队项目凭证' }).fontSize(AppTheme.font(16, this.largeSimpleMode)).fontColor(AppTheme.ink).placeholderColor(AppTheme.muted).backgroundColor(AppTheme.surface).borderRadius(14)
              .height(this.largeSimpleMode ? 56 : 48).caretColor(AppTheme.primary).border({ width: 1, color: AppTheme.border })
              .id('gateway-token').type(InputType.Password).maxLength(1000).onChange((text: string) => { this.projectToken = text; })
            Button('保存连接设置').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.onPrimary).backgroundColor(AppTheme.primary).borderRadius(AppTheme.controlRadius).id('gateway-apply').width('100%').height(this.largeSimpleMode ? 56 : 46).fontSize(AppTheme.font(15, this.largeSimpleMode)).onClick(() => { this.apply(); })
            if (this.notice.length > 0) { Text(this.notice).id('settings-notice').fontSize(AppTheme.font(13, this.largeSimpleMode)).fontColor(AppTheme.amber) }
            if (this.secure.errorCode === 'READ_FAILED') {
              Button('重新读取连接').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).id('gateway-reload').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).height(this.largeSimpleMode ? 56 : 44).onClick(() => { this.restore(); })
            }
          }.width('100%').alignItems(HorizontalAlign.Start)
          Column({ space: 10 }) {
            Button(this.helpOpen ? '收起连接帮助' : '连接帮助与隐私说明').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.surface).borderRadius(AppTheme.controlRadius).id('settings-help').width('100%').height(this.largeSimpleMode ? 56 : 44).fontSize(AppTheme.font(13, this.largeSimpleMode)).onClick(() => { this.helpOpen = !this.helpOpen; })
            if (this.helpOpen) {
              Text('电脑连接方式').fontSize(AppTheme.font(15, this.largeSimpleMode)).fontColor(AppTheme.ink)
              Text('地址为 127.0.0.1 时，需要电脑启动团队网关，并通过 USB 数据线恢复转发。仅连接数据线不会自动恢复模型服务。').fontSize(AppTheme.font(13, this.largeSimpleMode)).lineHeight(AppTheme.line(21, this.largeSimpleMode)).fontColor(AppTheme.muted)
              Text(this.secure.supported ? '地址和项目凭证保存在本机安全存储中，重启自动恢复，不上传同步。清除连接不会删除任务；卸载应用后需重新配置。' : '当前平台尚未接入安全存储，连接仅在本次运行生效。').fontSize(AppTheme.font(13, this.largeSimpleMode)).lineHeight(AppTheme.line(21, this.largeSimpleMode)).fontColor(AppTheme.muted)
            }
            if (this.secure.saved || this.configured || this.secure.errorCode === 'READ_FAILED') {
              Button('清除连接信息').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).id('gateway-clear').fontColor(AppTheme.amber).backgroundColor(Color.Transparent).borderRadius(AppTheme.controlRadius).width('100%').height(this.largeSimpleMode ? 56 : 44).fontSize(AppTheme.font(13, this.largeSimpleMode)).border({ width: 1, color: AppTheme.border }).onClick(() => { this.confirmClear = true; })
            }
            if (this.confirmClear) {
              Text('清除后需要重新填写连接信息。任务和聊天记录会保留。').fontSize(AppTheme.font(13, this.largeSimpleMode)).lineHeight(AppTheme.line(21, this.largeSimpleMode)).fontColor(AppTheme.ink)
              Row({ space: 10 }) {
                Button('取消').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).id('gateway-clear-cancel').fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).height(this.largeSimpleMode ? 56 : 44).layoutWeight(1).onClick(() => { this.confirmClear = false; })
                Button('确认清除').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).id('gateway-clear-confirm').fontColor(AppTheme.onPrimary).backgroundColor(AppTheme.primary).borderRadius(AppTheme.controlRadius).height(this.largeSimpleMode ? 56 : 44).layoutWeight(1).onClick(() => { this.clear(); })
              }.width('100%')
            }
            if (this.dirty()) { Button('放弃输入并返回').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.primary).backgroundColor(AppTheme.soft).borderRadius(AppTheme.controlRadius).id('settings-discard').fontSize(AppTheme.font(12, this.largeSimpleMode)).onClick(() => { this.projectToken = ''; prepareTabBack('pages/GatewaySettings'); router.back(); }) }
          }.width('100%').alignItems(HorizontalAlign.Start)
          Button('调试工具').fontSize(AppTheme.font(14, this.largeSimpleMode)).constraintSize({ minHeight: this.largeSimpleMode ? 56 : 0 }).labelStyle({ maxLines: 2 }).fontColor(AppTheme.muted).backgroundColor(Color.Transparent).borderRadius(AppTheme.controlRadius).id('open-debug-tools').height(this.largeSimpleMode ? 56 : 44).width('100%').fontSize(AppTheme.font(12, this.largeSimpleMode)).enabled(!this.dirty())
            .onClick(() => { router.pushUrl({ url: 'pages/DebugTools' }).catch(() => { this.notice = '无法打开调试工具。'; }); })
          }
          if (!this.largeSimpleMode) { Text('课事清 · 校园里的事，一件件安排好').fontSize(AppTheme.font(11, this.largeSimpleMode)).fontColor(AppTheme.muted).width('100%').textAlign(TextAlign.Center) }
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 18, right: 18, top: 4, bottom: 20 })
      }.layoutWeight(1).width('100%').align(Alignment.Top)
      AppTabBar({ active: 'settings', onSelect: (page: string): void => { this.navigate(page); } })
    }.width('100%').height('100%').backgroundColor(AppTheme.canvas)
  }
}
