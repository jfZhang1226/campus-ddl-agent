import { Message, MessageToolCall, MessageToolResult } from '../../domain/StorageModels';
import { StorageFailure, requireStorage } from './StorageTypes';

function nonempty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function record(value: Object | null): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]';
}

/** JSON payloads may contain scalar/array/null values, but not lossy JS values. */
function json(value: Object | null, parents: Object[] = []): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || parents.includes(value) || parents.length >= 64) return false;
  const nested: Object[] = parents.concat([value]);
  if (Array.isArray(value)) {
    for (let i: number = 0; i < value.length; i++) {
      if (!json(value[i], nested)) return false;
    }
    return true;
  }
  if (!record(value)) return false;
  const fields = value as Record<string, Object | null>;
  return Object.keys(fields).every((key: string) => json(fields[key], nested));
}

/** Run before JSON.stringify so NaN/undefined/functions cannot silently change data. */
export function requireSessionJson(value: Object): void {
  if (!json(value)) {
    throw new StorageFailure('INVALID_ARGUMENT', '会话必须是有限、无循环且对象/数组嵌套不超过64层的 JSON 数据。');
  }
}

function equalJson(left: Object | null, right: Object | null): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item: Object | null, index: number) => equalJson(item, right[index]));
  }
  const a = left as Record<string, Object | null>;
  const b = right as Record<string, Object | null>;
  const keys: string[] = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key: string) =>
    Object.prototype.hasOwnProperty.call(b, key) && equalJson(a[key], b[key]));
}

function checkCall(call: MessageToolCall): void {
  requireStorage(record(call) && nonempty(call.id) && nonempty(call.action) &&
    record(call.params) && json(call.params), '工具调用的 id/action/params 无效。');
}

function checkResult(result: MessageToolResult): void {
  requireStorage(record(result), '工具结果必须是对象。');
  checkCall(result);
  requireStorage(typeof result.success === 'boolean' && json(result.data) && typeof result.message === 'string' &&
    ((result.success && result.errorCode === null) ||
      (!result.success && nonempty(result.errorCode as string) && result.data === null)),
    '工具结果的 success/data/errorCode/message 不一致。');
}

/** v1 has no call IDs; preserve its display fields without inventing replayable calls. */
export function checkMessages(messages: Message[], legacy: boolean): void {
  const calls: MessageToolCall[] = [];
  const completed: string[] = [];
  for (const message of messages) {
    if (legacy) {
      requireStorage(message.type === undefined && message.calls === undefined && message.results === undefined,
        '旧会话含未约定的消息扩展，原文件已保留。');
      message.type = message.role === 'tool' || (message.role === 'assistant' &&
        (message.toolName !== null || message.toolResultSummary !== null)) ?
        'legacy_tool' : 'text';
      message.calls = [];
      message.results = [];
    }
    requireStorage(Array.isArray(message.calls) && Array.isArray(message.results), '消息缺少 calls/results 数组。');
    const toolCalls: boolean = message.type === 'tool_calls';
    const toolResult: boolean = message.type === 'tool_result';
    const legacyTool: boolean = message.type === 'legacy_tool';
    const plain: boolean = ['text', 'answer', 'clarification'].includes(message.type);
    requireStorage(toolCalls || toolResult || legacyTool || plain, '消息回合类型不受支持。');
    requireStorage(toolCalls ? message.role === 'assistant' && message.calls.length > 0 : message.calls.length === 0,
      '工具调用消息的角色或 calls 数量无效。');
    requireStorage(toolResult ? message.role === 'tool' && message.results.length > 0 : message.results.length === 0,
      '工具结果消息的角色或 results 数量无效。');
    if (legacyTool) {
      requireStorage(['assistant', 'tool'].includes(message.role) && typeof message.text === 'string', '旧工具摘要无效。');
    }
    if (plain) {
      requireStorage(message.role !== 'tool' && typeof message.text === 'string', '文本消息不能冒充工具结果。');
      if (message.type !== 'text') {
        requireStorage(message.role === 'assistant' && nonempty(message.text as string), '回答或追问消息无效。');
      }
    }
    for (const call of message.calls) {
      checkCall(call);
      requireStorage(!calls.some((previous: MessageToolCall) => previous.id === call.id), '会话工具调用 ID 重复。');
      calls.push(call);
    }
    for (const result of message.results) {
      checkResult(result);
      const call: MessageToolCall | undefined = calls.find((candidate: MessageToolCall) => candidate.id === result.id);
      requireStorage(call !== undefined && call.action === result.action && equalJson(call.params, result.params),
        '工具结果没有匹配的先前调用。');
      requireStorage(!completed.includes(result.id), '同一工具调用存在重复完成结果。');
      completed.push(result.id);
    }
  }
}
