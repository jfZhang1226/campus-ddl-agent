import { LocalStore } from '../../client/entry/src/main/ets/data/LocalStore';
import { CommitServices } from '../../client/entry/src/main/ets/data/CommitServices';
import { LocalNoticeImportRuntime, NoticeImportInput, NoticeImportRuntime, NoticeImportWrite } from '../../client/entry/src/main/ets/data/NoticeImportRepository';
import { NoticeImportWriter } from '../../client/entry/src/main/ets/notice/NoticeImportController';
import { NoticeDraft } from '../../client/entry/src/main/ets/notice/NoticeDraftModels';
import { CommitProposal, CommitReceipt, ConfirmedCommitRequest, ProposalDraft, TaskChangeDraft } from '../../client/entry/src/main/ets/domain/CommitModels';
import { Notice } from '../../client/entry/src/main/ets/domain/StorageModels';
import { sha256Hex } from '../../client/entry/src/main/ets/data/storage/Sha256';
import { StorageFailure, StorageResult, storageError, storageSuccess } from '../../client/entry/src/main/ets/data/storage/StorageTypes';

// This is a dedicated import namespace, not an invented chat/session transcript.
export const NOTICE_IMPORT_SESSION: string = 'session-t19-notice-import';
export class PendingNotice {
  draft: NoticeDraft = new NoticeDraft();
  materialFromNotice: boolean[] = [];
  revision: number = 0;
}
function value<T>(r: StorageResult<T>): T {
  if (!r.success || r.data === null) throw new StorageFailure(r.errorCode === null ? 'STORAGE_FAILED' : r.errorCode, r.message);
  return r.data;
}

/** Trusted screen capability. No base CRUD fallback and no model tool registration. */
export class NoticeConfirmedWriter implements NoticeImportWriter {
  private pending: CommitProposal | null = null;
  private request: ConfirmedCommitRequest | null = null;
  private uncertain: boolean = false;
  private active: boolean = false;
  private committed: boolean = false;
  constructor(private store: LocalStore, private commits: CommitServices,
    private runtime: NoticeImportRuntime = new LocalNoticeImportRuntime()) {}

