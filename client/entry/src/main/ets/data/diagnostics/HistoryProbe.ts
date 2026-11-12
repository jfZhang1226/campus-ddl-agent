import { FilePort } from '../../adapters/storage/FilePort';
import { SessionDocument } from '../../domain/StorageModels';
import { SessionRepository, SessionRuntime } from '../SessionRepository';
import { SessionStore } from '../SessionStore';
import { StorageCoordinator } from '../storage/StorageCoordinator';
import { StorageFailure, StorageResult } from '../storage/StorageTypes';
import { ChatController } from '../../chat/ChatController';
import { StoredChatHistory } from '../../chat/StoredChatHistory';
import { ChatClock, GatewayCall, GatewayConfig, GatewayResponse, GatewayTransport } from '../../chat/ChatModels';

export class HistoryProbeLine {
  constructor(public label: string, public passed: boolean, public detail: string) {}
}
export class HistoryProbeReport {
  completed: SessionDocument | null = null;
  interrupted: SessionDocument | null = null;
  mockRequests: number = 0;
  checks: HistoryProbeLine[] = [];
}
class ProbeRuntime implements SessionRuntime {
  private base: number = Date.now();
  private tick: number = 0;
  private id: number = 0;
  now(): string { return new Date(this.base + this.tick++).toISOString(); }
  nextId(): string { return 'history-probe-' + this.base.toString(36) + '-' + (++this.id); }
}
class ProbeClock implements ChatClock {
  // Deliberately leaves one recorded request pending for the later cold-read check.
  schedule(callback: () => void, milliseconds: number): number { return 1; }
  cancel(id: number): void {}
}
class FailurePort implements FilePort {
  target: string = '';
  missing: string = '';
  armed: boolean = false;
  constructor(private actual: FilePort) {}
  ensureDirectory(name: string): Promise<void> { return this.actual.ensureDirectory(name); }
  exists(name: string): Promise<boolean> { return this.actual.exists(name); }
  readText(name: string): Promise<string> { return this.actual.readText(name); }
  writeText(name: string, text: string): Promise<void> { return this.actual.writeText(name, text); }
  listNames(name: string): Promise<string[]> { return this.actual.listNames(name); }
  replace(source: string, destination: string): Promise<void> {
    if (this.armed && destination === this.target) {
      this.armed = false;
      return this.actual.replace(this.missing, destination); // Real file API failure, isolated synthetic directory only.
    }
    return this.actual.replace(source, destination);
  }
}
class ProbeGateway implements GatewayTransport {
  count: number = 0;
  hold: boolean = false;
  failResponseSave: boolean = false;
  constructor(private files: FailurePort) {}
  start(config: GatewayConfig, message: string): GatewayCall {
    ++this.count;
    if (this.failResponseSave) { this.files.armed = true; this.failResponseSave = false; }
    const result: Promise<GatewayResponse> = this.hold ? new Promise<GatewayResponse>(() => {}) :
      Promise.resolve(new GatewayResponse(200, this.count === 1 ?
        JSON.stringify({ type: 'clarification', question: '合成追问：请补充课程。' }) :
        JSON.stringify({ type: 'answer', text: '合成回复：已记录你的文字，未执行任务操作。' })));
    return { result: result, cancel: (): void => {} };
  }
}
function value<T>(result: StorageResult<T>): T {
  if (!result.success || result.data === null) throw new StorageFailure(result.errorCode === null ? 'STORAGE_FAILED' : result.errorCode, result.message);
  return result.data;
}
async function settled(controller: ChatController): Promise<void> {
  for (let i: number = 0; i < 1000; i++) {
    if (!controller.snapshot().busy) return;
    await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
  }
  throw new StorageFailure('STORAGE_FAILED', '人工历史检查未在等待期限内完成。');
}

