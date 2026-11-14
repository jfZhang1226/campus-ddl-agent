import { FilePort } from '../../adapters/storage/FilePort';
import { CommitProposal, CommitReceipt, ConfirmedCommitRequest, ProposalDraft, TaskChangeDraft } from '../../domain/CommitModels';
import { BusinessSnapshot, ChecklistItem } from '../../domain/StorageModels';
import { TaskDraft } from '../../domain/TaskContracts';
import { CommitServices } from '../CommitServices';
import { LocalStore } from '../LocalStore';
import { TaskRepository } from '../TaskRepository';
import { StorageCoordinator } from '../storage/StorageCoordinator';
import { StorageFailure, StorageResult } from '../storage/StorageTypes';
import { MissingPathPort } from './FailureProbe';

export class CommitProbeReport {
  proposalId: string = '';
  expectedRevision: number = 0;
  phase: string = 'pending';
  revision: number = 0;
  receipt: CommitReceipt | null = null;
  primary: string = '';
  checks: string[] = [];
}
function check(condition: boolean, message: string): void {
  if (!condition) throw new StorageFailure('CHECK_FAILED', message);
}
function result<T>(response: StorageResult<T>): T {
  if (!response.success || response.data === null) throw new StorageFailure(response.errorCode === null ? 'CHECK_FAILED' : response.errorCode, response.message);
  return response.data;
}

/** Caller supplies a fresh artificial namespace; never the production FilePort. */
export async function stageCommitProbe(files: FilePort): Promise<CommitProbeReport> {
  const store: LocalStore = new LocalStore(new StorageCoordinator(files));
  const commits: CommitServices = new CommitServices(store);
  check(result(await store.read()).revision === 0, '验证目录必须为空。');
  const draft: ProposalDraft = new ProposalDraft(); draft.sessionId = 't16-artificial-session';
  draft.notices.push({ id: 't16-artificial-notice', rawText: 'T16 artificial source: report and attachment',
    sourceLabel: 'T16 人工来源', publishedAt: null, importedAt: '2026-11-12T00:00:00Z', timezone: 'Asia/Shanghai',
    contentHash: '7eaad3e949d271952c459cf1a454ad2e4bbe8eea67d3bfb9820ba73fd7b9e66f' });
  const change: TaskChangeDraft = new TaskChangeDraft(); change.draft.title = 'T16 人工确认任务 🗓️';
  change.draft.noticeIds = ['t16-artificial-notice'];
  change.checklistCreates = [{ label: '人工报告 PDF', sourceNoticeId: 't16-artificial-notice' },
    { label: '人工补充附件', sourceNoticeId: null }];
  change.draft.deadlinePrecision = 'date_only'; change.draft.deadlineDate = '2028-02-29'; draft.changes.push(change);
  const proposal: CommitProposal = result(await commits.proposals.stage(draft));
  const snapshot: BusinessSnapshot = result(await store.read());
  check(snapshot.revision === 1 && snapshot.tasks.length === 0 && snapshot.notices.length === 0 &&
    snapshot.checklistItems.length === 0 && snapshot.operations.length === 0 && (proposal.checklistItems as ChecklistItem[]).length === 2,
    '草案提前改变正式任务、来源或材料。');
  const report: CommitProbeReport = new CommitProbeReport();
  report.proposalId = proposal.id; report.expectedRevision = proposal.expectedRevision; report.revision = snapshot.revision;
  report.primary = await files.readText('task-store.json'); report.checks.push('待确认方案已保存；正式任务0、来源0、材料0、操作0；预留材料2');
  await files.writeText('commit-probe.json', JSON.stringify(report)); return report;
}

