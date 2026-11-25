import { LocalStore } from '../data/LocalStore';
import { CommitServices } from '../data/CommitServices';
import { BusinessSnapshot, Task } from '../domain/StorageModels';
import { CommitProposal, CommitReceipt, ConfirmedCommitRequest } from '../domain/CommitModels';
import { StorageFailure, StorageResult } from '../data/storage/StorageTypes';
import { AvailabilityBlock, PlanBlock } from './WeekPlanner';
import { PLAN_PROPOSAL_RECORD, PlanningIntent } from './PlanningContracts';
import { planningCollections } from './PlanningRules';

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function value<T>(result: StorageResult<T>): T {
  if (!result.success || result.data === null) throw new StorageFailure(result.errorCode || 'STORAGE_FAILED', result.message);
  return result.data;
}
const SESSION: string = 'manual-week-plan';
export class PlanningView {
  busy: boolean = false;
  loaded: boolean = false;
  recoveryRequired: boolean = false;
  revision: number = 0;
  tasks: Task[] = [];
  availability: AvailabilityBlock[] = [];
  blocks: PlanBlock[] = [];
  pending: CommitProposal | null = null;
  receipt: CommitReceipt | null = null;
  notice: string = '';
  errorCode: string = '';
}
/** Same C engine and application snapshot; the screen owns the only confirmation action. */
export class PlanningController {
  private view: PlanningView = new PlanningView();
  private observer: ((view: PlanningView) => void) | undefined;
  private request: ConfirmedCommitRequest | null = null;
  private disposed: boolean = false;
  constructor(private store: LocalStore, private commits: CommitServices) {}
  snapshot(): PlanningView { return copy(this.view); }
  subscribe(observer: (view: PlanningView) => void): void { this.observer = observer; this.publish(); }
  private publish(): void { if (!this.disposed) this.observer?.(this.snapshot()); }
  private error(error: Error): void {
    this.view.errorCode = error instanceof StorageFailure ? error.code : 'STORAGE_FAILED';
    this.view.notice = error instanceof StorageFailure ? error.message : '安排结果尚未核实，请重新读取，不能假定保存成功。';
    if (['VERSION_CONFLICT', 'PLAN_EXPIRED'].includes(this.view.errorCode)) this.view.notice += ' 请放弃本方案，刷新后重新核对；不会自动移动安排。';
  }
  private async readFormal(): Promise<void> {
    const snapshot: BusinessSnapshot = value(await this.store.read()); planningCollections(snapshot);
    this.view.revision = snapshot.revision; this.view.tasks = copy(snapshot.tasks);
    this.view.availability = copy(snapshot.availabilityBlocks as AvailabilityBlock[]);
    this.view.blocks = copy(snapshot.planBlocks as PlanBlock[]); this.view.loaded = true;
  }
  async recover(): Promise<void> {
    if (this.disposed || this.view.busy) return;
    this.view.busy = true; this.publish();
    try {
      const proposals = value(await this.commits.proposals.list()).filter(proposal => proposal.recordType === PLAN_PROPOSAL_RECORD && proposal.sessionId === SESSION);
      const pending = proposals.filter(proposal => proposal.state === 'pending');
      if (pending.length > 1) throw new StorageFailure('RECOVERY_REQUIRED', '存在多个待确认安排，请保留数据并核对，不能自动选择。');
      this.view.pending = pending[0] || null;
      if (this.request !== null && this.request.proposalId !== this.view.pending?.id) this.request = null;
      const completed = proposals.filter(proposal => proposal.state === 'applied').sort((a, b) => b.expectedRevision - a.expectedRevision);
      if (completed.length > 0) this.view.receipt = value(await this.commits.confirmation.receipt(completed[0].operationId as string));
      await this.readFormal(); this.view.recoveryRequired = false; this.view.errorCode = '';
      this.view.notice = this.view.pending === null ? '已读取正式安排，没有自动生成或保存。' : '已恢复待确认安排，请重新核对；没有自动保存。';
    } catch (error) { this.view.recoveryRequired = true; this.view.loaded = false; this.error(error as Error); }
    finally { this.view.busy = false; this.publish(); }
  }
  async stage(intent: PlanningIntent): Promise<void> {
    if (this.disposed || this.view.busy || !this.view.loaded || this.view.pending !== null || this.view.recoveryRequired) return;
    this.view.busy = true; this.view.errorCode = ''; this.publish();
    try {
      this.view.recoveryRequired = true;
      const result = await this.commits.proposals.stage({ sessionId: SESSION, expectedRevision: this.view.revision, notices: [], changes: [], planning: copy(intent) });
      if (!result.success || result.data === null) {
        if (['INVALID_ARGUMENT', 'VERSION_CONFLICT', 'CONFIRMATION_REQUIRED', 'NOT_FOUND', 'UNSUPPORTED_SCHEMA'].includes(result.errorCode || '')) this.view.recoveryRequired = false;
        throw new StorageFailure(result.errorCode || 'STORAGE_FAILED', result.message);
      }
      this.view.pending = result.data; this.request = null; this.view.revision = result.data.expectedRevision;
      this.view.recoveryRequired = false; this.view.notice = '安排尚未保存。请核对旧值、新值和未安排原因后确认。';
    } catch (error) { this.error(error as Error); }
    finally { this.view.busy = false; this.publish(); }
  }
  async confirm(): Promise<boolean> {
    if (this.disposed || this.view.busy || this.view.pending === null || this.view.recoveryRequired) return false;
    this.view.busy = true; this.view.errorCode = ''; this.publish();
    try {
      const proposal = this.view.pending;
      if (this.request === null) this.request = value(await this.commits.confirmation.confirm(proposal.id, proposal.expectedRevision));
      this.view.receipt = value(await this.commits.confirmation.apply(this.request));
      this.view.pending = null; this.request = null;
      try { await this.readFormal(); this.view.notice = '安排已保存并回读。任务截止保持不变；缺口仍需处理。'; }
      catch (error) { this.view.loaded = false; this.view.recoveryRequired = true; this.error(error as Error); this.view.notice = '已取得正式保存回执，但页面回读失败，请重新读取；不要重复生成。'; }
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
      this.view.pending = null; this.request = null; await this.readFormal();
      this.view.notice = '已放弃本次安排，原安排和任务保持不变。'; this.view.errorCode = '';
    } catch (error) { this.view.recoveryRequired = true; this.error(error as Error); }
    finally { this.view.busy = false; this.publish(); }
  }
  dispose(): void { this.disposed = true; this.observer = undefined; }
}