/** Pure shared workflow. Caller supplies a port rooted in the isolated T11 diagnostic namespace. */
export async function writeHistoryProbe(port: FilePort): Promise<HistoryProbeReport> {
  const files: FailurePort = new FailurePort(port);
  const repo: SessionRepository = new SessionRepository(new SessionStore(new StorageCoordinator(files)), new ProbeRuntime());
  const gateway: ProbeGateway = new ProbeGateway(files);
  const controller: ChatController = new ChatController(gateway, new ProbeClock(), new StoredChatHistory(repo));
  if (!await controller.initializeHistory()) throw new StorageFailure('RECOVERY_REQUIRED', '人工目录存在不可读会话，请先保留文件排查。');
  controller.newConversation(true);
  controller.configure(new GatewayConfig('https://example.test', 'synthetic-not-a-real-token'));
  controller.setDraft('人工历史 中文 😀：周五交报告');
  controller.send(); await settled(controller);
  const id: string = controller.snapshot().sessionId;
  files.target = 'sessions/' + id + '.json';
  files.missing = 'sessions/' + id + '-missing.json';
  if (await port.exists(files.missing)) throw new StorageFailure('INVALID_ARGUMENT', '人工失败路径已存在，未执行替换检查。');
  gateway.failResponseSave = true;
  controller.setDraft('补充课程：数据库'); controller.send(); await settled(controller);
  const beforeRetry: SessionDocument = value(await repo.get(id));
  const failed: boolean = controller.snapshot().savePending && controller.snapshot().draft === '补充课程：数据库' &&
    beforeRetry.messages.length === 3 && controller.snapshot().messages.length === 4;
  const callsBefore: number = gateway.count;
  const retried: boolean = await controller.retryHistorySave();
  const report: HistoryProbeReport = new HistoryProbeReport();
  report.completed = value(await repo.get(id));
  report.checks.push(new HistoryProbeLine('真实文件替换失败保留旧记录、回复和输入', failed, '受控缺失源路径；没有模拟硬件故障。'));
  report.checks.push(new HistoryProbeLine('明确重试只保存对话，不重发请求', retried && gateway.count === callsBefore,
    '本轮全部请求为合成网关，不调用模型。'));
  report.checks.push(new HistoryProbeLine('回答与追问分别保存', report.completed.messages.length === 4 &&
    report.completed.messages[1].type === 'clarification' && report.completed.messages[3].type === 'answer', '四条中文/emoji消息，revision=' + report.completed.revision));
  controller.newConversation(); gateway.hold = true;
  controller.setDraft('人工中断样例：不得自动重发'); controller.send();
  for (let i: number = 0; i < 1000 && gateway.count === callsBefore; i++) {
    await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
  }
  if (gateway.count === callsBefore) throw new StorageFailure('STORAGE_FAILED', '未完成请求样例尚未保存。');
  report.interrupted = value(await repo.get(controller.snapshot().sessionId));
  report.mockRequests = gateway.count;
  report.checks.push(new HistoryProbeLine('保留待中断的独立会话', report.interrupted.messages.length === 1 &&
    report.interrupted.messages[0].status === 'pending', '供强制停止进程后独立读取；不调用dispose补写状态。'));
  await port.writeText('history-probe-report.json', JSON.stringify(report));
  return report;
}

export async function readHistoryProbe(port: FilePort): Promise<HistoryProbeReport> {
  const original: string = await port.readText('history-probe-report.json');
  const saved: HistoryProbeReport = JSON.parse(original) as HistoryProbeReport;
  if (saved.completed === null || saved.interrupted === null) throw new StorageFailure('CORRUPT_DATA', '人工验证报告不完整。');
  const repo: SessionRepository = new SessionRepository(new SessionStore(new StorageCoordinator(port)));
  const report: HistoryProbeReport = new HistoryProbeReport();
  report.completed = value(await repo.get(saved.completed.session.id));
  report.interrupted = value(await repo.get(saved.interrupted.session.id));
  report.checks.push(new HistoryProbeLine('重开读取完整会话', JSON.stringify(report.completed) === JSON.stringify(saved.completed),
    'revision、ID、时间、类型、文本及顺序保持。'));
  report.checks.push(new HistoryProbeLine('未完成请求仍是原始记录', JSON.stringify(report.interrupted) === JSON.stringify(saved.interrupted),
    '读取不改磁盘状态，不补造回复。'));
  const gateway: ProbeGateway = new ProbeGateway(new FailurePort(port));
  const cold: ChatController = new ChatController(gateway, new ProbeClock(), new StoredChatHistory(repo));
  const loaded: boolean = await cold.initializeHistory();
  report.checks.push(new HistoryProbeLine('恢复界面标中断且没有自动请求', loaded && gateway.count === 0 &&
    cold.snapshot().sessionId === saved.interrupted.session.id && cold.snapshot().messages[0].phase === 'interrupted' &&
    cold.configuration().token.length === 0, '历史可离线读取；网关设置未落盘。'));
  report.checks.push(new HistoryProbeLine('读取不改报告文件', await port.readText('history-probe-report.json') === original,
    '强制停止/无默认网络仍须分别在两端手机验证。'));
  return report;
}
