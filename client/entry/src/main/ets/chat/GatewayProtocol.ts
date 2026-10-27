import { GatewayConfig, GatewayResponse, TurnResult } from './ChatModels';

interface WireReply {
  type?: string;
  text?: string;
  question?: string;
  errorCode?: string;
  requestId?: string;
}

interface TurnContext {
  timezone: string;
}

interface TurnRequest {
  message: string;
  context: TurnContext;
  tools: Object[];
  results: Object[];
}

export function validateConfig(config: GatewayConfig): string {
  // A gateway root URL, optionally behind a path prefix. Reject credentials, query and fragments.
  const url = config.baseUrl.trim();
  if (!/^https?:\/\/(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?|\[[0-9a-fA-F:]+\])(?::[0-9]{1,5})?(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%/-]*)?$/.test(url)) {
    return 'CONFIG_URL';
  }
  if (!/^[\x21-\x7E]+$/.test(config.token)) {
    return 'CONFIG_TOKEN';
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs % 1000 !== 0 ||
    config.timeoutMs < 5000 || config.timeoutMs > 120000) {
    return 'CONFIG_TIMEOUT';
  }
  return '';
}

export function turnUrl(config: GatewayConfig): string {
  return config.baseUrl.trim().replace(/\/+$/, '') + '/api/model/turn';
}

export function encodeTurn(message: string): string {
  const context: TurnContext = { timezone: 'Asia/Shanghai' };
  const body: TurnRequest = { message: message, context: context, tools: [], results: [] };
  return JSON.stringify(body);
}

export function decodeTurn(response: GatewayResponse): TurnResult {
  let reply: WireReply | null = null;
  try {
    reply = JSON.parse(response.body) as WireReply;
  } catch (_) {
    // HTTP errors can contain a proxy's HTML; never show it as a model answer.
  }
  if (typeof reply !== 'object' || reply === null || Array.isArray(reply)) {
    reply = null;
  }
  let requestId = '';
  if (reply !== null && typeof reply.requestId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(reply.requestId)) {
    requestId = reply.requestId;
  }
  if (response.status < 200 || response.status >= 300) {
    let code = 'HTTP_ERROR';
    if (response.status === 401) {
      code = 'UNAUTHORIZED';
    } else if (response.status === 429) {
      code = 'RATE_LIMITED';
    } else if (response.status === 400) {
      code = 'INVALID_REQUEST';
    } else if (response.status === 500) {
      code = 'CONFIG_ERROR';
    } else if (response.status === 502) {
      code = 'MODEL_ERROR';
    }
    return new TurnResult('', code, requestId);
  }
  if (reply === null) {
    return new TurnResult('', 'INVALID_RESPONSE');
  }
  if (reply.type === 'error') {
    const code = typeof reply.errorCode === 'string' && isGatewayError(reply.errorCode) ? reply.errorCode : 'GATEWAY_ERROR';
    return new TurnResult('', code, requestId);
  }
  if (reply.type === 'tool_calls') {
    return new TurnResult('', 'TOOLS_UNAVAILABLE', requestId);
  }
  const text = reply.type === 'answer' ? reply.text : (reply.type === 'clarification' ? reply.question : undefined);
  if (typeof text !== 'string' || text.trim().length === 0) {
    return new TurnResult('', 'INVALID_RESPONSE', requestId);
  }
  return new TurnResult(text, '', requestId);
}

function isGatewayError(code: string): boolean {
  return code === 'UNAUTHORIZED' || code === 'RATE_LIMITED' || code === 'INVALID_REQUEST' ||
    code === 'CONFIG_ERROR' || code === 'MODEL_ERROR';
}

export function errorText(code: string): string {
  switch (code) {
    case 'CONFIG_URL': return '请输入网关根地址，例如 https://gateway.example.com。';
    case 'CONFIG_TOKEN': return '请填写有效的项目凭证（非空 ASCII 字符，不含空格）。';
    case 'CONFIG_TIMEOUT': return '等待时限需为 5～120 秒的整数。';
    case 'EMPTY_MESSAGE': return '先写下你的问题。';
    case 'MESSAGE_TOO_LONG': return '问题最多 4000 个字符，请缩短后发送。';
    case 'UNAUTHORIZED': return '项目凭证未通过验证，请检查网关设置。';
    case 'RATE_LIMITED': return '请求较频繁，请稍后重试。';
    case 'INVALID_REQUEST': return '网关未接受这次请求，请核对接口版本。';
    case 'CONFIG_ERROR': return '网关尚未配置好模型服务，请联系服务维护者。';
    case 'MODEL_ERROR': return '模型服务暂时没有返回有效结果，请稍后重试。';
    case 'INVALID_RESPONSE': return '网关返回格式不符合约定，请联系服务维护者。';
    case 'TOOLS_UNAVAILABLE': return '当前仅支持文字问答，这次请求需要的任务操作尚未接入。';
    case 'TIMEOUT': return '等待回复超时，输入已保留。可稍后手动重试。';
    case 'CANCELLED': return '已停止等待，输入已保留。';
    case 'BACKGROUND': return '离开页面后已停止等待，输入已保留。';
    case 'NETWORK': return '无法连接网关，请检查网络、地址和服务是否可用。';
    default: return '这次请求未成功，输入已保留，请稍后重试。';
  }
}
