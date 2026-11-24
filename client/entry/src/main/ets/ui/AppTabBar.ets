import { AppTheme } from './AppTheme';

@Component
export struct AppTabBar {
  active: string = 'assistant';
  enabledTabs: boolean = true;
  onSelect: (page: string) => void = (_page: string): void => {};
  private icon(tab: string): Resource {
    return tab === 'assistant' ? $r('app.media.nav_assistant') : tab === 'tasks' ? $r('app.media.nav_tasks') :
      tab === 'schedule' ? $r('app.media.nav_schedule') : $r('app.media.nav_settings');
  }
  @Builder
  item(tab: string, label: string, page: string) {
    Column({ space: 5 }) {
      Image(this.icon(tab)).width(22).height(22).opacity(this.active === tab ? 1 : 0.45)
      Text(label).fontSize(11).fontWeight(this.active === tab ? FontWeight.Medium : FontWeight.Regular)
        .fontColor(this.active === tab ? AppTheme.primary : AppTheme.muted)
    }.layoutWeight(1).height(52).justifyContent(FlexAlign.Center).borderRadius(14)
      .backgroundColor(this.active === tab ? AppTheme.soft : '#FFFFFF')
      .id('tab-' + tab).enabled(this.enabledTabs).onClick(() => { if (this.active !== tab && this.enabledTabs) this.onSelect(page); })
  }
  build() {
    Row({ space: 12 }) {
      this.item('assistant', '助手', 'pages/TaskAssistant')
      this.item('tasks', '任务', 'pages/Tasks')
      this.item('schedule', '安排', 'pages/Schedule')
      this.item('settings', '设置', 'pages/GatewaySettings')
    }.width('100%').padding({ left: 24, right: 24, top: 10, bottom: 10 }).backgroundColor('#FFFFFF')
      .border({ width: { top: 1 }, color: AppTheme.border })
  }
}
