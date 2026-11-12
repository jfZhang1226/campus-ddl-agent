// T17 真实查询工具与方案执行串联：工具协议层（纯逻辑，无网络/存储依赖）。
//
// 定义模型可见的白名单工具 schema、结构化动作校验、执行结果归一化与错误契约。
// 边界：模型只能 propose/查询；apply/confirm 由客户端确认事件触发（T16 ClientConfirmation），
// 绝不出现在本白名单里，confirmed:true 不能伪造授权。

export const MAX_AGENT_STEPS: number = 8;

// 白名单动作：只读查询 + 保存草案。apply_confirmed_proposal 不在此列。
export const ALLOWED_ACTIONS: string[] = [
  'get_tasks', 'get_task_detail', 'get_notice', 'get_availability', 'propose_task_changes'
];

// 模型工具调用（网关 tool_calls 的规范化形态）。
export interface ToolCall {
  id: string;
  action: string;
  params: Object;
}

// 客户端执行后的结构化结果（对齐 session-message-contract 的 results 形态）。
export interface ToolResult {
  id: string;
  action: string;
  params: Object;
  success: boolean;
  data: Object | null;
  errorCode: string | null;
  message: string;
}

// 工具错误码契约：与 T02/T14/T16 对齐；AMBIGUOUS_TARGET 由 agent 层产出，NOT_IMPLEMENTED 用于 T24 前占位。
export const TOOL_ERRORS = {
  NOT_FOUND: 'NOT_FOUND',
  AMBIGUOUS_TARGET: 'AMBIGUOUS_TARGET',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  STORAGE_FAILED: 'STORAGE_FAILED',
  CAPACITY_EXCEEDED: 'CAPACITY_EXCEEDED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  PROPOSAL_CANCELLED: 'PROPOSAL_CANCELLED',
  ALREADY_APPLIED: 'ALREADY_APPLIED'
} as const;

function schema(name: string, description: string, properties: Object, required: string[]): Object {
  return { type: 'function', function: { name: name, description: description,
    parameters: { type: 'object', properties: properties, required: required } } };
}

// 发给模型的 tools 数组：仅白名单内的动作。
export const AGENT_TOOL_SCHEMAS: Object[] = [
  schema('get_tasks', '按课程/关键词/状态/日期范围查询真实任务列表，返回任务与当前 revision。',
    { keyword: { type: 'string' }, course: { type: 'string' },
      statuses: { type: 'array', items: { type: 'string' } },
      dateFrom: { type: 'string' }, dateTo: { type: 'string' },
      timezone: { type: 'string' }, includeUndated: { type: 'boolean' } },
    []),
  schema('get_task_detail', '按 taskId 读取任务详情、关联通知、材料清单与版本。',
    { taskId: { type: 'string' } }, ['taskId']),
  schema('get_notice', '按 noticeId 读取通知原文、发布时间与来源。',
    { noticeId: { type: 'string' } }, ['noticeId']),
  schema('get_availability', '读取指定日期区间的可用时间与已占用区间（T24 排程前为占位）。',
    { dateFrom: { type: 'string' }, dateTo: { type: 'string' } }, ['dateFrom', 'dateTo']),
  schema('propose_task_changes', '生成任务创建/修改草案与关联新通知，仅保存草案、不改正式任务，等待用户确认。',
    { sessionId: { type: 'string' }, expectedRevision: { type: 'integer' },
      notices: { type: 'array' }, changes: { type: 'array' } },
    ['sessionId', 'expectedRevision', 'changes'])
];

export function isAllowedAction(action: string): boolean {
  return ALLOWED_ACTIONS.includes(action);
}

export function isRecord(value: Object | null): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 校验一条模型 tool_call；返回错误码，合法返回空串。 */
export function validateCall(call: ToolCall): string {
  if (call === null || typeof call !== 'object') return TOOL_ERRORS.INVALID_ARGUMENT;
  if (typeof call.id !== 'string' || call.id.trim().length === 0) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (typeof call.action !== 'string' || !isAllowedAction(call.action)) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (!isRecord(call.params)) return TOOL_ERRORS.INVALID_ARGUMENT;
  return '';
}

/** 归一化一条执行结果；成功时 errorCode=null、data 可空；失败时 data=null、errorCode 非空。 */
export function normalizeResult(id: string, action: string, params: Object, success: boolean,
  data: Object | null, errorCode: string | null, message: string): ToolResult {
  const result: ToolResult = { id: id, action: action, params: params, success: success, data: data,
    errorCode: errorCode, message: message };
  if (success) {
    result.errorCode = null;
    result.message = '';
    return result;
  }
  result.data = null;
  result.errorCode = errorCode === null || errorCode === '' ? TOOL_ERRORS.STORAGE_FAILED : errorCode;
  result.message = typeof message === 'string' ? message : '';
  return result;
}
