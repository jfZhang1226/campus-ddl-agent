import { NoticeVoiceController } from './NoticeVoiceController';
import { NoticeConfirmedWriter } from './NoticeConfirmedWriter';
import { NoticeExtractionTransport } from '../../client/entry/src/main/ets/notice/NoticeImportProtocol';
import { SpeechSession } from '../../client/entry/src/main/ets/speech/VoiceChatController';
import { NoticeImportWrite } from '../../client/entry/src/main/ets/data/NoticeImportRepository';

export class NoticeSaveView {
  busy: boolean = false;
  locked: boolean = false;
  message: string = '';
  errorCode: string = '';
  readbackError: string = '';
  saved: NoticeImportWrite | null = null;
}

/** Screen-only coordinator. The model receives no CommitServices/confirmation capability. */
export class NoticeSaveController extends NoticeVoiceController {
  private commitView: NoticeSaveView = new NoticeSaveView();
  private commitObserver: ((view: NoticeSaveView) => void) | undefined;
  private closed: boolean = false;
  private readGeneration: number = 0;
  constructor(transport: NoticeExtractionTransport, private confirmedWriter: NoticeConfirmedWriter, speech: SpeechSession) {
    super(transport, confirmedWriter, speech);
  }
  saveSnapshot(): NoticeSaveView {
    return JSON.parse(JSON.stringify(this.commitView)) as NoticeSaveView;
  }
  subscribeSave(observer: (view: NoticeSaveView) => void): void { this.commitObserver = observer; this.publishSave(); }
  private publishSave(): void {
    if (this.closed) return;
    this.commitView.locked = this.confirmedWriter.locked();
    if (this.commitObserver !== undefined) this.commitObserver(this.saveSnapshot());
  }
  private cannotEdit(): boolean { return this.closed || this.commitView.busy || this.confirmedWriter.locked(); }
  async restore(): Promise<void> {
    if (this.closed || this.commitView.busy || this.speechSnapshot().busy ||
      ['saving', 'extracting', 'refreshing'].includes(this.snapshot().phase)) return;
    this.commitView.busy = true; this.publishSave();
    const recovered = await this.confirmedWriter.recover();
    if (this.closed) return;
    this.commitView.errorCode = recovered.errorCode === null ? '' : recovered.errorCode;
    if (!recovered.success) this.commitView.message = '暂存结果无法确认，请重新读取；不能新增或丢弃未知结果。';
    else if (recovered.data !== null) {
      super.restorePending(recovered.data.draft, recovered.data.materialFromNotice, recovered.data.revision);
      this.commitView.message = '已恢复待确认方案；内容已锁定。核对后确认，或取消暂存后再修改。';
    } else {
      const current = await this.confirmedWriter.revision();
      if (this.closed) return;
      if (current.success && current.data !== null) super.setExpectedRevision(current.data);
      else this.commitView.errorCode = current.errorCode === null ? 'STORAGE_FAILED' : current.errorCode;
      this.commitView.message = current.success ? '' : '当前版本无法读取，请保留内容后重试。';
    }
    this.commitView.busy = false; this.publishSave();
    await this.readSaved();
  }
  async readSaved(): Promise<void> {
    if (this.closed) return;
    const generation: number = ++this.readGeneration;
    const result = await this.confirmedWriter.readSaved();
    if (this.closed || generation !== this.readGeneration) return;
    if (result.success) { this.commitView.saved = result.data; this.commitView.readbackError = ''; }
    else {
      this.commitView.saved = null;
      this.commitView.readbackError = '保存历史暂时无法回读；请重试读取，不要重复创建。';
    }
    this.publishSave();
  }
  async confirm(): Promise<void> {
    if (this.closed || this.commitView.busy) return;
    ++this.readGeneration;
    await super.confirm();
    if (this.closed) return;
    this.commitView.errorCode = '';
    this.commitView.message = this.confirmedWriter.locked() && this.snapshot().phase !== 'saved' ?
      '原方案已保留。请重试确认；若需修改或已发生版本冲突，请取消暂存后重新整理。' : '';
    this.publishSave();
    if (this.snapshot().phase === 'saved') await this.readSaved();
  }
  async cancelPending(): Promise<void> {
    if (this.closed || this.commitView.busy || ['saving', 'extracting', 'refreshing'].includes(this.snapshot().phase)) return;
    this.cancelVoice();
    this.commitView.busy = true; this.publishSave();
    const result = await this.confirmedWriter.discard();
    if (this.closed) return;
    this.commitView.busy = false;
    if (result.success && result.data !== null) {
      super.cancel(); super.setExpectedRevision(result.data);
      this.commitView.message = ''; this.commitView.errorCode = '';
    } else {
      this.commitView.errorCode = result.errorCode === null ? 'STORAGE_FAILED' : result.errorCode;
      this.commitView.message = '取消未完成，请保留当前内容并重新读取实际结果。';
    }
    this.publishSave();
    if (!result.success) await this.readSaved();
  }
  cancel(): void {
    if (this.closed || this.commitView.busy) return;
    if (this.confirmedWriter.locked()) { this.cancelPending(); return; }
    super.cancel();
  }
  async refreshRevision(): Promise<void> {
    if (this.closed || this.commitView.busy) return;
    if (this.confirmedWriter.locked()) { await this.restore(); return; }
    await super.refreshRevision();
  }
  setRawText(v: string): void { if (!this.cannotEdit()) super.setRawText(v); }
  setSourceLabel(v: string): void { if (!this.cannotEdit()) super.setSourceLabel(v); }
  setPublishedAt(v: string): void { if (!this.cannotEdit()) super.setPublishedAt(v); }
  edit(field: string, v: string): void { if (!this.cannotEdit()) super.edit(field, v); }
  setMaterial(i: number, v: string): void { if (!this.cannotEdit()) super.setMaterial(i, v); }
  addMaterial(): void { if (!this.cannotEdit()) super.addMaterial(); }
  removeMaterial(i: number): void { if (!this.cannotEdit()) super.removeMaterial(i); }
  extract(): void { if (!this.cannotEdit()) super.extract(); }
  async record(): Promise<void> { if (!this.cannotEdit()) await super.record(); }
  async speakDraft(): Promise<void> { if (!this.closed && !this.commitView.busy) await super.speakDraft(); }
  dispose(): void { this.closed = true; this.commitObserver = undefined; super.dispose(); }
}
