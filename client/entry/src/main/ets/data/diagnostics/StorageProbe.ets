import { ArkFilePort } from '../../adapters/storage/ArkFilePort';
import fs from '@ohos.file.fs';
import { BusinessError } from '@ohos.base';
import { BusinessSnapshot, ChecklistItem, Message, Notice, Session, SessionDocument, Task } from '../../domain/StorageModels';
import { ClientStorage } from '../ClientStorage';
import { StorageCoordinator } from '../storage/StorageCoordinator';
import { JsonSnapshotFile } from '../storage/JsonSnapshotFile';
import { BusinessSnapshotCodec } from '../storage/SnapshotCodecs';
import { StorageFailure, StorageResult } from '../storage/StorageTypes';
import { checkSaveFailure, checkRecoveryFailure, FailureEvidence } from './FailureProbe';
import { writeMessageProbe, readMessageProbe, MessageProbeReport } from './MessageProbe';

interface MessageProbePointer { namespace: string; }

export class ProbeLine {
  label: string;
  passed: boolean;
  detail: string;

  constructor(label: string, passed: boolean, detail: string) {
    this.label = label;
    this.passed = passed;
    this.detail = detail;
  }
}

function example(): BusinessSnapshot {
  const value: BusinessSnapshot = new BusinessSnapshot();
  const notice: Notice = { id: 'notice-probe',
    rawText: '高等数学作业请于2026年11月8日当天提交，需准备作业PDF和解题过程截图，上传课程平台。',
    sourceLabel: 'T08 人工样例', publishedAt: '2026-11-02T10:00:00+08:00',
    importedAt: '2026-11-02T10:03:00+08:00', timezone: 'Asia/Shanghai',
    contentHash: '35e4ba0a9c77468a2b736657172d7f895021f7dbf148fda989ab7fe1c2964a6d' };
  const task: Task = { id: 'task-probe', title: '中文作业 🗓️', course: '高等数学', kind: 'assignment',
    deadlinePrecision: 'date_only', deadlineDate: '2026-11-08', dueAt: null, timezone: 'Asia/Shanghai',
    priority: null, status: 'todo', remainingMinutes: null, submissionChannel: '课程平台',
    noticeIds: ['notice-probe'], version: 1, createdAt: '2026-11-02T10:05:00+08:00',
    updatedAt: '2026-11-02T10:05:00+08:00' };
  const item: ChecklistItem = { id: 'check-probe', taskId: 'task-probe', label: '材料待准备',
    state: 'pending', sourceNoticeId: 'notice-probe', confirmedAt: null };
  value.notices.push(notice);
  value.tasks.push(task);
  value.checklistItems.push(item);
  return value;
}

function sessionExample(): SessionDocument {
  const session: Session = { id: 'session-probe', title: '中文历史 🗓️',
    createdAt: '2026-10-23T10:00:00+08:00', updatedAt: '2026-10-23T10:01:00+08:00', pendingProposalId: null };
  const document: SessionDocument = new SessionDocument(session);
  const message: Message = { id: 'message-probe', sessionId: session.id, role: 'user', type: 'text',
    text: '仅日期，不补时刻。', calls: [], results: [],
    toolName: null, toolResultSummary: null, status: 'completed', createdAt: session.createdAt };
  document.messages.push(message);
  return document;
}

function valueOrThrow<T>(result: StorageResult<T>): T {
  if (!result.success || result.data === null) {
    throw new StorageFailure(result.errorCode === null ? 'STORAGE_FAILED' : result.errorCode, result.message);
  }
  return result.data;
}

function check(condition: boolean, detail: string): void {
  if (!condition) {
    throw new StorageFailure('CHECK_FAILED', detail);
  }
}

/** Development checks only: all data is synthetic and outside the production namespace. */
export class StorageProbe {
  private filesDir: string;
  private restartStorage: ClientStorage;

  constructor(filesDir: string) {
    this.filesDir = filesDir;
    this.restartStorage = new ClientStorage(new StorageCoordinator(new ArkFilePort(filesDir, 'campus-ddl-t08-restart')));
  }

  async writeExample(): Promise<ProbeLine[]> {
    const lines: ProbeLine[] = [];
    try {
      const current: BusinessSnapshot = valueOrThrow(await this.restartStorage.local.read());
      const next: BusinessSnapshot = example();
      next.revision = current.revision;
      const saved: BusinessSnapshot = valueOrThrow(await this.restartStorage.local.save(next, current.revision));
      lines.push(new ProbeLine('业务样例写入', true, 'revision=' + saved.revision + '；中文、emoji、null、仅日期'));
      const sessions = await this.restartStorage.sessions.read('session-probe');
      if (!sessions.success && sessions.errorCode !== 'NOT_FOUND') {
        throw new StorageFailure(sessions.errorCode === null ? 'STORAGE_FAILED' : sessions.errorCode, sessions.message);
      }
      const document: SessionDocument = sessionExample();
      document.revision = sessions.data === null ? 0 : sessions.data.revision;
      const history = valueOrThrow(await this.restartStorage.sessions.save(document, document.revision));
      lines.push(new ProbeLine('会话样例写入', true, 'revision=' + history.revision + '；关闭应用后再读取'));
    } catch (error) {
      const failure: Error = error as Error;
      lines.push(new ProbeLine('写入中止', false, failure.message));
    }
    return lines;
  }

