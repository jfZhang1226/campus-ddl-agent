import { FilePort } from '../../adapters/storage/FilePort';
import { GatewayConfig } from '../../chat/ChatModels';
import { BusinessSnapshot, ChecklistItem } from '../../domain/StorageModels';
import { CommitProposal, CommitReceipt } from '../../domain/CommitModels';
import { TaskDraft } from '../../domain/TaskContracts';
import { NoticeConfirmedWriter, NOTICE_IMPORT_SESSION } from '../../notice/NoticeConfirmedWriter';
import { NoticeSaveController } from '../../notice/NoticeSaveController';
import { NoticeExtractionCall, NoticeExtractionRequest, NoticeExtractionTransport } from '../../notice/NoticeImportProtocol';
import { CommitServices } from '../CommitServices';
import { LocalStore } from '../LocalStore';
import { NoticeImportInput } from '../NoticeImportRepository';
import { TaskRepository } from '../TaskRepository';
import { StorageCoordinator } from '../storage/StorageCoordinator';
import { StorageFailure, StorageResult } from '../storage/StorageTypes';

const REPORT: string = 't19-recovery-report.json';
const RAW: string = '合成恢复验证：实验报告于2028年2月29日提交，材料为PDF报告。';
const TITLE: string = 'T19 合成恢复任务';

export class NoticeRecoveryReport {
  recordType: string = 't19.notice-recovery.v1';
  scenario: string = '';
  phase: string = '';
  revision: number = 0;
  proposalId: string = '';
  reservedTaskId: string = '';
  materialIds: string[] = [];
  independentTaskId: string = '';
  retriedOperationId: string = '';
  primary: string = '';
  checks: string[] = [];
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new StorageFailure('CHECK_FAILED', message);
}
function value<T>(r: StorageResult<T>): T {
  if (!r.success || r.data === null) throw new StorageFailure(r.errorCode === null ? 'CHECK_FAILED' : r.errorCode, r.message);
  return r.data;
}
function scenarioValid(scenario: string): boolean {
  return ['apply-failure', 'same-instance-retry', 'stage-ack-loss', 'apply-ack-loss', 'conflict'].includes(scenario);
}

/** No HTTP, microphone or model; these controls only exercise synthetic confirmation data. */
class NoModelTransport implements NoticeExtractionTransport {
  start(config: GatewayConfig, request: NoticeExtractionRequest): NoticeExtractionCall {
    throw new StorageFailure('CHECK_FAILED', '恢复验证不得请求模型。');
  }
}

/** One controlled primary replacement, always inside a fresh artificial namespace. */
class FaultPort implements FilePort {
  triggered: boolean = false;
  private remaining: number;
  private loseAcknowledgement: boolean;
  constructor(private files: FilePort, scenario: string) {
    this.remaining = scenario === 'stage-ack-loss' ? 1 : 2;
    this.loseAcknowledgement = scenario === 'stage-ack-loss' || scenario === 'apply-ack-loss';
  }
  ensureDirectory(name: string): Promise<void> { return this.files.ensureDirectory(name); }
  exists(name: string): Promise<boolean> { return this.files.exists(name); }
  readText(name: string): Promise<string> { return this.files.readText(name); }
  writeText(name: string, text: string): Promise<void> { return this.files.writeText(name, text); }
  listNames(name: string): Promise<string[]> { return this.files.listNames(name); }
  async replace(source: string, destination: string): Promise<void> {
    if (!this.triggered && destination === 'task-store.json' && --this.remaining === 0) {
      this.triggered = true;
      if (!this.loseAcknowledgement) {
        // Execute the real platform API against a nonexistent source; never delete the main file.
        await this.files.replace('t19-missing-source.json', destination);
        throw new StorageFailure('CHECK_FAILED', '缺失路径未触发预期文件错误。');
      }
      await this.files.replace(source, destination);
      throw new StorageFailure('STORAGE_FAILED', '合成故障：替换已成功，但调用方未收到成功应答。');
    }
    await this.files.replace(source, destination);
  }
}

function syntheticInput(): NoticeImportInput {
  const input: NoticeImportInput = new NoticeImportInput();
  input.draft.notice.rawText = RAW;
  input.draft.notice.sourceLabel = 'T19 合成恢复验证';
  input.draft.task.title = TITLE;
  input.draft.task.deadlinePrecision = 'date_only';
  input.draft.task.deadlineDate = '2028-02-29';
  input.draft.checklistItems = [{ label: 'PDF报告', state: 'pending' }, { label: '合成人工附件', state: 'pending' }];
  input.materialFromNotice = [true, false];
  return input;
}

