import { common } from '@kit.AbilityKit';
import { ArkNoticeExtractionTransport } from '../adapters/ArkNoticeExtractionTransport';
import { getClientStorage } from '../data/ClientStorage';
import { HarmonySpeechPort } from './HarmonySpeechPort';
import { ProbeClock, SpeechProbeController } from './SpeechProbeController';
import { NoticeConfirmedWriter } from './NoticeConfirmedWriter';
import { NoticeSaveController } from './NoticeSaveController';

class DeviceClock implements ProbeClock {
  schedule(action: () => void, ms: number): number { return setTimeout(action, ms); }
  cancel(id: number): void { clearTimeout(id); }
}

class NoticeSpeechOwner {
  private controller: NoticeSaveController | undefined;
  get(context: common.UIAbilityContext): NoticeSaveController {
    if (this.controller === undefined) {
      const speech = new SpeechProbeController(new HarmonySpeechPort(context), new DeviceClock());
      const storage = getClientStorage(context.filesDir);
      this.controller = new NoticeSaveController(new ArkNoticeExtractionTransport(),
        new NoticeConfirmedWriter(storage.local, storage.commits), speech);
    }
    return this.controller;
  }
  pause(): void { this.controller?.pause(); }
  destroy(): void { this.controller?.dispose(); this.controller = undefined; }
}
export const noticeSpeechOwner = new NoticeSpeechOwner();
