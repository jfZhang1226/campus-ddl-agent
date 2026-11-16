// T17 真实工具执行器：把白名单动作分发给真实仓库，并统一错误映射（B 的工具分发落地）。
//
// 注入端口由 T14/T16 仓库或受信适配层提供（结构满足即可）：
// - TaskReadPort = TaskRepository（list/get）
// - NoticeReadPort = 只读读取正式快照的 notices+revision（LocalStore.read() 的适配，只读不写）
// - ProposalStagePort = ProposalRepository.stage（保存草案，不改正式任务）
// apply/confirm/cancel 不在此；get_availability 在 T24 前返回 NOT_IMPLEMENTED。

import { ToolCall, ToolResult, TOOL_ERRORS, normalizeResult, validateCall } from './AgentTools';
import { StorageFailure, StorageResult } from '../data/storage/StorageTypes';

export interface TaskReadPort {
  list(query: Object): Promise<StorageResult<Object>>;   // data: {tasks, revision}
  get(taskId: string): Promise<StorageResult<Object>>;   // data: TaskDetail
}

export interface NoticeReadPort {
  read(): Promise<StorageResult<Object>>;                // data: {notices, revision}
}

export interface ProposalStagePort {
  stage(input: Object): Promise<StorageResult<Object>>;  // data: CommitProposal
}

function record(value: Object): Record<string, Object | null> {
  return value as Record<string, Object | null>;
}

export class AgentExecutor {
  constructor(private tasks: TaskReadPort, private notices: NoticeReadPort,
    private proposals: ProposalStagePort) {}

  async execute(call: ToolCall): Promise<ToolResult> {
    // 入口先校验：非法请求不访问任何读写端口（独立可注入执行器必须满足自身错误契约）。
    const invalid: string = validateCall(call);
    if (invalid.length > 0) return normalizeResult(typeof call.id === 'string' ? call.id : '',
      typeof call.action === 'string' ? call.action : '', call.params === null || call.params === undefined ? {} : call.params,
      false, null, invalid, '非法工具调用');
    try {
      if (call.action === 'get_tasks') return this.ok(call, await this.tasks.list(this.taskQuery(call.params)));
      if (call.action === 'get_task_detail') return this.ok(call, await this.tasks.get(record(call.params).taskId as string));
      if (call.action === 'get_notice') return await this.getNotice(call);
      if (call.action === 'get_availability') return this.fail(call, TOOL_ERRORS.NOT_IMPLEMENTED, 'T24 排程尚未实现');
      if (call.action === 'propose_task_changes') return this.ok(call, await this.proposals.stage(call.params));
      return this.fail(call, TOOL_ERRORS.INVALID_ARGUMENT, '不支持的动作');
    } catch (error) {
      return this.caught(call, error as Object);
    }
  }

  private ok(call: ToolCall, result: StorageResult<Object>): ToolResult {
    if (result.success && result.data !== null) {
      return normalizeResult(call.id, call.action, call.params, true, result.data, null, '');
    }
    return this.fail(call, result.errorCode === null ? TOOL_ERRORS.STORAGE_FAILED : result.errorCode, result.message);
  }

  private fail(call: ToolCall, code: string, message: string): ToolResult {
    return normalizeResult(call.id, call.action, call.params, false, null, code, message);
  }

  private caught(call: ToolCall, error: Object): ToolResult {
    if (error instanceof StorageFailure) return this.fail(call, error.code, error.message);
    return this.fail(call, TOOL_ERRORS.STORAGE_FAILED, '工具执行失败');
  }

  private async getNotice(call: ToolCall): Promise<ToolResult> {
    const noticeId: string = record(call.params).noticeId as string;
    const result: StorageResult<Object> = await this.notices.read();
    if (!result.success || result.data === null) return this.fail(call,
      result.errorCode === null ? TOOL_ERRORS.STORAGE_FAILED : result.errorCode, result.message);
    const data: Record<string, Object | null> = record(result.data);
    const notices: Object[] = data.notices as Object[];
    const revision: number = data.revision as number;
    const notice: Object | undefined = notices.find((entry: Object) => record(entry).id === noticeId);
    if (notice === undefined) return this.fail(call, TOOL_ERRORS.NOT_FOUND, '通知不存在');
    return normalizeResult(call.id, call.action, call.params, true, { notice: notice, revision: revision }, null, '');
  }

  private taskQuery(params: Object): Object {
    const p: Record<string, Object | null> = record(params);
    return {
      keyword: p.keyword === undefined ? null : p.keyword,
      course: p.course === undefined ? null : p.course,
      statuses: p.statuses === undefined ? [] : p.statuses,
      dateFrom: p.dateFrom === undefined ? null : p.dateFrom,
      dateTo: p.dateTo === undefined ? null : p.dateTo,
      timezone: p.timezone === undefined ? 'Asia/Shanghai' : p.timezone,
      includeUndated: p.includeUndated === undefined ? false : p.includeUndated
    };
  }
}
