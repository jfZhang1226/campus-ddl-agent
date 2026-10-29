import http from '@ohos.net.http';
import { BusinessError } from '@ohos.base';
import { GatewayCall, GatewayConfig, GatewayResponse, GatewayTransport } from '../chat/ChatModels';
import { encodeTurn, turnUrl } from '../chat/GatewayProtocol';

class ArkGatewayCall implements GatewayCall {
  result: Promise<GatewayResponse>;
  private request: http.HttpRequest;
  private released: boolean = false;

  constructor(config: GatewayConfig, message: string) {
    this.request = http.createHttp();
    this.result = this.perform(config, message);
  }

  private async perform(config: GatewayConfig, message: string): Promise<GatewayResponse> {
    try {
      const response = await this.request.request(turnUrl(config), {
        method: http.RequestMethod.POST,
        header: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + config.token },
        extraData: encodeTurn(message),
        expectDataType: http.HttpDataType.STRING,
        usingCache: false,
        connectTimeout: Math.min(10000, config.timeoutMs),
        readTimeout: config.timeoutMs
      });
      return new GatewayResponse(response.responseCode, typeof response.result === 'string' ? response.result : '');
    } catch (error) {
      // Do not propagate headers, URLs or vendor error text to the page or logs.
      const nativeError = error as BusinessError;
      throw new Error(nativeError.code === 2300028 ? 'TIMEOUT' : 'NETWORK');
    } finally {
      this.cancel();
    }
  }

  cancel(): void {
    if (!this.released) {
      this.released = true;
      this.request.destroy();
    }
  }
}

export class ArkGatewayTransport implements GatewayTransport {
  start(config: GatewayConfig, message: string): GatewayCall {
    return new ArkGatewayCall(config, message);
  }
}