  async readExample(): Promise<ProbeLine[]> {
    const lines: ProbeLine[] = [];
    try {
      const saved: BusinessSnapshot = valueOrThrow(await this.restartStorage.local.read());
      check(saved.revision > 0 && saved.tasks.length === 1, '尚未写入重启样例。');
      const task: Task = saved.tasks[0];
      check(task.title === '中文作业 🗓️' && task.dueAt === null && task.remainingMinutes === null &&
        task.deadlineDate === '2026-11-08' && saved.checklistItems[0].confirmedAt === null, '业务样例内容不一致。');
      lines.push(new ProbeLine('业务样例读取', true, 'revision=' + saved.revision + '；' + task.title + '；null/仅日期保持'));
      const history: SessionDocument = valueOrThrow(await this.restartStorage.sessions.read('session-probe'));
      check(history.session.title === '中文历史 🗓️' && history.messages.length === 1 &&
        history.messages[0].toolName === null && history.messages[0].text === '仅日期，不补时刻。', '会话样例内容不一致。');
      lines.push(new ProbeLine('会话样例读取', true, 'revision=' + history.revision + '；' + history.session.title));
    } catch (error) {
      const failure: Error = error as Error;
      lines.push(new ProbeLine('读取中止', false, failure.message));
    }
    return lines;
  }

  async checkFiles(): Promise<ProbeLine[]> {
    const lines: ProbeLine[] = [];
    try {
      const files: ArkFilePort = new ArkFilePort(this.filesDir, 'campus-ddl-t08-check-' + Date.now());
      const coordinator: StorageCoordinator = new StorageCoordinator(files);
      const storage: ClientStorage = new ClientStorage(coordinator);
      const first = valueOrThrow(await storage.local.save(example(), 0));
      first.tasks[0].title = '替换后 🗓️';
      const second = valueOrThrow(await storage.local.save(first, 1));
      const actual = valueOrThrow(await storage.local.read());
      const backup = new BusinessSnapshotCodec().decode(await files.readText('task-store.backup.json'));
      check(second.revision === 2 && actual.tasks[0].title === '替换后 🗓️' && backup.revision === 1 &&
        backup.tasks[0].title === '中文作业 🗓️', '主文件替换或上一版本备份不一致。');
      lines.push(new ProbeLine('文件替换与备份', true, '主文件 revision=2；备份 revision=1'));

      const results = await Promise.all([storage.local.save(second, 2), storage.local.save(second, 2)]);
      check(results.filter((result: StorageResult<BusinessSnapshot>) => result.success).length === 1 &&
        results.filter((result: StorageResult<BusinessSnapshot>) => result.errorCode === 'VERSION_CONFLICT').length === 1,
        '并发提交未正确串行或未拒绝旧版本。');
      lines.push(new ProbeLine('串行队列与版本保护', true, '两次相同版本请求：一次成功，一次 VERSION_CONFLICT'));

      const damaged: string = '{ T08 人工损坏样例';
      await files.writeText('task-store.json', damaged);
      check((await storage.local.read()).errorCode === 'CORRUPT_DATA', '损坏文件未被识别。');
      const restored = valueOrThrow(await storage.local.recoverBackup());
      check(restored.revision === 2 && await files.readText('task-store.corrupt-0.json') === damaged,
        '备份恢复失败或损坏原文未保留。');
      lines.push(new ProbeLine('显式恢复与损坏保留', true, '恢复 revision=2；原损坏字节另存'));

      await files.replace('task-store.json', 'task-store.removed-for-check.json');
      check((await storage.local.read()).errorCode === 'RECOVERY_REQUIRED', '正式文件缺失被误当作新安装。');
      valueOrThrow(await storage.local.recoverBackup());
      lines.push(new ProbeLine('主文件缺失', true, '要求恢复，未静默创建空快照'));

      await files.writeText('orphan.tmp.json', JSON.stringify(example()));
      const orphan = new JsonSnapshotFile(coordinator, new BusinessSnapshotCodec(), 'orphan');
      check((await orphan.read()).errorCode === 'RECOVERY_REQUIRED', '临时文件被错误提升为正式数据。');
      lines.push(new ProbeLine('临时文件残留', true, '不自动提交、不覆盖'));

      const future = example();
      future.schemaVersion = 2;
      const futureText: string = JSON.stringify(future);
      await files.writeText('future.json', futureText);
      const futureFile = new JsonSnapshotFile(coordinator, new BusinessSnapshotCodec(), 'future');
      check((await futureFile.read()).errorCode === 'UNSUPPORTED_SCHEMA' &&
        await files.readText('future.json') === futureText, '未知结构版本未保留。');
      lines.push(new ProbeLine('未知结构版本', true, 'UNSUPPORTED_SCHEMA；保留原文件'));

      valueOrThrow(await storage.sessions.save(sessionExample(), 0));
      const reloaded = valueOrThrow(await storage.sessions.read('session-probe'));
      check(reloaded.messages[0].toolName === null && reloaded.session.title === '中文历史 🗓️', '会话读回不一致。');
      await files.writeText('sessions/damaged.json', '{bad');
      const index = valueOrThrow(await storage.sessions.list());
      check(index.sessions.length === 1 && index.issues.length === 1 && index.issues[0].errorCode === 'CORRUPT_DATA',
        '单个会话损坏未被隔离。');
      lines.push(new ProbeLine('会话存储与故障隔离', true, '正常会话仍可读；损坏会话单独报告'));
    } catch (error) {
      const failure: Error = error as Error;
      lines.push(new ProbeLine('检查中止', false, failure.message));
    }
    return lines;
  }

