// T17 真实查询工具与方案执行串联：Agent 循环（纯逻辑，依赖注入 transport/executor）。
//
// 客户端驱动的多轮循环：用户消息 → 模型 → 工具调用 → 执行真实查询/草案 → 结果回传 → 继续，
// 直到得到回答/澄清/待确认方案。落实 T02 状态机边界：每次输入最多 MAX_AGENT_STEPS 步，
// 连续两次相同且无新增结果的查询终止并提示补充；apply 永远不在本循环内发生。

import { AGENT_TOOL_SCHEMAS, MAX_AGENT_STEPS, ToolCall, ToolResult, TOOL_ERRORS,
  isAllowedAction, isRecord, normalizeResult, validateCall } from './AgentTools';

// 单轮网关回包（answer / tool_calls / clarification / error 的统一形态）。
export interface TurnReply {
  type: string;       // 'answer' | 'tool_calls' | 'clarification' | 'error'
  text: string;
  calls: ToolCall[];
  errorCode: string;
}

// 注入的网关单轮调用；results 为累积的工具结果（含成功与失败）。
export interface AgentTurn {
  turn(message: string, context: Object, tools: Object[], results: ToolResult[]): Promise<TurnReply>;
}

// 注入的工具执行器：白名单动作 → 真实结果（查询走 T14，草案走 T16 stage，apply 不在此）。
export interface ToolExecutor {
  execute(action: string, params: Object): Promise<ToolResult>;
}

export class AgentOutcome {
  kind: string = 'answer';   // 'answer' | 'clarification' | 'proposal' | 'error' | 'limit'
  text: string = '';
  errorCode: string = '';
  proposalId: string = '';
}

export class AgentLoop {
  constructor(private turn: AgentTurn, private executor: ToolExecutor) {}

  async run(message: string, context: Object): Promise<AgentOutcome> {
    let results: ToolResult[] = [];
    let pending: string = message;
    const seen: string[] = [];
    for (let step: number = 0; step < MAX_AGENT_STEPS; step++) {
      const reply: TurnReply = await this.turn.turn(pending, context, AGENT_TOOL_SCHEMAS, results);
      if (reply.type === 'error') return this.outcome('error', '', reply.errorCode);
      if (reply.type === 'answer') return this.outcome('answer', reply.text, '');
      if (reply.type === 'clarification') return this.outcome('clarification', reply.text, '');
      if (reply.type !== 'tool_calls') return this.outcome('error', '', TOOL_ERRORS.INVALID_ARGUMENT);

      const executed: ToolResult[] = [];
      for (const call of reply.calls) {
        if (validateCall(call).length > 0) return this.outcome('error', '', TOOL_ERRORS.INVALID_ARGUMENT);
        executed.push(await this.executor.execute(call.action, call.params));
      }
      // 连续两次相同且无新增结果的查询终止（对齐 T02 状态机边界）。
      const key: string = JSON.stringify(executed.map((result: ToolResult) => result.action + ':' +
        JSON.stringify(result.params) + ':' + String(result.success)));
      if (seen.includes(key)) return this.outcome('limit', '连续重复查询未得到新增结果，请补充信息。', '');
      seen.push(key);
      results = results.concat(executed);

      // 模型只负责生成草案；一旦 propose 成功，立即交还客户端展示确认卡，不再继续循环。
      const proposed: ToolResult | undefined = executed.find((result: ToolResult) =>
        result.action === 'propose_task_changes' && result.success);
      if (proposed !== undefined && isRecord(proposed.data)) {
        const proposalId: string = (proposed.data as Record<string, Object>).id as string;
        return this.outcome('proposal', '已生成待确认方案，等待客户端确认。', '', proposalId);
      }
      pending = '';
    }
    return this.outcome('limit', '已达到单次输入的最大处理步数，请补充信息后重试。', '');
  }

  private outcome(kind: string, text: string, errorCode: string, proposalId: string = ''): AgentOutcome {
    const result: AgentOutcome = new AgentOutcome();
    result.kind = kind;
    result.text = text;
    result.errorCode = errorCode;
    result.proposalId = proposalId;
    return result;
  }
}
