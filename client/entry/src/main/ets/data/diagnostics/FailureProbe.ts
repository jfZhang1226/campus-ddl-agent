import { FilePort } from '../../adapters/storage/FilePort';
import { BusinessSnapshot } from '../../domain/StorageModels';
import { LocalStore } from '../LocalStore';
import { StorageCoordinator } from '../storage/StorageCoordinator';
import { StorageFailure, StorageResult } from '../storage/StorageTypes';

/** Development-only fault injection: missing paths trigger the real platform API's error. */
export class MissingPathPort implements FilePort {
  private files: FilePort;
  private operation: string = '';
  private name: string = '';
  triggered: boolean = false;

  constructor(files: FilePort) { this.files = files; }

  arm(operation: string, name: string): void {
    this.operation = operation;
    this.name = name;
    this.triggered = false;
  }

  private matches(operation: string, name: string): boolean {
    if (this.operation !== operation || this.name !== name) { return false; }
    this.operation = '';
    this.triggered = true;
    return true;
  }

  ensureDirectory(name: string): Promise<void> { return this.files.ensureDirectory(name); }
  exists(name: string): Promise<boolean> { return this.files.exists(name); }
  readText(name: string): Promise<string> { return this.files.readText(name); }
  listNames(name: string): Promise<string[]> { return this.files.listNames(name); }

  writeText(name: string, text: string): Promise<void> {
    return this.files.writeText(this.matches('write', name) ? 'missing-parent/' + name : name, text);
  }

  replace(source: string, destination: string): Promise<void> {
    return this.files.replace(this.matches('replace', destination) ? 'missing-source.json' : source, destination);
  }
}

export class FailureEvidence {
  caseName: string = '';
  faultMode: string = 'controlled missing path through the real FilePort';
  nativeCallAttempted: boolean = false;
  errorCode: string | null = null;
  primaryBefore: string = '';
  primaryAfterFailure: string = '';
  backupBefore: string = '';
  backupAfterFailure: string = '';
  temporaryAfterFailure: string | null = null;
  archiveAfterFailure: string | null = null;
  retryRevision: number = 0;
  primaryAfterRetry: string = '';
  backupAfterRetry: string = '';
}

function requireProbe(condition: boolean, message: string): void {
  if (!condition) { throw new StorageFailure('CHECK_FAILED', message); }
}

function saved(result: StorageResult<BusinessSnapshot>): BusinessSnapshot {
  requireProbe(result.success && result.data !== null, '人工样例准备或重试失败。');
  return result.data as BusinessSnapshot;
}

