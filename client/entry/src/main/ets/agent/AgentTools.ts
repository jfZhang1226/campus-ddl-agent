// T17 真实查询工具与方案执行串联：工具协议层（纯逻辑，无网络/存储依赖）。
//
// 定义模型可见的白名单工具 schema、结构化动作校验（含嵌套参数）、执行结果归一化与错误契约。
// 边界：模型只能 propose/查询；apply/confirm 由客户端确认事件触发（T16 ClientConfirmation），
// 绝不出现在本白名单里，confirmed:true 不能伪造授权。

export const MAX_AGENT_STEPS: number = 8;

// 白名单动作：只读查询 + 保存草案。apply_confirmed_proposal 不在此列。
export const ALLOWED_ACTIONS: string[] = [
  'get_tasks', 'get_task_detail', 'get_notice', 'get_availability', 'propose_task_changes'
];

// 只读查询动作：用于 AgentLoop 的「连续重复且无新增结果」终止判断，propose 不参与。
export const READ_ONLY_ACTIONS: string[] = [
  'get_tasks', 'get_task_detail', 'get_notice', 'get_availability'
];

// 模型工具调用（网关 tool_calls 的规范化形态）。
export interface ToolCall {
  id: string;
  action: string;
  params: Object;
}

// 客户端执行后的结构化结果（对齐 session-message-contract 的 results 形态）。
// 成功 data 结构按动作契约：get_tasks→{tasks,revision}；get_task_detail→{task,notices,checklistItems,revision}；
// get_notice→{notice,revision}；get_availability→{blocks,revision}（T24 前 NOT_IMPLEMENTED）；
// propose_task_changes→CommitProposal（含 id/expectedRevision/checklistItems）。
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

export function isAllowedAction(action: string): boolean {
  return ALLOWED_ACTIONS.includes(action);
}

export function isReadOnlyAction(action: string): boolean {
  return READ_ONLY_ACTIONS.includes(action);
}

export function isRecord(value: Object | null): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: Object | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOnlyKeys(value: Object | null, keys: string[]): boolean {
  if (!isRecord(value)) return false;
  return Object.keys(value as Object).every((key: string) => keys.includes(key));
}

// --------------------------------------------------------------------------- 参数校验

/** 逐动作校验 params 的类型、必填与未知字段；返回错误码，合法返回空串。 */
export function validateParams(action: string, params: Object): string {
  if (!isRecord(params)) return TOOL_ERRORS.INVALID_ARGUMENT;
  const p = params as Record<string, Object | null>;
  if (action === 'get_task_detail') {
    return hasOnlyKeys(p, ['taskId']) && nonEmpty(p.taskId) ? '' : TOOL_ERRORS.INVALID_ARGUMENT;
  }
  if (action === 'get_notice') {
    return hasOnlyKeys(p, ['noticeId']) && nonEmpty(p.noticeId) ? '' : TOOL_ERRORS.INVALID_ARGUMENT;
  }
  if (action === 'get_availability') {
    return hasOnlyKeys(p, ['dateFrom', 'dateTo']) && nonEmpty(p.dateFrom) && nonEmpty(p.dateTo) ?
      '' : TOOL_ERRORS.INVALID_ARGUMENT;
  }
  if (action === 'get_tasks') {
    if (!hasOnlyKeys(p, ['keyword', 'course', 'statuses', 'dateFrom', 'dateTo', 'timezone', 'includeUndated'])) {
      return TOOL_ERRORS.INVALID_ARGUMENT;
    }
    if (p.statuses !== undefined && (!Array.isArray(p.statuses) ||
      !(p.statuses as Object[]).every((status: Object) => typeof status === 'string'))) {
      return TOOL_ERRORS.INVALID_ARGUMENT;
    }
    if (p.includeUndated !== undefined && typeof p.includeUndated !== 'boolean') {
      return TOOL_ERRORS.INVALID_ARGUMENT;
    }
    for (const key of ['keyword', 'course', 'dateFrom', 'dateTo', 'timezone']) {
      if (p[key] !== undefined && p[key] !== null && typeof p[key] !== 'string') return TOOL_ERRORS.INVALID_ARGUMENT;
    }
    return '';
  }
  if (action === 'propose_task_changes') {
    return validateProposeParams(p);
  }
  return TOOL_ERRORS.INVALID_ARGUMENT;
}

