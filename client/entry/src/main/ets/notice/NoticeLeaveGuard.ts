import { NoticeImportState } from './NoticeImportController';

export class NoticeLeavePrompt {
  kind: string = 'closed';
  title: string = '';
  detail: string = '';
  action: string = '';
}

/** Navigation decision only: no storage, confirmation, cancellation or router capability. */
export class NoticeLeaveGuard {
  private kind: string = 'closed';

  private mode(view: NoticeImportState, commitBusy: boolean, locked: boolean, speechActive: boolean): string {
    if (commitBusy || view.phase === 'saving') return 'blocked';
    if (view.phase === 'saved') return 'leave';
    if (locked) return 'records';
    if (speechActive || view.draft !== null || view.rawText.trim().length > 0 ||
      view.sourceLabel.trim().length > 0 || view.publishedAt.trim().length > 0) return 'discard';
    return 'leave';
  }

  request(view: NoticeImportState, commitBusy: boolean, locked: boolean, speechActive: boolean): string {
    const mode: string = this.mode(view, commitBusy, locked, speechActive);
    if (mode === 'blocked') return 'blocked';
    if (this.kind !== 'closed') {
      if (mode === 'discard' || mode === 'records') this.kind = mode;
      return 'prompt';
    }
    if (mode === 'leave') { this.keepEditing(); return 'leave'; }
    this.kind = mode;
    return 'prompt';
  }

  confirmLeave(view: NoticeImportState, commitBusy: boolean, locked: boolean, speechActive: boolean): string {
    if (this.kind === 'closed') return 'blocked';
    const mode: string = this.mode(view, commitBusy, locked, speechActive);
    if (mode === 'blocked') return 'blocked';
    // A late recovery must not inherit consent to discard a different kind of content.
    if (mode !== 'leave' && mode !== this.kind) { this.kind = mode; return 'prompt'; }
    this.keepEditing();
    return 'leave';
  }

  keepEditing(): void { this.kind = 'closed'; }

  snapshot(): NoticeLeavePrompt {
    const prompt: NoticeLeavePrompt = new NoticeLeavePrompt();
    prompt.kind = this.kind;
    if (this.kind === 'discard') {
      prompt.title = '保留这次通知整理吗？';
      prompt.detail = '返回会丢失本页未保存的原文和草案。选择继续编辑，现有文字和修改都会保留；语音会停止。';
      prompt.action = '放弃本页内容并返回';
    } else if (this.kind === 'records') {
      prompt.title = '保存结果仍需核对';
      prompt.detail = '返回不会自动确认或取消本地已有记录。尚未落盘的文字可能丢失，请先复制需要的内容；重新进入后可继续核对。';
      prompt.action = '保留本地记录并返回';
    }
    return prompt;
  }
}
