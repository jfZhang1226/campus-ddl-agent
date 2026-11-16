// T17 真实查询工具与方案执行串联：工具协议层（纯逻辑，无网络/存储依赖）。
//
// 定义模型可见的白名单工具 schema、逐动作嵌套参数校验、执行结果归一化与错误契约。
// 模型可见 schema 与 validateParams 保持一致：schema 里声明的必填/类型/null 规则就是运行时校验规则。
// 边界：模型只能 propose/查询；apply/confirm 由客户端确认事件触发（T16 ClientConfirmation）。

export const MAX_AGENT_STEPS: number = 8;

export const ALLOWED_ACTIONS: string[] = [
  'get_tasks', 'get_task_detail', 'get_notice', 'get_availability', 'propose_task_changes'
];

export const READ_ONLY_ACTIONS: string[] = [
  'get_tasks', 'get_task_detail', 'get_notice', 'get_availability'
];

const KINDS: string[] = ['assignment', 'report', 'registration', 'other'];
const PRIORITIES: string[] = ['low', 'normal', 'high'];
const STATUSES: string[] = ['todo', 'in_progress', 'ready', 'submitted', 'done', 'cancelled'];
const PRECISIONS: string[] = ['exact', 'date_only', 'unknown'];
const TASK_DRAFT_KEYS: string[] = ['title', 'course', 'kind', 'deadlinePrecision', 'deadlineDate', 'dueAt',
  'timezone', 'priority', 'status', 'remainingMinutes', 'submissionChannel', 'noticeIds'];
const CHANGE_KEYS: string[] = ['action', 'taskId', 'expectedVersion', 'draft', 'checklistCreates'];
const MATERIAL_KEYS: string[] = ['label', 'sourceNoticeId'];

export interface ToolCall {
  id: string;
  action: string;
  params: Object;
}

export interface ToolResult {
  id: string;
  action: string;
  params: Object;
  success: boolean;
  data: Object | null;
  errorCode: string | null;
  message: string;
}

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

function nullableText(value: Object | null): boolean {
  return value === null || nonEmpty(value);
}

function hasOnlyKeys(value: Object | null, keys: string[]): boolean {
  if (!isRecord(value)) return false;
  return Object.keys(value as Object).every((key: string) => keys.includes(key));
}