function controller(store: LocalStore): NoticeSaveController {
  return new NoticeSaveController(new NoModelTransport(), new NoticeConfirmedWriter(store, new CommitServices(store)));
}
function proposal(snapshot: BusinessSnapshot, report: NoticeRecoveryReport): CommitProposal {
  check(snapshot.proposals.length === 1, '合成目录出现额外方案。');
  const p: CommitProposal = snapshot.proposals[0] as CommitProposal;
  check(p.id === report.proposalId && p.sessionId === NOTICE_IMPORT_SESSION && p.changes.length === 1 &&
    p.changes[0].taskId === report.reservedTaskId && p.changes[0].draft.title === TITLE &&
    p.notices.length === 1 && p.notices[0].rawText === RAW && p.checklistItems !== undefined &&
    JSON.stringify(p.checklistItems.map((item: ChecklistItem) => item.id)) === JSON.stringify(report.materialIds),
    '合成方案或预留标识不匹配，拒绝处理。');
  return p;
}
function assertSnapshot(snapshot: BusinessSnapshot, report: NoticeRecoveryReport): void {
  const p: CommitProposal = proposal(snapshot, report);
  const applied: boolean = report.phase === 'applied';
  const independent: number = report.independentTaskId.length > 0 ? 1 : 0;
  check(p.state === (report.phase === 'conflict' ? 'pending' : report.phase) && snapshot.revision === report.revision &&
    snapshot.tasks.length === independent + (applied ? 1 : 0) && snapshot.notices.length === (applied ? 1 : 0) &&
    snapshot.checklistItems.length === (applied ? 2 : 0) && snapshot.operations.length === (applied ? 1 : 0),
    '合成快照的状态、版本或实体数量不一致。');
  if (independent > 0) check(snapshot.tasks.some(task => task.id === report.independentTaskId && task.title === 'T19 独立合成任务'),
    '独立合成任务丢失或被改写。');
  if (applied) {
    const receipt: CommitReceipt = snapshot.operations[0] as CommitReceipt;
    check(receipt.proposalId === p.id && receipt.operationId === p.operationId &&
      receipt.tasks.length === 1 && receipt.tasks[0].id === report.reservedTaskId &&
      JSON.stringify(receipt.notices) === JSON.stringify(snapshot.notices) &&
      JSON.stringify(receipt.checklistItems) === JSON.stringify(snapshot.checklistItems) &&
      snapshot.checklistItems.every(item => item.taskId === report.reservedTaskId && item.state === 'pending' && item.confirmedAt === null) &&
      snapshot.checklistItems[0].sourceNoticeId === snapshot.notices[0].id && snapshot.checklistItems[1].sourceNoticeId === null &&
      snapshot.tasks.find(task => task.id === report.reservedTaskId)?.deadlineDate === '2028-02-29' &&
      snapshot.tasks.find(task => task.id === report.reservedTaskId)?.dueAt === null,
      '正式结果与方案/回执/来源/仅日期精度不一致。');
    if (report.scenario === 'same-instance-retry') check(receipt.operationId === report.retriedOperationId,
      '重试没有复用失败候选的原操作标识。');
  }
}
async function readReport(files: FilePort): Promise<NoticeRecoveryReport> {
  const report: NoticeRecoveryReport = JSON.parse(await files.readText(REPORT)) as NoticeRecoveryReport;
  check(report.recordType === 't19.notice-recovery.v1' && scenarioValid(report.scenario) &&
    ['pending', 'conflict', 'applied', 'cancelled'].includes(report.phase) && Array.isArray(report.materialIds) &&
    report.materialIds.length === 2, '不是受支持的合成恢复记录。');
  check(await files.readText('task-store.json') === report.primary, '目录已有额外变化，拒绝猜测恢复。');
  return report;
}
async function saveReport(files: FilePort, store: LocalStore, report: NoticeRecoveryReport): Promise<NoticeRecoveryReport> {
  const snapshot: BusinessSnapshot = value(await store.read());
  report.revision = snapshot.revision;
  assertSnapshot(snapshot, report);
  report.primary = await files.readText('task-store.json');
  await files.writeText(REPORT, JSON.stringify(report));
  return report;
}

