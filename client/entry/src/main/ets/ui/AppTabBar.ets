import { AppTheme } from './AppTheme';

@Component
export struct AppTabBar {
  @Prop active: string = 'assistant';
  @Prop enabledTabs: boolean = true;
  onSelect: (page: string) => void = (_page: string): void => {};
  private icon(tab: string): Resource {
    return tab === 'assistant' ? $r('app.media.nav_assistant') : tab === 'tasks' ? $r('app.media.nav_tasks') :
      tab === 'schedule' ? $r('app.media.nav_schedule') : $r('app.media.nav_settings');
  }
  @Builder
  item(tab: string, label: string, page: string) {
    Column({ space: 5 }) {
      Image(this.icon(tab)).width(21).height(21).opacity(this.active === tab ? 1 : 0.48)
      Text(label).fontSize(11).fontWeight(this.active === tab ? FontWeight.Medium : FontWeight.Regular)
        .fontColor(this.active === tab ? AppTheme.primary : AppTheme.muted)
    }.layoutWeight(1).height(50).justifyContent(FlexAlign.Center).borderRadius(18)
      .backgroundColor(this.active === tab ? AppTheme.userMessage : Color.Transparent)
      .id('tab-' + tab).accessibilityGroup(true)
      .accessibilityText(label + (this.active === tab ? '，当前页面' : ''))
      .enabled(this.enabledTabs).onClick(() => { if (this.active !== tab && this.enabledTabs) this.onSelect(page); })
  }
  build() {
    Column() {
      Row({ space: 5 }) {
        this.item('assistant', '助手', 'pages/TaskAssistant')
        this.item('tasks', '任务', 'pages/Tasks')
        this.item('schedule', '安排', 'pages/Schedule')
        this.item('settings', '设置', 'pages/GatewaySettings')
      }.width('100%').padding(6).backgroundColor(AppTheme.surface).borderRadius(24)
        .border({ width: 1, color: AppTheme.border })
    }.width('100%').padding({ left: 16, right: 16, top: 5, bottom: 10 }).backgroundColor(AppTheme.canvas)
  }
}