  locked(): boolean { return !this.committed && (this.pending !== null || this.uncertain); }
  async revision(): Promise<StorageResult<number>> {
    try { return storageSuccess(value(await this.store.read()).revision); }
    catch (e) { return storageError<number>(e as Error); }
  }
  private draftOf(p: CommitProposal): PendingNotice {
    if (p.changes.length !== 1 || p.changes[0].action !== 'create' || p.notices.length !== 1 || p.checklistItems === undefined) {
      throw new StorageFailure('UNSUPPORTED_SCHEMA', '暂存方案不属于本通知导入入口，不能猜测恢复。');
    }
    const source: Notice = p.notices[0];
    const result = new PendingNotice();
    result.draft.notice = { rawText: source.rawText, sourceLabel: source.sourceLabel, publishedAt: source.publishedAt, timezone: source.timezone };
    result.draft.task = Object.assign(result.draft.task, p.changes[0].draft);
    result.draft.checklistItems = p.checklistItems.map(item => ({ label: item.label, state: 'pending' }));
    result.materialFromNotice = p.checklistItems.map(item => item.sourceNoticeId !== null);
    result.revision = p.expectedRevision;
    return result;
  }
  private key(draft: NoticeDraft, origins: boolean[]): string {
    // Explicit fields only: do not compare model clarification metadata or reserved/audit IDs.
    return JSON.stringify([draft.notice.rawText, draft.notice.sourceLabel, draft.notice.publishedAt, draft.notice.timezone,
      draft.task.title, draft.task.course, draft.task.kind, draft.task.deadlinePrecision, draft.task.deadlineDate,
      draft.task.dueAt, draft.task.timezone, draft.task.priority, draft.task.remainingMinutes, draft.task.submissionChannel,
      draft.checklistItems.map(item => item.label), origins]);
  }
  private async pendingFromDisk(): Promise<CommitProposal | null> {
    const entries = value(await this.commits.proposals.list()).filter(p => p.sessionId === NOTICE_IMPORT_SESSION && p.state === 'pending');
    if (entries.length > 1) throw new StorageFailure('RECOVERY_REQUIRED', '有多个待确认导入方案，请先核对，不能自动选择或新增。');
    return entries.length === 0 ? null : entries[0];
  }
  async recover(): Promise<StorageResult<PendingNotice | null>> {
    try {
      if (this.committed) return storageSuccess(null);
      if (this.request !== null && this.pending !== null) return storageSuccess(this.draftOf(this.pending));
      this.pending = await this.pendingFromDisk();
      this.uncertain = false;
      return storageSuccess(this.pending === null ? null : this.draftOf(this.pending));
    } catch (e) { this.uncertain = true; return storageError<PendingNotice | null>(e as Error); }
  }
  async create(input: NoticeImportInput, revision: number): Promise<StorageResult<NoticeImportWrite>> {
    if (this.active) return storageError<NoticeImportWrite>(new StorageFailure('BUSY', '正在处理本次确认，请勿重复提交。'));
    this.active = true;
    try {
      const draft = input.draft;
      const origins = input.materialFromNotice;
      if (origins === null || origins === undefined || origins.length !== draft.checklistItems.length ||
        !origins.every(entry => typeof entry === 'boolean') || draft.notice.timezone !== draft.task.timezone) {
        throw new StorageFailure('INVALID_ARGUMENT', '请核对材料来源和任务时区。');
      }
      // Reuse an in-memory request even when a previous apply response was lost.
      if (this.pending === null) this.pending = await this.pendingFromDisk();
      if (this.pending !== null) {
        const restored = this.draftOf(this.pending);
        if (this.key(restored.draft, restored.materialFromNotice) !== this.key(draft, origins)) {
          throw new StorageFailure('PROPOSAL_CHANGED', '已有暂存方案；请先取消暂存方案，再修改内容。');
        }
      } else {
        if (this.uncertain) throw new StorageFailure('RECOVERY_REQUIRED', '上次暂存结果未确认，请先重新读取，不能新建重复方案。');
        const snapshot = value(await this.store.read());
        if (snapshot.revision !== revision) throw new StorageFailure('VERSION_CONFLICT', '本地数据已变化，请重读后再次确认。');
        const noticeId: string = this.runtime.nextId('notice');
        const proposal = new ProposalDraft();
        proposal.sessionId = NOTICE_IMPORT_SESSION; proposal.expectedRevision = revision;
        proposal.notices = [{ id: noticeId, rawText: draft.notice.rawText, sourceLabel: draft.notice.sourceLabel,
          publishedAt: draft.notice.publishedAt, importedAt: this.runtime.now(), timezone: draft.notice.timezone,
          contentHash: sha256Hex(draft.notice.rawText) }];
        const change = new TaskChangeDraft();
        Object.assign(change.draft, draft.task, { status: 'todo', noticeIds: [noticeId] });
        change.checklistCreates = draft.checklistItems.map((item, i: number) =>
          ({ label: item.label, sourceNoticeId: origins[i] ? noticeId : null }));
        proposal.changes = [change];
        // A failed stage may have reached disk. Never automatically stage again in this call.
        this.uncertain = true;
        const staged = await this.commits.proposals.stage(proposal);
        if (!staged.success || staged.data === null) throw new StorageFailure(staged.errorCode === null ? 'STORAGE_FAILED' : staged.errorCode,
          '方案暂存未获确认，请重新读取本地结果后再决定；没有回退普通保存。');
        this.pending = staged.data; this.uncertain = false;
      }
      if (this.request === null) this.request = value(await this.commits.confirmation.confirm(this.pending.id, this.pending.expectedRevision));
      const receipt = value(await this.commits.confirmation.apply(this.request));
      this.committed = true;
      const notice = receipt.notices === undefined ? undefined : receipt.notices[0];
      if (notice === undefined || receipt.checklistItems === undefined || receipt.tasks.length !== 1) {
        throw new StorageFailure('UNSUPPORTED_SCHEMA', '已提交结果形态不匹配，请读取回执，不能重新创建。');
      }
      return storageSuccess(new NoticeImportWrite(notice, receipt.tasks[0], receipt.checklistItems, receipt.committedRevision));
    } catch (e) { return storageError<NoticeImportWrite>(e as Error); }
    finally { this.active = false; }
  }
  async discard(): Promise<StorageResult<number>> {
    if (this.active) return storageError<number>(new StorageFailure('BUSY', '保存中不能取消。'));
    this.active = true;
    try {
      if (this.committed) throw new StorageFailure('ALREADY_APPLIED', '该方案已保存，请读取实际结果。');
      const current = value(await this.store.read());
      const pending = await this.pendingFromDisk();
      if (pending !== null) value(await this.commits.confirmation.cancel(pending.id, current.revision));
      else if (this.request !== null) {
        const receipt = await this.commits.confirmation.receipt(this.request.operationId);
        if (receipt.success) throw new StorageFailure('ALREADY_APPLIED', '该方案已保存，请读取实际结果。');
        if (receipt.errorCode !== 'NOT_FOUND') value(receipt);
      }
      this.pending = null; this.request = null; this.uncertain = false;
      return this.revision();
    } catch (e) { return storageError<number>(e as Error); }
    finally { this.active = false; }
  }
  async readSaved(): Promise<StorageResult<NoticeImportWrite | null>> {
    try {
      const entries = value(await this.commits.proposals.list()).filter(p => p.sessionId === NOTICE_IMPORT_SESSION && p.state === 'applied');
      entries.sort((a, b) => b.expectedRevision - a.expectedRevision);
      if (entries.length === 0) return storageSuccess(null);
      const receipt = value(await this.commits.confirmation.receipt(entries[0].operationId as string));
      const snapshot = value(await this.store.read());
      const task = snapshot.tasks.find(item => item.id === receipt.tasks[0].id);
      const notice = snapshot.notices.find(item => item.id === entries[0].notices[0].id);
      if (task === undefined || notice === undefined) throw new StorageFailure('NOT_FOUND', '已提交，但当前任务或来源无法回读；请保留回执。');
      return storageSuccess(new NoticeImportWrite(notice, task, snapshot.checklistItems.filter(item => item.taskId === task.id), snapshot.revision));
    } catch (e) { return storageError<NoticeImportWrite | null>(e as Error); }
  }
}