/** Caller must supply a fresh, isolated artificial-data namespace for each case. */
export async function checkSaveFailure(files: FilePort, sample: BusinessSnapshot,
  operation: string, name: string): Promise<FailureEvidence> {
  const port: MissingPathPort = new MissingPathPort(files);
  const store: LocalStore = new LocalStore(new StorageCoordinator(port));
  const first: BusinessSnapshot = saved(await store.save(sample, 0));
  first.tasks[0].title = '失败前已提交 🗓️';
  const second: BusinessSnapshot = saved(await store.save(first, 1));
  const evidence: FailureEvidence = new FailureEvidence();
  evidence.caseName = operation + ':' + name;
  evidence.primaryBefore = await files.readText('task-store.json');
  evidence.backupBefore = await files.readText('task-store.backup.json');
  second.tasks[0].title = '失败候选：不能先报成功';
  port.arm(operation, name);
  const failure: StorageResult<BusinessSnapshot> = await store.save(second, 2);
  evidence.nativeCallAttempted = port.triggered;
  evidence.errorCode = failure.errorCode;
  evidence.primaryAfterFailure = await files.readText('task-store.json');
  evidence.backupAfterFailure = await files.readText('task-store.backup.json');
  if (await files.exists('task-store.tmp.json')) {
    evidence.temporaryAfterFailure = await files.readText('task-store.tmp.json');
  }
  requireProbe(port.triggered && !failure.success && failure.data === null &&
    failure.errorCode === 'STORAGE_FAILED', '未取得预期的真实文件 API 失败结果。');
  requireProbe(evidence.primaryAfterFailure === evidence.primaryBefore &&
    saved(await store.read()).revision === 2, '失败改变了已提交主文件。');
  // Before final rename, the backup has already been advanced to the current primary.
  const expectedBackup: string = operation === 'replace' && name === 'task-store.json' ?
    evidence.primaryBefore : evidence.backupBefore;
  requireProbe(evidence.backupAfterFailure === expectedBackup, '失败后的备份字节不符合提交阶段。');
  if (name !== 'task-store.tmp.json') {
    requireProbe(evidence.temporaryAfterFailure !== null, '候选恢复痕迹丢失。');
  }
  const retried: BusinessSnapshot = saved(await store.save(second, 2));
  evidence.retryRevision = retried.revision;
  evidence.primaryAfterRetry = await files.readText('task-store.json');
  evidence.backupAfterRetry = await files.readText('task-store.backup.json');
  requireProbe(retried.revision === 3 && retried.tasks[0].title === second.tasks[0].title &&
    evidence.backupAfterRetry === evidence.primaryBefore && !await files.exists('task-store.tmp.json'),
    '失败后用原版本重试未正确提交，或上一正式版本未保留。');
  await files.writeText('failure-evidence.json', JSON.stringify(evidence));
  return evidence;
}

export async function checkRecoveryFailure(files: FilePort, sample: BusinessSnapshot): Promise<FailureEvidence> {
  const port: MissingPathPort = new MissingPathPort(files);
  const store: LocalStore = new LocalStore(new StorageCoordinator(port));
  const first: BusinessSnapshot = saved(await store.save(sample, 0));
  saved(await store.save(first, 1));
  const evidence: FailureEvidence = new FailureEvidence();
  evidence.caseName = 'replace:recovery';
  evidence.primaryBefore = '{ T08 人工损坏原文 🗓️';
  evidence.backupBefore = await files.readText('task-store.backup.json');
  await files.writeText('task-store.json', evidence.primaryBefore);
  port.arm('replace', 'task-store.json');
  const failure: StorageResult<BusinessSnapshot> = await store.recoverBackup();
  evidence.nativeCallAttempted = port.triggered;
  evidence.errorCode = failure.errorCode;
  evidence.primaryAfterFailure = await files.readText('task-store.json');
  evidence.backupAfterFailure = await files.readText('task-store.backup.json');
  evidence.temporaryAfterFailure = await files.readText('task-store.recovery.tmp.json');
  evidence.archiveAfterFailure = await files.readText('task-store.corrupt-0.json');
  requireProbe(port.triggered && !failure.success && failure.data === null &&
    failure.errorCode === 'STORAGE_FAILED', '恢复未取得预期失败结果。');
  requireProbe(evidence.primaryAfterFailure === evidence.primaryBefore &&
    evidence.archiveAfterFailure === evidence.primaryBefore && evidence.backupAfterFailure === evidence.backupBefore &&
    evidence.temporaryAfterFailure === evidence.backupBefore, '恢复失败破坏了原文、备份或恢复痕迹。');
  const retried: BusinessSnapshot = saved(await store.recoverBackup());
  evidence.retryRevision = retried.revision;
  evidence.primaryAfterRetry = await files.readText('task-store.json');
  evidence.backupAfterRetry = await files.readText('task-store.backup.json');
  requireProbe(retried.revision === 1 && evidence.primaryAfterRetry === evidence.backupBefore &&
    evidence.backupAfterRetry === evidence.backupBefore &&
    await files.readText('task-store.corrupt-0.json') === evidence.primaryBefore &&
    await files.readText('task-store.corrupt-1.json') === evidence.primaryBefore,
    '恢复重试未成功，或覆盖了先前损坏归档。');
  await files.writeText('failure-evidence.json', JSON.stringify(evidence));
  return evidence;
}
