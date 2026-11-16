import http from '@ohos.net.http';
import { BusinessError } from '@ohos.base';
import { GatewayConfig, GatewayResponse } from '../chat/ChatModels';
import {
  NoticeExtractionCall, NoticeExtractionRequest, NoticeExtractionTransport,
  encodeNoticeExtraction, extractNoticeUrl
} from '../notice/NoticeImportProtocol';

class ArkNoticeExtractionCall implements NoticeExtractionCall {
  result: Promise<GatewayResponse>;
  private request: http.HttpRequest;
  private released: boolean = false;

  constructor(config: GatewayConfig, extractRequest: NoticeExtractionRequest) {
    this.request = http.createHttp();
    this.result = this.perform(config, extractRequest);
  }

  private async perform(config: GatewayConfig, extractRequest: NoticeExtractionRequest): Promise<GatewayResponse> {
    try {
      const response = await this.request.request(extractNoticeUrl(config), {
        method: http.RequestMethod.POST,
        header: { 'Content-Type': 'application/json', 'Accept': 'application/json',
          'Authorization': 'Bearer ' + config.token },
        extraData: encodeNoticeExtraction(extractRequest),
        expectDataType: http.HttpDataType.STRING,
        usingCache: false,
        connectTimeout: Math.min(10000, config.timeoutMs),
        readTimeout: config.timeoutMs
      });
      return new GatewayResponse(response.responseCode, typeof response.result === 'string' ? response.result : '');
    } catch (error) {
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

export class ArkNoticeExtractionTransport implements NoticeExtractionTransport {
  start(config: GatewayConfig, request: NoticeExtractionRequest): NoticeExtractionCall {
    return new ArkNoticeExtractionCall(config, request);
  }
}
