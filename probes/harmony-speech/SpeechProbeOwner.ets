import { common } from '@kit.AbilityKit';
import { HarmonySpeechPort } from './HarmonySpeechPort';
import { ProbeClock, SpeechProbeController } from './SpeechProbeController';

class DeviceClock implements ProbeClock {
  schedule(action: () => void, ms: number): number { return setTimeout(action, ms); }
  cancel(id: number): void { clearTimeout(id); }
}
class SpeechProbeOwner {
  private controller: SpeechProbeController | undefined;
  get(context: common.UIAbilityContext): SpeechProbeController {
    if (!this.controller) this.controller = new SpeechProbeController(new HarmonySpeechPort(context), new DeviceClock());
    return this.controller;
  }
  pause(): void { this.controller?.cancel(); }
  destroy(): void { this.controller?.dispose(); this.controller = undefined; }
}
export const speechProbeOwner = new SpeechProbeOwner();