function hasKey(value: Object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

// --------------------------------------------------------------------------- 参数校验

function validateTaskDraft(draft: Object): string {
  if (!isRecord(draft) || !hasOnlyKeys(draft, TASK_DRAFT_KEYS)) return TOOL_ERRORS.INVALID_ARGUMENT;
  const d = draft as Record<string, Object | null>;
  if (!nonEmpty(d.title)) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (!nullableText(d.course) || !nullableText(d.submissionChannel)) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (d.kind !== null && !KINDS.includes(d.kind as string)) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (d.priority !== null && !PRIORITIES.includes(d.priority as string)) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (!STATUSES.includes(d.status as string)) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (d.remainingMinutes !== null && (typeof d.remainingMinutes !== 'number' ||
    !Number.isSafeInteger(d.remainingMinutes as number) || (d.remainingMinutes as number) < 0)) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (!nonEmpty(d.timezone)) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (!PRECISIONS.includes(d.deadlinePrecision as string)) return TOOL_ERRORS.INVALID_ARGUMENT;
  const precision: string = d.deadlinePrecision as string;
  const date: Object | null = d.deadlineDate;
  const due: Object | null = d.dueAt;
  if (precision === 'unknown' && (date !== null || due !== null)) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (precision === 'date_only' && (!nonEmpty(date) || due !== null)) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (precision === 'exact' && (date !== null || !nonEmpty(due))) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (!Array.isArray(d.noticeIds) || !(d.noticeIds as Object[]).every((id: Object) => nonEmpty(id)) ||
    new Set<string>(d.noticeIds as string[]).size !== (d.noticeIds as string[]).length) return TOOL_ERRORS.INVALID_ARGUMENT;
  return '';
}

function validateChange(change: Object): string {
  if (!isRecord(change) || !hasOnlyKeys(change, CHANGE_KEYS)) return TOOL_ERRORS.INVALID_ARGUMENT;
  const c = change as Record<string, Object | null>;
  if (c.action !== 'create' && c.action !== 'update') return TOOL_ERRORS.INVALID_ARGUMENT;
  const draftError: string = validateTaskDraft(c.draft as Object);
  if (draftError.length > 0) return draftError;
  if (!hasKey(change, 'checklistCreates') || !Array.isArray(c.checklistCreates)) return TOOL_ERRORS.INVALID_ARGUMENT;
  const creates: Object[] = c.checklistCreates as Object[];
  for (const item of creates) {
    if (!isRecord(item) || !hasOnlyKeys(item, MATERIAL_KEYS)) return TOOL_ERRORS.INVALID_ARGUMENT;
    const m = item as Record<string, Object | null>;
    if (!nonEmpty(m.label)) return TOOL_ERRORS.INVALID_ARGUMENT;
    if (!hasKey(item, 'sourceNoticeId')) return TOOL_ERRORS.INVALID_ARGUMENT;
    if (m.sourceNoticeId !== null && !nonEmpty(m.sourceNoticeId)) return TOOL_ERRORS.INVALID_ARGUMENT;
  }
  if (c.action === 'create') {
    if (c.taskId !== null || c.expectedVersion !== null) return TOOL_ERRORS.INVALID_ARGUMENT;
  } else {
    if (!nonEmpty(c.taskId) || typeof c.expectedVersion !== 'number' ||
      !Number.isSafeInteger(c.expectedVersion as number) || (c.expectedVersion as number) <= 0) return TOOL_ERRORS.INVALID_ARGUMENT;
  }
  return '';
}

function validateProposeParams(p: Record<string, Object | null>): string {
  if (!hasOnlyKeys(p, ['sessionId', 'expectedRevision', 'notices', 'changes'])) return TOOL_ERRORS.INVALID_ARGUMENT;
  if (!nonEmpty(p.sessionId) || typeof p.expectedRevision !== 'number' ||
    !Number.isSafeInteger(p.expectedRevision as number) || (p.expectedRevision as number) < 0 ||
    !Array.isArray(p.notices) || !Array.isArray(p.changes) || (p.changes as Object[]).length === 0 ||
    (p.changes as Object[]).length > 50) return TOOL_ERRORS.INVALID_ARGUMENT;
  for (const entry of p.changes as Object[]) {
    const error: string = validateChange(entry);
    if (error.length > 0) return error;
  }
  return '';
}

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
      !(p.statuses as Object[]).every((status: Object) => typeof status === 'string'))) return TOOL_ERRORS.INVALID_ARGUMENT;
    if (p.includeUndated !== undefined && typeof p.includeUndated !== 'boolean') return TOOL_ERRORS.INVALID_ARGUMENT;
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

const taskDraftSchema: Object = { type: 'object', properties: {
  title: { type: 'string' },
  course: { type: ['string', 'null'] },
  kind: { type: ['string', 'null'], enum: ['assignment', 'report', 'registration', 'other', null] },
  deadlinePrecision: { type: 'string', enum: PRECISIONS },
  deadlineDate: { type: ['string', 'null'] },
  dueAt: { type: ['string', 'null'] },
  timezone: { type: 'string' },
  priority: { type: ['string', 'null'], enum: ['low', 'normal', 'high', null] },
  status: { type: 'string', enum: STATUSES },
  remainingMinutes: { type: ['integer', 'null'] },
  submissionChannel: { type: ['string', 'null'] },
  noticeIds: { type: 'array', items: { type: 'string' } }
}, required: TASK_DRAFT_KEYS };

const createMaterialSchema: Object = { type: 'object', properties: {
  label: { type: 'string' }, sourceNoticeId: { type: ['string', 'null'] } }, required: ['label', 'sourceNoticeId'] };

const changeSchema: Object = { type: 'object', properties: {
  action: { type: 'string', enum: ['create', 'update'] },
  taskId: { type: ['string', 'null'] },
  expectedVersion: { type: ['integer', 'null'] },
  draft: taskDraftSchema,
  checklistCreates: { type: 'array', items: createMaterialSchema }
}, required: ['action', 'taskId', 'expectedVersion', 'draft', 'checklistCreates'] };

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
  schema('propose_task_changes', '生成任务创建/修改草案与关联新通知；可随附本次新增材料（checklistCreates），不得重复已有清单、改写准备状态或声明提交；仅保存草案、不改正式任务，等待用户确认。',
    { sessionId: { type: 'string' }, expectedRevision: { type: 'integer' },
      notices: { type: 'array' }, changes: { type: 'array', items: changeSchema } },
    ['sessionId', 'expectedRevision', 'notices', 'changes'])
];
