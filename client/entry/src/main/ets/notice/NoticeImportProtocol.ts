import { GatewayConfig, GatewayResponse } from '../chat/ChatModels';
import { NoticeDraft, parseNoticeDraft } from './NoticeDraftModels';
import { StorageFailure } from '../data/storage/StorageTypes';

export class NoticeExtractionRequest {
  rawText: string = '';
  publishedAt: string | null = null;
  sourceLabel: string | null = null;
  timezone: string = 'Asia/Shanghai';
  draft: NoticeDraft | null = null;
  answers: Object[] = [];
}

export class NoticeExtractionResult {
  draft: NoticeDraft | null = null;
  degraded: boolean = false;
  errorCode: string = '';
  requestId: string = '';
}

export interface NoticeExtractionCall {
  result: Promise<GatewayResponse>;
  cancel(): void;
}

export interface NoticeExtractionTransport {
  start(config: GatewayConfig, request: NoticeExtractionRequest): NoticeExtractionCall;
}

interface WireDraftReply {
  type?: string;
  draft?: Object;
  degraded?: boolean;
  errorCode?: string;
  requestId?: string;
}

export function extractNoticeUrl(config: GatewayConfig): string {
  return config.baseUrl.trim().replace(/\/+$/, '') + '/api/agent/extract-notice';
}

export function encodeNoticeExtraction(request: NoticeExtractionRequest): string {
  return JSON.stringify({
    rawText: request.rawText,
    publishedAt: request.publishedAt,
    sourceLabel: request.sourceLabel,
    timezone: request.timezone,
    answers: request.answers,
    draft: request.draft
  });
}

export function decodeNoticeExtraction(response: GatewayResponse): NoticeExtractionResult {
  let reply: WireDraftReply | null = null;
  try {
    const parsed = JSON.parse(response.body) as WireDraftReply;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) reply = parsed;
  } catch (error) {
    reply = null;
  }
  let requestId: string = '';
  if (reply !== null && typeof reply.requestId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(reply.requestId)) {
    requestId = reply.requestId;
  }
  if (response.status < 200 || response.status >= 300) {
    return errorResult(httpErrorCode(response.status), requestId);
  }
  if (reply === null) return errorResult('INVALID_RESPONSE', requestId);
  if (reply.type === 'error') {
    const code: string = typeof reply.errorCode === 'string' && isGatewayError(reply.errorCode) ?
      reply.errorCode : 'GATEWAY_ERROR';
    return errorResult(code, requestId);
  }
  if (reply.type !== 'draft' || typeof reply.draft !== 'object' || reply.draft === null ||
    (reply.degraded !== undefined && typeof reply.degraded !== 'boolean')) {
    return errorResult('INVALID_RESPONSE', requestId);
  }
  try {
    const result = new NoticeExtractionResult();
    result.draft = parseNoticeDraft(reply.draft);
    result.degraded = reply.degraded === true;
    result.requestId = requestId;
    return result;
  } catch (error) {
    if (error instanceof StorageFailure) return errorResult('INVALID_RESPONSE', requestId);
    return errorResult('INVALID_RESPONSE', requestId);
  }
}

export function noticeErrorText(code: string): string {
  switch (code) {
    case 'INVALID_RAW_TEXT': return '请粘贴通知原文，最多 10000 个字符。';
    case 'CONFIG_URL': return '尚未配置网关。请返回对话页，在网关设置中填写服务地址。';
    case 'CONFIG_TOKEN': return '网关项目凭证无效，请返回对话页重新填写。';
    case 'CONFIG_TIMEOUT': return '网关等待时限无效，请返回对话页重新设置。';
    case 'EMPTY_TITLE': return '请填写任务名称后再确认。';
    case 'INVALID_DEADLINE': return '截止日期或时刻无效；未知的截止时间请选择“待补充”。';
    case 'INVALID_PRIORITY': return '优先级取值无效。';
    case 'INVALID_REMAINING': return '剩余工时必须是大于等于 0 的整数。';
    case 'INVALID_KIND': return '任务分类取值无效。';
    case 'INVALID_SOURCE': return '来源标签或发布时间格式无效。';
    case 'UNAUTHORIZED': return '项目凭证未通过验证，请返回对话页检查网关设置。';
    case 'RATE_LIMITED': return '请求较频繁，请稍后重试。';
    case 'INVALID_REQUEST': return '网关未接受这次通知提取请求，请核对输入。';
    case 'CONFIG_ERROR': return '网关尚未配置好模型服务，请联系服务维护者。';
    case 'MODEL_ERROR': return '模型服务暂时没有返回有效结果，原文和当前填写已保留。';
    case 'INVALID_RESPONSE': return '模型返回的草案格式不符合约定，原文和当前填写已保留。';
    case 'VERSION_CONFLICT': return '本地数据在确认前发生变化，请重新提取或刷新后再确认。';
    case 'STORAGE_FAILED': return '未能保存，草案和原文已保留；请检查本地存储后重试。';
    case 'TIMEOUT': return '等待模型超时，原文已保留，可稍后手动重试。';
    case 'NETWORK': return '无法连接网关，请检查网络、地址和服务后重试。';
    case 'CANCELLED': return '已停止等待，原文和当前填写已保留。';
    case 'BACKGROUND': return '离开页面后已停止等待，原文和当前填写已保留。';
    default: return '这次操作未成功，原文和草案已保留，请稍后重试。';
  }
}

function errorResult(errorCode: string, requestId: string): NoticeExtractionResult {
  const result = new NoticeExtractionResult();
  result.errorCode = errorCode;
  result.requestId = requestId;
  return result;
}

function httpErrorCode(status: number): string {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400) return 'INVALID_REQUEST';
  if (status === 500) return 'CONFIG_ERROR';
  if (status === 502) return 'MODEL_ERROR';
  return 'HTTP_ERROR';
}

function isGatewayError(code: string): boolean {
  return code === 'UNAUTHORIZED' || code === 'RATE_LIMITED' || code === 'INVALID_REQUEST' ||
    code === 'CONFIG_ERROR' || code === 'MODEL_ERROR';
}
