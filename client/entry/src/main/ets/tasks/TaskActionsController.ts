import { TaskDetail, TaskDraft } from '../domain/TaskContracts';
import { CommitProposal, CommitReceipt, ConfirmedCommitRequest, ProposalDraft, TaskChangeDraft, UserSubmissionSnapshot } from '../domain/CommitModels';
import { CommitServices } from '../data/CommitServices';
import { LocalStore } from '../data/LocalStore';
import { TaskReadPort } from './TaskBoardController';
import { isOperationRecord } from '../domain/CommitValidation';
import { StorageFailure, StorageResult } from '../data/storage/StorageTypes';
import { applyDeadline, DeadlineInput, deadlineNote } from '../ui/DeadlineInput';
import { sha256Hex } from '../data/storage/Sha256';
import { timestampMillis } from '../domain/DateRules';

function value<T>(result: StorageResult<T>): T {
  if (!result.success || result.data === null) throw new StorageFailure(result.errorCode || 'STORAGE_FAILED', result.message);
  return result.data;
}
function copy<T>(input: T): T { return JSON.parse(JSON.stringify(input)) as T; }
export class MaterialChoice {
  constructor(public itemId: string, public label: string, public state: string, public originalState: string) {}
}
export class TaskActionsView {
  busy: boolean = false;
  recoveryRequired: boolean = false;
  detail: TaskDetail | null = null;
  materials: MaterialChoice[] = [];
  pending: CommitProposal | null = null;
  receipt: CommitReceipt | null = null;
  submissions: UserSubmissionSnapshot[] = [];
  needsSubmissionReview: boolean = false;
  notice: string = '';
  errorCode: string = '';
}
const SESSION: string = 'manual-task-board';
/** No model/network port. Every write is a real staged C proposal followed by a screen action. */
export class TaskActionsController {
  private view: TaskActionsView = new TaskActionsView();
  private observer: ((view: TaskActionsView) => void) | undefined;
  private request: ConfirmedCommitRequest | null = null;
  private disposed: boolean = false;
  private generation: number = 0;
  constructor(private store: LocalStore, private tasks: TaskReadPort, private commits: CommitServices) {}
  snapshot(): TaskActionsView { return copy(this.view); }
  hasLocalChanges(): boolean { return this.view.pending === null && this.view.materials.some(item => item.state !== item.originalState); }
  discardLocalChanges(): void {
    if (this.disposed || this.view.busy || this.view.pending !== null || this.view.recoveryRequired) return;
    this.view.materials.forEach(item => { item.state = item.originalState; });
    this.view.notice = '已还原未保存的材料勾选，正式记录未改变。'; this.publish();
  }
  subscribe(observer: (view: TaskActionsView) => void): void { this.observer = observer; this.publish(); }
  private publish(): void { if (!this.disposed) this.observer?.(this.snapshot()); }
  private error(error: Error): void {
    this.view.errorCode = error instanceof StorageFailure ? error.code : 'STORAGE_FAILED';
    this.view.notice = error instanceof StorageFailure ? error.message : '本机操作未完成，请重新读取实际结果，不要重复提交。';
    if (this.view.errorCode === 'VERSION_CONFLICT' && this.view.pending !== null) this.view.notice += ' 本方案不会自动重算；请放弃本次修改，刷新任务后重新核对。';
  }
  async initialize(): Promise<void> { await this.recover(); }
  select(detail: TaskDetail | null): void {
    if (this.disposed || this.view.busy) return;
    this.view.detail = detail === null ? null : copy(detail);
    this.view.materials = detail === null ? [] : detail.checklistItems.map(item => new MaterialChoice(item.id, item.label, item.state, item.state));
    this.view.submissions = []; this.view.needsSubmissionReview = false;
    if (detail !== null) this.loadSubmissionHistory(detail);
    else { this.view.submissions = []; this.view.needsSubmissionReview = false; }
    this.publish();
  }
  private async loadSubmissionHistory(detail: TaskDetail): Promise<void> {
    const generation = ++this.generation;
    try {
      const snapshot = value(await this.store.read());
      if (this.disposed || generation !== this.generation || this.view.detail?.task.id !== detail.task.id) return;
      const history: UserSubmissionSnapshot[] = [];
      snapshot.operations.forEach(entry => {
        const receipt = entry as CommitReceipt;
        if (isOperationRecord(receipt.recordType)) (receipt.submissionSnapshots || []).forEach(submission => { if (submission.taskId === detail.task.id) history.push(copy(submission)); });
      });
      history.sort((a, b) => timestampMillis(a.confirmedSubmittedAt) - timestampMillis(b.confirmedSubmittedAt) || a.taskVersion - b.taskVersion);
      this.view.submissions = history;
      this.view.needsSubmissionReview = detail.task.status === 'submitted' && (history.length === 0 || history[history.length - 1].taskVersion !== detail.task.version);
      this.publish();
    } catch (error) { if (generation === this.generation) { this.error(error as Error); this.publish(); } }
  }
  toggle(itemId: string): void {
    if (this.disposed || this.view.busy || this.view.pending !== null || this.view.recoveryRequired) return;
    const item = this.view.materials.find(choice => choice.itemId === itemId);
    if (item === undefined || this.view.detail === null || ['done', 'cancelled'].includes(this.view.detail.task.status)) return;
    item.state = item.state === 'prepared' ? 'pending' : 'prepared'; this.publish();
  }
  private async stage(mode: string, label: string = '', effort: number | null = null, deadline: DeadlineInput | null = null): Promise<void> {
    if (this.disposed || this.view.busy || this.view.pending !== null || this.view.recoveryRequired || this.view.detail === null) return;
    const selected = copy(this.view.detail);
    const choices = copy(this.view.materials);
    this.view.busy = true; this.view.errorCode = ''; this.publish();
    try {
      const pending = value(await this.commits.proposals.list()).filter(proposal => proposal.sessionId === SESSION && proposal.state === 'pending');
      if (pending.length > 0) throw new StorageFailure('RECOVERY_REQUIRED', '已有待确认的任务修改，请先重新读取并处理。');
      const actual = value(await this.tasks.get(selected.task.id));
      if (actual.task.version !== selected.task.version || JSON.stringify(actual.checklistItems) !== JSON.stringify(selected.checklistItems)) {
        throw new StorageFailure('VERSION_CONFLICT', '任务或材料已变化，请刷新后重新核对。');
      }
      if (['done', 'cancelled'].includes(actual.task.status) && mode !== 'edit') throw new StorageFailure('TASK_FINISHED', '此任务已结束，新增工作请建立后续任务，原历史会保留。');
      const draft = new TaskDraft();
      draft.title = actual.task.title; draft.course = actual.task.course; draft.kind = actual.task.kind;
      draft.deadlinePrecision = actual.task.deadlinePrecision; draft.deadlineDate = actual.task.deadlineDate; draft.dueAt = actual.task.dueAt;
      draft.timezone = actual.task.timezone; draft.priority = actual.task.priority; draft.status = actual.task.status;
      draft.remainingMinutes = actual.task.remainingMinutes; draft.submissionChannel = actual.task.submissionChannel; draft.noticeIds = actual.task.noticeIds.slice();
      const change: TaskChangeDraft = { action: 'update', taskId: actual.task.id, expectedVersion: actual.task.version, draft: draft,
        checklistCreates: [], checklistUpdates: choices.filter(item => item.state !== item.originalState).map(item => ({ itemId: item.itemId, state: item.state })) };
      if (mode === 'add') {
        if (label.trim().length === 0 || label.length > 200) throw new StorageFailure('INVALID_ARGUMENT', '材料名称须为1至200字。');
        change.checklistCreates = [{ label: label.trim(), sourceNoticeId: null }];
      }
      const nextPending: boolean = mode === 'add' || choices.some(item => item.state === 'pending');
      if (draft.status === 'ready' && nextPending) draft.status = 'in_progress';
      if (mode === 'ready') draft.status = 'ready';
      if (mode === 'progress') draft.status = 'in_progress';
      if (mode === 'done') draft.status = 'done';
      if (mode === 'cancel') draft.status = 'cancelled';
      if (mode === 'submit') { draft.status = 'submitted'; change.confirmSubmission = true; }
      if (mode === 'effort') {
        if (effort !== null && (!Number.isSafeInteger(effort) || effort < 0)) throw new StorageFailure('INVALID_ARGUMENT', '剩余工时须为非负整数分钟，未知请留空。');
        if (effort === actual.task.remainingMinutes) throw new StorageFailure('INVALID_ARGUMENT', '剩余工时没有变化。');
        draft.remainingMinutes = effort;
      }
      if (mode === 'materials' && (change.checklistUpdates || []).length === 0) throw new StorageFailure('INVALID_ARGUMENT', '材料状态没有变化。');
      const input: ProposalDraft = { sessionId: SESSION, expectedRevision: actual.revision, notices: [], changes: [change] };
      if (mode === 'deadline' && deadline !== null) {
        const before = [draft.deadlinePrecision, draft.deadlineDate, draft.dueAt].join('|');
        applyDeadline(draft, deadline);
        if (before === [draft.deadlinePrecision, draft.deadlineDate, draft.dueAt].join('|')) throw new StorageFailure('INVALID_ARGUMENT', '截止时间没有变化。');
        const text = deadlineNote(draft); const snapshot = value(await this.store.read());
        input.notices = [{ id: 'notice-manual-' + sha256Hex(JSON.stringify([actual.task.id, actual.task.version, text])).slice(0, 32),
          rawText: text, sourceLabel: '人工补充 · 截止时间编辑', publishedAt: null, importedAt: new Date().toISOString(),
          timezone: draft.timezone, contentHash: sha256Hex(text) }];
        if (snapshot.notices.some(notice => notice.id === input.notices[0].id)) throw new StorageFailure('VERSION_CONFLICT', '该次修改已存在，请刷新任务。');
        draft.noticeIds.push(input.notices[0].id);
      }
      this.view.recoveryRequired = true; // Stage acknowledgement can be lost; no automatic second proposal.
      const result = await this.commits.proposals.stage(input);
      if (!result.success || result.data === null) {
        if (['INVALID_ARGUMENT', 'VERSION_CONFLICT', 'NOT_FOUND'].includes(result.errorCode || '')) this.view.recoveryRequired = false;
        throw new StorageFailure(result.errorCode || 'STORAGE_FAILED', result.message);
      }
      this.view.pending = result.data; this.request = null; this.view.recoveryRequired = false;
      this.view.notice = '已整理为修改方案，正式任务尚未改变。请核对后确认。';
    } catch (error) { this.error(error as Error); }
    finally { this.view.busy = false; this.publish(); }
  }
  prepareDeadline(date: string, time: string): Promise<void> { return this.stage('deadline', '', null, new DeadlineInput(date, time)); }
  prepareMaterials(): Promise<void> { return this.stage('materials'); }
  prepareStatus(status: string): Promise<void> {
    const modes: string[] = ['ready', 'progress', 'done', 'cancel', 'submit'];
    if (!modes.includes(status)) return Promise.resolve();
    return this.stage(status);
  }
  prepareAddMaterial(label: string): Promise<void> { return this.stage('add', label); }
  prepareEffort(minutes: number | null): Promise<void> { return this.stage('effort', '', minutes); }
  async confirm(): Promise<boolean> {
    if (this.disposed || this.view.busy || this.view.pending === null || this.view.recoveryRequired) return false;
    this.view.busy = true; this.view.errorCode = ''; this.publish();
    try {
      const proposal = this.view.pending;
      if (this.request === null) this.request = value(await this.commits.confirmation.confirm(proposal.id, proposal.expectedRevision));
      const receipt = value(await this.commits.confirmation.apply(this.request));
      this.view.receipt = receipt; this.view.pending = null; this.request = null;
      this.view.notice = '修改已保存。用户标记已提交仅为本机声明，不代表学校平台已收到。';
      return true;
    } catch (error) { this.error(error as Error); return false; }
    finally { this.view.busy = false; this.publish(); }
  }
  async cancel(): Promise<void> {
    if (this.disposed || this.view.busy || this.view.pending === null || this.view.recoveryRequired) return;
    this.view.busy = true; this.publish();
    try {
      const snapshot = value(await this.store.read());
      value(await this.commits.confirmation.cancel(this.view.pending.id, snapshot.revision));
      this.view.pending = null; this.request = null; this.view.notice = '已放弃本次修改，正式任务和提交历史保留。'; this.view.errorCode = '';
    } catch (error) { this.error(error as Error); }
    finally { this.view.busy = false; this.publish(); }
  }
  async recover(): Promise<void> {
    if (this.disposed || this.view.busy) return;
    this.view.busy = true; this.publish();
    try {
      const proposals = value(await this.commits.proposals.list()).filter(proposal => proposal.sessionId === SESSION);
      const pending = proposals.filter(proposal => proposal.state === 'pending');
      if (pending.length > 1) throw new StorageFailure('RECOVERY_REQUIRED', '存在多个待确认修改，请保留数据并逐项核对，不能自动选择。');
      this.view.pending = pending[0] || null;
      if (this.request !== null && this.view.pending?.id !== this.request.proposalId) this.request = null;
      const completed = proposals.filter(proposal => proposal.state === 'applied' && proposal.operationId !== null).sort((a, b) => b.expectedRevision - a.expectedRevision);
      if (completed.length > 0) this.view.receipt = value(await this.commits.confirmation.receipt(completed[0].operationId as string));
      this.view.recoveryRequired = false; this.view.errorCode = '';
      this.view.notice = this.view.pending === null ? '已读取实际修改结果，没有自动提交。' : '已恢复待确认修改，请重新核对后确认；没有自动提交。';
    } catch (error) { this.view.recoveryRequired = true; this.error(error as Error); }
    finally { this.view.busy = false; this.publish(); }
  }
  dispose(): void { this.disposed = true; ++this.generation; this.observer = undefined; }
}