function validateProposeParams(p: Record<string, Object | null>): string {
  if (!hasOnlyKeys(p, ['sessionId', 'expectedRevision', 'notices', 'changes'])) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (!nonEmpty(p.sessionId) || typeof p.expectedRevision !== 'number' ||
    !Number.isSafeInteger(p.expectedRevision as number) || (p.expectedRevision as number) < 0 ||
    !Array.isArray(p.notices) || !Array.isArray(p.changes) || (p.changes as Object[]).length === 0 ||
    (p.changes as Object[]).length > 50) return TOOL_ERRORS.INVALID_ARGUMENT;
  const changes: Object[] = p.changes as Object[];
  for (const entry of changes) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['action', 'taskId', 'expectedVersion', 'draft', 'checklistCreates'])) {
      return TOOL_ERRORS.INVALID_ARGUMENT;
    }
    const change = entry as Record<string, Object | null>;
    if (change.action !== 'create' && change.action !== 'update') return TOOL_ERRORS.INVALID_ARGUMENT;
    if (!isRecord(change.draft) || !hasOnlyKeys(change.draft, [
      'title', 'course', 'kind', 'deadlinePrecision', 'deadlineDate', 'dueAt', 'timezone', 'priority',
      'status', 'remainingMinutes', 'submissionChannel', 'noticeIds'])) return TOOL_ERRORS.INVALID_ARGUMENT;
    const draft = change.draft as Record<string, Object | null>;
    if (!nonEmpty(draft.title) || !Array.isArray(draft.noticeIds)) return TOOL_ERRORS.INVALID_ARGUMENT;
    const creates = change.checklistCreates === undefined ? [] : change.checklistCreates;
    if (!Array.isArray(creates)) return TOOL_ERRORS.INVALID_ARGUMENT;
    if (change.action === 'update') {
      if (!nonEmpty(change.taskId) || typeof change.expectedVersion !== 'number' ||
        !Number.isSafeInteger(change.expectedVersion as number) || (change.expectedVersion as number) <= 0) {
        return TOOL_ERRORS.INVALID_ARGUMENT;
      }
      // 材料仅随新任务创建；编辑变化携带材料即为未支持的 T22 形态，明确拒绝。
      if (creates.length > 0) return TOOL_ERRORS.INVALID_ARGUMENT;
    } else {
      if (change.taskId !== null || change.expectedVersion !== null) return TOOL_ERRORS.INVALID_ARGUMENT;
      for (const item of creates) {
        if (!isRecord(item) || !hasOnlyKeys(item, ['label', 'sourceNoticeId'])) return TOOL_ERRORS.INVALID_ARGUMENT;
        const material = item as Record<string, Object | null>;
        if (!nonEmpty(material.label)) return TOOL_ERRORS.INVALID_ARGUMENT;
        if (material.sourceNoticeId !== null && !nonEmpty(material.sourceNoticeId)) return TOOL_ERRORS.INVALID_ARGUMENT;
      }
    }
  }
  return '';
}

/** 校验一条模型 tool_call；返回错误码，合法返回空串。 */
export function validateCall(call: ToolCall): string {
  if (call === null || typeof call !== 'object') return TOOL_ERRORS.INVALID_ARGUMENT;
  if (typeof call.id !== 'string' || call.id.trim().length === 0) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (typeof call.action !== 'string' || !isAllowedAction(call.action)) return TOOL_ERRORS.INVALID_ARGUMENT;
  return validateParams(call.action, call.params);
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

// --------------------------------------------------------------------------- 模型 schema

function schema(name: string, description: string, properties: Object, required: string[]): Object {
  return { type: 'function', function: { name: name, description: description,
    parameters: { type: 'object', properties: properties, required: required } } };
}

const createMaterialSchema: Object = { type: 'object', properties: {
  label: { type: 'string' }, sourceNoticeId: { type: ['string', 'null'] } }, required: ['label'] };

const changeSchema: Object = { type: 'object', properties: {
  action: { type: 'string', enum: ['create', 'update'] },
  taskId: { type: ['string', 'null'] },
  expectedVersion: { type: ['integer', 'null'] },
  draft: { type: 'object' },
  checklistCreates: { type: 'array', items: createMaterialSchema }
}, required: ['action', 'draft'] };

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
  schema('get_notice', '按 noticeId 读取已正式保存的通知原文、发布时间与来源；不含待确认方案里的新来源。',
    { noticeId: { type: 'string' } }, ['noticeId']),
  schema('get_availability', '读取指定日期区间的可用时间与已占用区间（T24 排程前为占位）。',
    { dateFrom: { type: 'string' }, dateTo: { type: 'string' } }, ['dateFrom', 'dateTo']),
  schema('propose_task_changes', '生成任务创建/修改草案与关联新通知；创建型可随附材料（checklistCreates），仅保存草案、不改正式任务，等待用户确认。',
    { sessionId: { type: 'string' }, expectedRevision: { type: 'integer' },
      notices: { type: 'array' }, changes: { type: 'array', items: changeSchema } },
    ['sessionId', 'expectedRevision', 'changes'])
];
