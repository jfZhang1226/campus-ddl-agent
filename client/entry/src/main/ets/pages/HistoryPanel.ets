import { Session } from '../domain/StorageModels';
import { SessionIssue } from '../data/SessionStore';
import { HistoryMessageView, HistoryViewState, historyError, historyTime } from '../chat/HistoryController';

@Component
export struct HistoryPanel {
  @Prop view: HistoryViewState = new HistoryViewState();
  @Prop activeSessionId: string = '';
  @Prop chatAvailable: boolean = true;
  onChat: () => void = () => {};
  onList: () => void = () => {};
  onDetail: (id: string) => void = (id: string) => {};
  onContinue: (id: string) => void = (id: string) => {};
  onNew: () => void = () => {};

  private interactive(): boolean {
    return this.chatAvailable && !this.view.loading && !this.view.switching && this.view.confirmation.length === 0;
  }

  @Builder
  header() {
    Column({ space: 12 }) {
      Row({ space: 10 }) {
        Button('返回对话').id('history-return-chat').fontSize(13)
          .fontColor('#176766').backgroundColor('#E1F0EC')
          .enabled(!this.view.switching && this.view.confirmation.length === 0).onClick(() => this.onChat())
        Text(this.view.page === 'detail' ? '会话详情' : '会话历史')
          .fontSize(22).fontWeight(FontWeight.Bold).fontColor('#142C43').layoutWeight(1)
      }.width('100%')
      Row({ space: 10 }) {
        if (this.view.page === 'detail') {
          Button('返回列表').id('history-back-list').fontSize(13).enabled(this.interactive()).onClick(() => this.onList())
        } else {
          Button('刷新列表').id('history-refresh-list').fontSize(13).enabled(this.interactive()).onClick(() => this.onList())
        }
        Button('新对话').id('history-new-chat').fontSize(13).enabled(this.interactive()).onClick(() => this.onNew())
        Blank()
      }.width('100%')
    }.padding(18).width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  sessionRow(session: Session) {
    Column({ space: 7 }) {
      Row({ space: 8 }) {
        Text(session.title).fontSize(17).fontWeight(FontWeight.Medium).fontColor('#142C43')
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        if (session.id === this.activeSessionId) {
          Text('当前').fontSize(11).fontColor('#176766').padding(5).backgroundColor('#E1F0EC').borderRadius(6)
        }
      }.width('100%')
      Text('更新于 ' + historyTime(session.updatedAt)).fontSize(12).fontColor('#617589')
      if (session.pendingProposalId !== null) { Text('有待确认内容 · 本页仅回看').fontSize(12).fontColor('#617589') }
      Text('查看记录 ›').fontSize(13).fontColor('#176766')
    }.padding(16).width('100%').backgroundColor('#FFFFFF').borderRadius(14).alignItems(HorizontalAlign.Start)
      .id('history-session-' + session.id).onClick(() => { if (this.interactive()) this.onDetail(session.id); })
  }

  @Builder
  issueRow(issue: SessionIssue) {
    Column({ space: 7 }) {
      Text('有一份会话暂不可读').fontSize(16).fontWeight(FontWeight.Medium).fontColor('#A43B32')
      Text(historyError(issue.errorCode)).fontSize(13).fontColor('#617589').lineHeight(20)
      Text('会话标识：' + issue.sessionId).fontSize(11).fontColor('#617589').copyOption(CopyOptions.InApp)
      Button('尝试读取').id('history-issue-' + issue.sessionId).fontSize(12)
        .enabled(this.interactive()).onClick(() => this.onDetail(issue.sessionId))
    }.padding(16).width('100%').backgroundColor('#FFF4EE').borderRadius(14).alignItems(HorizontalAlign.Start)
  }

  @Builder
  list() {
    List({ space: 12 }) {
      if (this.view.listLoaded && !this.view.loading && this.view.sessions.length === 0 && this.view.issues.length === 0) {
        ListItem() {
          Column({ space: 12 }) {
            Text('还没有保存的会话').fontSize(20).fontColor('#142C43')
            Text('发送第一条消息后，对话会保存在本机，可离线回看。').fontSize(14).fontColor('#617589').lineHeight(22)
            Button('开始新对话').id('history-empty-new').enabled(this.interactive()).onClick(() => this.onNew())
          }.padding(24).width('100%').alignItems(HorizontalAlign.Start)
        }
      }
      ForEach(this.view.sessions, (session: Session) => {
        ListItem() { this.sessionRow(session) }
      }, (session: Session) => session.id)
      ForEach(this.view.issues, (issue: SessionIssue) => {
        ListItem() { this.issueRow(issue) }
      }, (issue: SessionIssue) => issue.sessionId)
    }.layoutWeight(1).width('100%').padding({ left: 16, right: 16, bottom: 16 })
  }

  @Builder
  message(row: HistoryMessageView) {
    Column({ space: 8 }) {
      Text(row.role + ' · ' + row.kind).fontSize(14).fontWeight(FontWeight.Bold).fontColor('#176766')
      Text(row.time + ' · ' + row.status).fontSize(11).fontColor('#617589').lineHeight(18)
      if (row.text.length > 0) { Text(row.text).fontSize(16).fontColor('#142C43').lineHeight(25).copyOption(CopyOptions.InApp) }
      if (row.calls.length > 0) {
        Text('调用记录（仅回看）').fontSize(13).fontWeight(FontWeight.Medium).fontColor('#142C43')
        Text(row.calls).fontSize(12).fontFamily('monospace').fontColor('#334155').lineHeight(20).copyOption(CopyOptions.InApp)
      }
      if (row.results.length > 0) {
        Text('结果记录（仅回看）').fontSize(13).fontWeight(FontWeight.Medium).fontColor('#142C43')
        Text(row.results).fontSize(12).fontFamily('monospace').fontColor('#334155').lineHeight(20).copyOption(CopyOptions.InApp)
      }
      if (row.legacy.trim().length > 0) {
        Text('保留的工具摘要').fontSize(13).fontColor('#617589')
        Text(row.legacy).fontSize(14).fontColor('#334155').lineHeight(22).copyOption(CopyOptions.InApp)
      }
      if (row.text.length === 0 && row.calls.length === 0 && row.results.length === 0 && row.legacy.trim().length === 0) {
        Text('（空消息）').fontSize(14).fontColor('#617589')
      }
    }.padding(16).width('100%').alignItems(HorizontalAlign.Start).backgroundColor('#FFFFFF').borderRadius(14)
  }

  @Builder
  detail() {
    if (this.view.detail !== null) {
      Column({ space: 7 }) {
        Text(this.view.detail.session.title).fontSize(20).fontWeight(FontWeight.Bold).fontColor('#142C43').copyOption(CopyOptions.InApp)
        Text('创建于 ' + historyTime(this.view.detail.session.createdAt)).fontSize(11).fontColor('#617589')
        Text(String(this.view.messages.length) + ' 条消息 · 更新于 ' + historyTime(this.view.detail.session.updatedAt))
          .fontSize(11).fontColor('#617589')
        Text('查看记录不会发送请求或执行工具。').fontSize(12).fontColor('#617589')
        Button(this.view.selectedId === this.activeSessionId ? '返回当前对话' : '继续此会话')
          .id('history-continue').enabled(this.interactive()).onClick(() => this.onContinue(this.view.selectedId))
      }.padding({ left: 18, right: 18, bottom: 14 }).width('100%').alignItems(HorizontalAlign.Start)
    }
    List({ space: 12 }) {
      if (this.view.detail !== null && this.view.messages.length === 0) {
        ListItem() { Text('这个会话尚无消息。').fontSize(14).fontColor('#617589').padding(20) }
      }
      ForEach(this.view.messages, (row: HistoryMessageView) => {
        ListItem() { this.message(row) }
      }, (row: HistoryMessageView) => this.view.selectedId + ':' + row.id)
    }.layoutWeight(1).width('100%').padding({ left: 16, right: 16, bottom: 16 })
  }

  build() {
    Column({ space: 0 }) {
      this.header()
      if (this.view.loading || this.view.switching) {
        Row({ space: 8 }) {
          LoadingProgress().width(22).height(22).color('#176766')
          Text(this.view.switching ? '正在切换会话…' : '正在读取本机历史…').fontSize(13).fontColor('#617589')
        }.padding(12).width('100%')
      }
      if (this.view.error.length > 0) {
        Column({ space: 8 }) {
          Text(this.view.error).fontSize(14).fontColor('#A43B32').lineHeight(22)
          Button('重试读取').id('history-retry-read').fontSize(12).enabled(this.interactive())
            .onClick(() => { if (this.view.page === 'detail') this.onDetail(this.view.selectedId); else this.onList(); })
        }.padding(16).width('100%').alignItems(HorizontalAlign.Start)
      }
      if (this.view.notice.length > 0) { Text(this.view.notice).fontSize(13).fontColor('#617589').padding(12) }
      if (this.view.page === 'detail') { this.detail() } else { this.list() }
    }.width('100%').layoutWeight(1)
  }
}
