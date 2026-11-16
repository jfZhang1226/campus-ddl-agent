import { GatewayCall, GatewayConfig, GatewayResponse } from '../chat/ChatModels';
import { TurnReply } from './AgentLoop';
import { ToolCall, ToolResult, validateCall } from './AgentTools';

export interface AgentGatewayTransport {
  start(config: GatewayConfig, body: string): GatewayCall;
}
interface WireReply { type?: string; text?: string; question?: string; calls?: ToolCall[]; errorCode?: string; }
export function encodeAgentTurn(message: string, context: Object, tools: Object[], results: ToolResult[]): string {
  const body: string = JSON.stringify({ message: message, context: context, tools: tools, results: results });
  if (body.length > 200000) throw new Error('REQUEST_TOO_LARGE');
  return body;
}
export function agentError(code: string): TurnReply { return { type: 'error', text: '', calls: [], errorCode: code }; }
export function decodeAgentTurn(response: GatewayResponse): TurnReply {
  if (response.status < 200 || response.status >= 300) {
    const code: string = response.status === 401 ? 'UNAUTHORIZED' : response.status === 429 ? 'RATE_LIMITED' :
      response.status === 400 ? 'INVALID_REQUEST' : response.status === 500 ? 'CONFIG_ERROR' :
        response.status === 502 ? 'MODEL_ERROR' : 'HTTP_ERROR';
    return agentError(code);
  }
  if (response.body.length > 200000) return agentError('INVALID_RESPONSE');
  let wire: WireReply;
  try { wire = JSON.parse(response.body) as WireReply; } catch (_) { return agentError('INVALID_RESPONSE'); }
  if (wire === null || typeof wire !== 'object' || Array.isArray(wire)) return agentError('INVALID_RESPONSE');
  if (wire.type === 'tool_calls') {
    if (!Array.isArray(wire.calls) || wire.calls.length === 0 || wire.calls.length > 8 ||
      wire.calls.some((call: ToolCall) => validateCall(call).length > 0) ||
      new Set<string>(wire.calls.map((call: ToolCall) => call.id)).size !== wire.calls.length) return agentError('INVALID_RESPONSE');
    return { type: 'tool_calls', text: '', calls: wire.calls, errorCode: '' };
  }
  if (wire.type === 'error') return agentError('MODEL_ERROR');
  const text: string | undefined = wire.type === 'answer' ? wire.text : wire.type === 'clarification' ? wire.question : undefined;
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 12000) return agentError('INVALID_RESPONSE');
  return { type: wire.type === 'clarification' ? 'clarification' : 'answer', text: text, calls: [], errorCode: '' };
}