/** Only called by the explicit screen confirmation button. */
export async function confirmCommitProbe(files: FilePort): Promise<CommitProbeReport> {
  const report: CommitProbeReport = JSON.parse(await files.readText('commit-probe.json')) as CommitProbeReport;
  check(report.phase === 'pending', '请先建立新的人工待确认方案。');
  const port: MissingPathPort = new MissingPathPort(files);
  const store: LocalStore = new LocalStore(new StorageCoordinator(port));
  const commits: CommitServices = new CommitServices(store);
  const request: ConfirmedCommitRequest = result(await commits.confirmation.confirm(report.proposalId, report.expectedRevision));
  check(await files.readText('task-store.json') === report.primary, '确认授权提前写入正式状态。');
  port.arm('replace', 'task-store.json');
  const failed: StorageResult<CommitReceipt> = await commits.confirmation.apply(request);
  check(port.triggered && failed.errorCode === 'STORAGE_FAILED' && failed.data === null &&
    await files.readText('task-store.json') === report.primary, '真实缺失源替换失败未保留正式主文件。');
  report.checks.push('真实文件API替换失败：主文件不变、未报成功');
  const receipt: CommitReceipt = result(await commits.confirmation.apply(request));
  check(receipt.operationId === request.operationId && receipt.committedRevision === 2, '原操作明确重试回执不一致。');
  const before: string = await files.readText('task-store.json');
  check(JSON.stringify(result(await commits.confirmation.apply(request))) === JSON.stringify(receipt) &&
    await files.readText('task-store.json') === before, '重复操作产生额外写入。');
  const snapshot: BusinessSnapshot = result(await store.read());
  check(snapshot.tasks.length === 1 && snapshot.operations.length === 1 && snapshot.proposals.length === 1 &&
    snapshot.notices.length === 1 && snapshot.checklistItems.length === 2 &&
    JSON.stringify(snapshot.checklistItems) === JSON.stringify(receipt.checklistItems) &&
    JSON.stringify(snapshot.notices) === JSON.stringify(receipt.notices) &&
    snapshot.checklistItems.every((item: ChecklistItem) => item.taskId === snapshot.tasks[0].id && item.state === 'pending' && item.confirmedAt === null) &&
    (snapshot.proposals[0] as CommitProposal).state === 'applied', '任务、来源、材料、方案与回执未一致提交。');
  report.checks.push('同一快照：任务1、来源1、材料2；材料pending且绑定正确');
  report.checks.push('同一操作重试/重复：一次正式提交，committedRevision=2');
  const unrelated: TaskDraft = new TaskDraft(); unrelated.title = 'T16 之后的人工任务';
  result(await new TaskRepository(store).create(unrelated, 2));
  report.receipt = receipt; report.phase = 'applied'; report.revision = 3; report.primary = await files.readText('task-store.json');
  report.checks.push('后续独立写入revision=3；原回执仍绑定revision=2');
  await files.writeText('commit-probe.json', JSON.stringify(report)); return report;
}

export async function cancelCommitProbe(files: FilePort): Promise<CommitProbeReport> {
  const report: CommitProbeReport = JSON.parse(await files.readText('commit-probe.json')) as CommitProbeReport;
  const store: LocalStore = new LocalStore(new StorageCoordinator(files)); const commits: CommitServices = new CommitServices(store);
  const snapshot: BusinessSnapshot = result(await store.read());
  const cancelled: CommitProposal = result(await commits.confirmation.cancel(report.proposalId, snapshot.revision));
  const after: BusinessSnapshot = result(await store.read());
  check(cancelled.state === 'cancelled' && after.tasks.length === 0 && after.notices.length === 0 && after.checklistItems.length === 0,
    '取消改变正式任务、来源或材料。');
  report.phase = 'cancelled'; report.revision = result(await store.read()).revision;
  report.primary = await files.readText('task-store.json'); report.checks.push('明确取消，正式任务0、来源0、材料0、操作0');
  await files.writeText('commit-probe.json', JSON.stringify(report)); return report;
}

/** Restart/offline read and replay of an already committed receipt; never issues new confirmation. */
export async function readCommitProbe(files: FilePort): Promise<CommitProbeReport> {
  const report: CommitProbeReport = JSON.parse(await files.readText('commit-probe.json')) as CommitProbeReport;
  const before: string = await files.readText('task-store.json'); check(before === report.primary, '人工快照与上次记录不一致。');
  const store: LocalStore = new LocalStore(new StorageCoordinator(files)); const commits: CommitServices = new CommitServices(store);
  const proposal: CommitProposal = result(await commits.proposals.get(report.proposalId));
  const snapshot: BusinessSnapshot = result(await store.read()); check(snapshot.revision === report.revision, '读取版本不一致。');
  if (report.phase === 'applied') {
    check(report.receipt !== null, '缺少人工回执。');
    const receipt: CommitReceipt = report.receipt as CommitReceipt;
    const replay: CommitReceipt = result(await commits.confirmation.apply(new ConfirmedCommitRequest(proposal.id,
      receipt.operationId, proposal.expectedRevision)));
    check(JSON.stringify(replay) === JSON.stringify(receipt) && snapshot.tasks.length === 2 && snapshot.operations.length === 1 &&
      snapshot.notices.length === 1 && snapshot.checklistItems.length === 2 &&
      JSON.stringify(snapshot.checklistItems) === JSON.stringify(receipt.checklistItems),
      '重启后重复创建或回执改变。');
    report.checks.push('新实例读取并重试旧操作：回执相同，当前revision=3，未写入');
  } else {
    check(snapshot.tasks.length === 0 && snapshot.notices.length === 0 && snapshot.checklistItems.length === 0 &&
      snapshot.operations.length === 0 && proposal.state === report.phase,
      '未确认或已取消方案被自动执行。');
    report.checks.push('新实例只读待确认/取消方案；未自动提交');
  }
  check(await files.readText('task-store.json') === before, '只读或回执重试改变主文件。'); return report;
}
