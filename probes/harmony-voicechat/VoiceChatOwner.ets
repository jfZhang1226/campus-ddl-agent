import { common } from '@kit.AbilityKit';
import { ArkGatewayTransport } from '../adapters/ArkGatewayTransport';
import { ChatController } from '../chat/ChatController';
import { VoiceChatController } from '../speech/VoiceChatController';
import { HarmonySpeechPort } from './HarmonySpeechPort';
import { ProbeClock, SpeechProbeController } from './SpeechProbeController';
import { GatewaySettings } from '../chat/GatewaySettings';
import { HarmonyGatewaySecretStore } from './HarmonyGatewaySecretStore';

class DeviceClock implements ProbeClock {
  schedule(action: () => void, ms: number): number { return setTimeout(action, ms); }
  cancel(id: number): void { clearTimeout(id); }
}
class VoiceChatOwner {
  private controller: VoiceChatController | undefined;
  private connection: GatewaySettings | undefined;
  get(context: common.UIAbilityContext): VoiceChatController {
    if (!this.controller) {
      const speech = new SpeechProbeController(new HarmonySpeechPort(context), new DeviceClock());
      this.controller = new VoiceChatController(new ChatController(new ArkGatewayTransport()), speech);
      this.connection = new GatewaySettings(new HarmonyGatewaySecretStore(), this.controller);
    }
    return this.controller;
  }
  pause(): void { this.controller?.pause(); }
  settings(context: common.UIAbilityContext): GatewaySettings { this.get(context); return this.connection!; }
  destroy(): void { this.controller?.dispose(); this.controller = undefined; this.connection = undefined; }
}
export const voiceChatOwner = new VoiceChatOwner();
