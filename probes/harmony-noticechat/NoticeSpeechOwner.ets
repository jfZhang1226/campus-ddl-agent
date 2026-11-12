import { common } from '@kit.AbilityKit';
import { ArkNoticeExtractionTransport } from '../adapters/ArkNoticeExtractionTransport';
import { getClientStorage } from '../data/ClientStorage';
import { HarmonySpeechPort } from './HarmonySpeechPort';
import { ProbeClock, SpeechProbeController } from './SpeechProbeController';
import { NoticeCommitGate } from './NoticeCommitGate';
import { NoticeVoiceController } from './NoticeVoiceController';

class DeviceClock implements ProbeClock {
  schedule(action: () => void, ms: number): number { return setTimeout(action, ms); }
  cancel(id: number): void { clearTimeout(id); }
}

class NoticeSpeechOwner {
  private controller: NoticeVoiceController | undefined;
  get(context: common.UIAbilityContext): NoticeVoiceController {
    if (this.controller === undefined) {
      const speech = new SpeechProbeController(new HarmonySpeechPort(context), new DeviceClock());
      this.controller = new NoticeVoiceController(new ArkNoticeExtractionTransport(),
        new NoticeCommitGate(getClientStorage(context.filesDir).local), speech);
    }
    return this.controller;
  }
  pause(): void { this.controller?.pause(); }
  destroy(): void { this.controller?.dispose(); this.controller = undefined; }
}
export const noticeSpeechOwner = new NoticeSpeechOwner();