/** Screen diagnostic only. Caller must allocate a new campus-ddl-t19-recovery-* namespace. */
export async function beginNoticeRecoveryProbe(files: FilePort, scenario: string): Promise<NoticeRecoveryReport> {
  check(scenarioValid(scenario), '未知合成场景。');
  await files.ensureDirectory('');
  check((await files.listNames('')).length === 0, '验证仅允许全新合成目录，不覆盖已有数据或恢复痕迹。');
  const port: FaultPort = new FaultPort(files, scenario);
  const store: LocalStore = new LocalStore(new StorageCoordinator(port));
  const writer: NoticeConfirmedWriter = new NoticeConfirmedWriter(store, new CommitServices(store));
  const input: NoticeImportInput = syntheticInput();
  const result = await writer.create(input, 0);
  check(port.triggered, '合成故障未触发。');
  check(scenario === 'apply-ack-loss' ? result.success : !result.success && result.errorCode === 'STORAGE_FAILED',
    '故障后的成功/失败反馈不符合实际落盘结果。');
  const snapshot: BusinessSnapshot = value(await store.read());
  check(snapshot.proposals.length === 1, '未留下唯一合成方案。');
  const pending: CommitProposal = snapshot.proposals[0] as CommitProposal;
  const report: NoticeRecoveryReport = new NoticeRecoveryReport();
  report.scenario = scenario; report.phase = scenario === 'apply-ack-loss' ? 'applied' : 'pending';
  report.proposalId = pending.id; report.reservedTaskId = pending.changes[0].taskId;
  report.materialIds = (pending.checklistItems as ChecklistItem[]).map(item => item.id);
  if (scenario === 'same-instance-retry') {
    const failed: BusinessSnapshot = JSON.parse(await files.readText('task-store.tmp.json')) as BusinessSnapshot;
    check(failed.operations.length === 1 && failed.proposals.length === 1, '缺少失败写入的合成候选回执。');
    report.retriedOperationId = (failed.operations[0] as CommitReceipt).operationId;
    value(await writer.create(input, 0));
    report.phase = 'applied';
    report.checks.push('同一确认实例失败后显式重试：复用失败候选operationId，没有新增方案/任务/材料');
  }
  if (scenario === 'conflict') {
    const draft: TaskDraft = new TaskDraft(); draft.title = 'T19 独立合成任务';
    report.independentTaskId = value(await new TaskRepository(store).create(draft, snapshot.revision)).task.id;
    report.phase = 'conflict';
  }
  report.checks.push(scenario === 'apply-ack-loss' ? '替换成功后的合成应答丢失：实际回执识别为已保存，没有重复提交' :
    '受控失败后未报正式保存成功，原方案和预留标识保持');
  report.checks.push(scenario === 'stage-ack-loss' ? '暂存应答丢失仍只有一个待确认方案' :
    (report.phase === 'applied' ? '正式任务1/来源1/材料2/回执1，同一快照' : '正式导入任务0/来源0/材料0/回执0'));
  return saveReport(files, store, report);
}

/** New controller and confirmation owner, also used after a real process restart. Never confirms. */
export async function inspectNoticeRecoveryProbe(files: FilePort): Promise<NoticeRecoveryReport> {
  const report: NoticeRecoveryReport = await readReport(files);
  const store: LocalStore = new LocalStore(new StorageCoordinator(files));
  assertSnapshot(value(await store.read()), report);
  const page: NoticeSaveController = controller(store);
  try {
    await page.restore();
    const waiting: boolean = report.phase === 'pending' || report.phase === 'conflict';
    check(page.saveSnapshot().locked === waiting && (page.snapshot().draft !== null) === waiting,
      '恢复未正确区分待确认与终态。');
    if (waiting) check(page.snapshot().materials.length === 2 && page.snapshot().materialFromNotice[1] === false &&
      page.snapshot().rawText === RAW, '恢复丢失原文、材料或人工来源。');
    check((page.saveSnapshot().saved !== null) === (report.phase === 'applied'), '回读结果不匹配。');
    check(await files.readText('task-store.json') === report.primary, '恢复/回读自动写入了业务数据。');
    report.checks.push('新确认实例只读恢复；未自动授权或提交；原文/人工来源和预留ID保持');
    return report;
  } finally { page.dispose(); }
}

/** Explicit diagnostic confirmation button; no model or background caller. */
export async function confirmNoticeRecoveryProbe(files: FilePort): Promise<NoticeRecoveryReport> {
  const report: NoticeRecoveryReport = await readReport(files);
  check(report.phase === 'pending' || report.phase === 'conflict', '终态不可重新确认。');
  const store: LocalStore = new LocalStore(new StorageCoordinator(files));
  assertSnapshot(value(await store.read()), report);
  const page: NoticeSaveController = controller(store);
  try {
    await page.restore(); await page.confirm();
    if (report.phase === 'conflict') {
      check(page.snapshot().errorCode === 'VERSION_CONFLICT' && await files.readText('task-store.json') === report.primary,
        '过期方案未阻断或被静默重基。');
      report.checks.push('过期确认返回VERSION_CONFLICT，业务字节不变，没有自动重基');
    } else {
      check(page.snapshot().phase === 'saved', '明确重试未完成保存。');
      report.phase = 'applied';
      report.checks.push('屏幕明确确认后保存；预留任务/材料ID保持，来源/回执一致');
    }
    return await saveReport(files, store, report);
  } finally { page.dispose(); }
}

export async function cancelNoticeRecoveryProbe(files: FilePort): Promise<NoticeRecoveryReport> {
  const report: NoticeRecoveryReport = await readReport(files);
  check(report.phase === 'pending' || report.phase === 'conflict', '终态不可取消或改写。');
  const store: LocalStore = new LocalStore(new StorageCoordinator(files));
  assertSnapshot(value(await store.read()), report);
  const page: NoticeSaveController = controller(store);
  try {
    await page.restore(); await page.cancelPending();
    check(!page.saveSnapshot().locked && page.snapshot().draft === null, '取消没有完成，不能解除锁定。');
    report.phase = 'cancelled';
    report.checks.push('显式取消仅改变方案终态，导入任务/来源/材料未创建，独立合成任务保留');
    return await saveReport(files, store, report);
  } finally { page.dispose(); }
}
