import http from '@ohos.net.http';
import { BusinessError } from '@ohos.base';
import { GatewayCall, GatewayConfig, GatewayResponse } from '../chat/ChatModels';
import { turnUrl } from '../chat/GatewayProtocol';
import { AgentGatewayTransport } from '../agent/AgentGatewayProtocol';

class ArkAgentCall implements GatewayCall {
  result: Promise<GatewayResponse>;
  private request: http.HttpRequest = http.createHttp();
  private released: boolean = false;
  constructor(config: GatewayConfig, body: string) { this.result = this.perform(config, body); }
  private async perform(config: GatewayConfig, body: string): Promise<GatewayResponse> {
    try {
      const response = await this.request.request(turnUrl(config), {
        method: http.RequestMethod.POST,
        header: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + config.token },
        extraData: body, expectDataType: http.HttpDataType.STRING, usingCache: false,
        connectTimeout: Math.min(10000, config.timeoutMs), readTimeout: config.timeoutMs
      });
      return new GatewayResponse(response.responseCode, typeof response.result === 'string' ? response.result : '');
    } catch (error) {
      const nativeError = error as BusinessError;
      throw new Error(nativeError.code === 2300028 ? 'TIMEOUT' : 'NETWORK');
    } finally { this.cancel(); }
  }
  cancel(): void { if (!this.released) { this.released = true; this.request.destroy(); } }
}
export class ArkAgentGatewayTransport implements AgentGatewayTransport {
  start(config: GatewayConfig, body: string): GatewayCall { return new ArkAgentCall(config, body); }
}