  async checkFailures(): Promise<ProbeLine[]> {
    const lines: ProbeLine[] = [];
    const runId: string = '' + Date.now();
    const operations: string[] = ['write', 'write', 'replace', 'replace'];
    const names: string[] = ['task-store.tmp.json', 'task-store.backup.tmp.json',
      'task-store.backup.json', 'task-store.json'];
    const labels: string[] = ['候选写入失败', '备份写入失败', '备份替换失败', '主文件替换失败'];
    try {
      for (let index: number = 0; index < operations.length; index++) {
        const namespace: string = 'campus-ddl-t08-fail-' + runId + '-' + index;
        const files: ArkFilePort = new ArkFilePort(this.filesDir, namespace);
        const evidence: FailureEvidence = await checkSaveFailure(files, example(), operations[index], names[index]);
        lines.push(new ProbeLine(labels[index], true, 'STORAGE_FAILED；旧主文件/有效备份保留；重试 revision=' +
          evidence.retryRevision + '；' + namespace));
      }
      const namespace: string = 'campus-ddl-t08-fail-' + runId + '-4';
      const evidence: FailureEvidence = await checkRecoveryFailure(new ArkFilePort(this.filesDir, namespace), example());
      lines.push(new ProbeLine('恢复替换失败', true, '原文/备份/归档保留；重试 revision=' + evidence.retryRevision + '；' + namespace));
    } catch (error) {
      const failure: Error = error as Error;
      lines.push(new ProbeLine('失败保护检查中止', false, failure.message));
    }
    console.info('[T08-FAILURE-PROBE] ' + JSON.stringify(lines));
    return lines;
  }

  async writeMessages(): Promise<ProbeLine[]> {
    try {
      const namespace: string = 'campus-ddl-t08-messages-' + Date.now();
      const files: ArkFilePort = new ArkFilePort(this.filesDir, namespace);
      let missingCode: number = 0;
      try { await fs.stat(this.filesDir + '/' + namespace + '/missing-probe.json'); }
      catch (error) { missingCode = (error as BusinessError).code; }
      check(missingCode === 13900002, '实际缺失文件错误码与适配约定不一致。');
      const report: MessageProbeReport = await writeMessageProbe(files);
      report.nativeMissingCode = missingCode;
      await files.writeText('message-regression.json', JSON.stringify(report));
      const index: ArkFilePort = new ArkFilePort(this.filesDir, 'campus-ddl-t08-message-index');
      await index.ensureDirectory('');
      const pointer: MessageProbePointer = { namespace: namespace };
      await index.writeText('latest.json', JSON.stringify(pointer));
      console.info('[T08-MESSAGES-WRITE] ' + JSON.stringify(report));
      return [new ProbeLine('新版会话写入与兼容', true,
        'v1只读rev7；升级失败保留；重试rev8；多工具会话rev1；非法业务JSON拒绝；ENOENT=' + missingCode),
        new ProbeLine('新版会话验证目录', true, namespace + '；结束进程后点击6读取')];
    } catch (error) {
      return [new ProbeLine('新版会话验证中止', false, (error as Error).message)];
    }
  }

  async readMessages(): Promise<ProbeLine[]> {
    try {
      const index: ArkFilePort = new ArkFilePort(this.filesDir, 'campus-ddl-t08-message-index');
      const pointer: MessageProbePointer = JSON.parse(await index.readText('latest.json')) as MessageProbePointer;
      check(/^campus-ddl-t08-messages-\d+$/.test(pointer.namespace), '人工会话验证目录无效。');
      const files: ArkFilePort = new ArkFilePort(this.filesDir, pointer.namespace);
      const report: MessageProbeReport = await readMessageProbe(files);
      await files.writeText('cold-read.json', JSON.stringify(report));
      console.info('[T08-MESSAGES-READ] ' + JSON.stringify(report));
      return [new ProbeLine('新版会话读取', true,
        '旧会话v2/rev8、原v1备份；7条消息/2个调用/成功与失败结果；中文/emoji/null/0/false保持'),
        new ProbeLine('业务JSON读取', true, '非法输入未写入；合法保留集合完整；' + pointer.namespace)];
    } catch (error) {
      return [new ProbeLine('新版会话读取中止', false, (error as Error).message)];
    }
  }
}
