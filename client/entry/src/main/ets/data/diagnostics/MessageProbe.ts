import { FilePort } from '../../adapters/storage/FilePort';
import { BusinessSnapshot, SessionDocument } from '../../domain/StorageModels';
import { LocalStore } from '../LocalStore';
import { SessionStore } from '../SessionStore';
import { StorageCoordinator } from '../storage/StorageCoordinator';
import { StorageFailure, StorageResult } from '../storage/StorageTypes';
import { MissingPathPort } from './FailureProbe';
import { LEGACY_SESSION_JSON, STRUCTURED_SESSION_JSON } from './SessionProbeSamples';

export class MessageProbeReport {
  synthetic: boolean = true;
  checkedAt: string = new Date().toISOString();
  missingExists: boolean = true;
  nativeMissingCode: number | null = null;
  legacyBefore: string = '';
  legacyAfterRead: string = '';
  legacyAfterFailedSave: string = '';
  backupAfterFailedSave: string = '';
  candidateAfterFailedSave: string = '';
  failureCode: string | null = null;
  invalidBusinessCode: string | null = null;
  legacyReadSchema: number = 0;
  legacyReadRevision: number = 0;
  legacySavedRevision: number = 0;
  structuredRevision: number = 0;
  coldReadVerified: boolean = false;
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new StorageFailure('CHECK_FAILED', message);
}

function value<T>(result: StorageResult<T>): T {
  if (!result.success || result.data === null) {
    throw new StorageFailure(result.errorCode === null ? 'CHECK_FAILED' : result.errorCode, result.message);
  }
  return result.data;
}

/** Supply an isolated, empty artificial-data namespace. Never overwrite partial traces. */
export async function writeMessageProbe(files: FilePort): Promise<MessageProbeReport> {
  await files.ensureDirectory('');
  expect((await files.listNames('')).length === 0, '会话验证目录已有数据，请先读取结果，保留既有痕迹。');
  const report: MessageProbeReport = new MessageProbeReport();
  report.missingExists = await files.exists('missing-probe.json');
  expect(!report.missingExists, '缺失文件被错误报告为存在。');
  await files.ensureDirectory('sessions');
  await files.writeText('sessions/session-legacy.json', LEGACY_SESSION_JSON);
  const fault: MissingPathPort = new MissingPathPort(files);
  const coordinator: StorageCoordinator = new StorageCoordinator(fault);
  const sessions: SessionStore = new SessionStore(coordinator);
  report.legacyBefore = await files.readText('sessions/session-legacy.json');
  const legacy: SessionDocument = value(await sessions.read('session-legacy'));
  report.legacyReadSchema = legacy.schemaVersion;
  report.legacyReadRevision = legacy.revision;
  report.legacyAfterRead = await files.readText('sessions/session-legacy.json');
  expect(legacy.schemaVersion === 2 && legacy.revision === 7 && report.legacyAfterRead === report.legacyBefore &&
    legacy.messages[2].type === 'legacy_tool' && legacy.messages[2].results.length === 0,
    '旧会话只读兼容改变了原文件、版本或伪造了结果。');
  fault.arm('replace', 'sessions/session-legacy.json');
  const failed: StorageResult<SessionDocument> = await sessions.save(legacy, 7);
  report.failureCode = failed.errorCode;
  report.legacyAfterFailedSave = await files.readText('sessions/session-legacy.json');
  report.backupAfterFailedSave = await files.readText('sessions/session-legacy.backup.json');
  report.candidateAfterFailedSave = await files.readText('sessions/session-legacy.tmp.json');
  expect(fault.triggered && !failed.success && failed.data === null && failed.errorCode === 'STORAGE_FAILED' &&
    report.legacyAfterFailedSave === report.legacyBefore && report.backupAfterFailedSave === report.legacyBefore,
    '升级失败未保留旧主文件及原始备份。');
  const upgraded: SessionDocument = value(await sessions.save(legacy, 7));
  report.legacySavedRevision = upgraded.revision;
  expect(upgraded.schemaVersion === 2 && upgraded.revision === 8 &&
    await files.readText('sessions/session-legacy.backup.json') === LEGACY_SESSION_JSON,
    '旧会话重试升级或原始备份不一致。');
  const sample: SessionDocument = JSON.parse(STRUCTURED_SESSION_JSON) as SessionDocument;
  report.structuredRevision = value(await sessions.save(sample, 0)).revision;
  const invalid: BusinessSnapshot = new BusinessSnapshot();
  invalid.operations.push({ syntheticValue: Number.NaN });
  const local: LocalStore = new LocalStore(coordinator);
  const rejected: StorageResult<BusinessSnapshot> = await local.save(invalid, 0);
  report.invalidBusinessCode = rejected.errorCode;
  expect(!rejected.success && rejected.errorCode === 'INVALID_ARGUMENT' && !await files.exists('task-store.json'),
    '业务 JSON 非有限值未在写文件前拒绝。');
  const valid: BusinessSnapshot = new BusinessSnapshot();
  valid.operations.push({ syntheticValue: 0, values: [null, false, '中文 🗓️'] });
  value(await local.save(valid, 0));
  await files.writeText('message-regression.json', JSON.stringify(report));
  await readMessageProbe(files);
  return report;
}

/** Uses new owners after process restart; only reads persisted synthetic records. */
export async function readMessageProbe(files: FilePort): Promise<MessageProbeReport> {
  const report: MessageProbeReport = JSON.parse(await files.readText('message-regression.json')) as MessageProbeReport;
  const coordinator: StorageCoordinator = new StorageCoordinator(files);
  const sessions: SessionStore = new SessionStore(coordinator);
  const legacy: SessionDocument = value(await sessions.read('session-legacy'));
  expect(legacy.schemaVersion === 2 && legacy.revision === 8 && legacy.messages.length === 3 &&
    legacy.messages[2].toolResultSummary === '找到 2 条合成任务', '升级后的旧会话重启读取不一致。');
  expect(await files.readText('sessions/session-legacy.backup.json') === LEGACY_SESSION_JSON,
    '重启后旧版备份不一致。');
  const structured: SessionDocument = value(await sessions.read('session-structured'));
  const expected: SessionDocument = JSON.parse(STRUCTURED_SESSION_JSON) as SessionDocument;
  expected.revision = 1;
  expect(JSON.stringify(structured) === JSON.stringify(expected), '多工具/追问/空值/结构化结果未完整保持。');
  const business: BusinessSnapshot = value(await new LocalStore(coordinator).read());
  const expectedBusiness: BusinessSnapshot = new BusinessSnapshot();
  expectedBusiness.revision = 1;
  expectedBusiness.operations.push({ syntheticValue: 0, values: [null, false, '中文 🗓️'] });
  expect(JSON.stringify(business) === JSON.stringify(expectedBusiness), '有效业务 JSON 在重启后被改变。');
  expect(value(await sessions.list()).sessions.length === 2, '新版会话列表不一致。');
  report.coldReadVerified = true;
  return report;
}
