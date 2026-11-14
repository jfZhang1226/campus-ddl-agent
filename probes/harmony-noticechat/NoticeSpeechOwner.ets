import { common } from '@kit.AbilityKit';
import { ArkNoticeExtractionTransport } from '../adapters/ArkNoticeExtractionTransport';
import { getClientStorage } from '../data/ClientStorage';
import { HarmonySpeechPort } from './HarmonySpeechPort';
import { ProbeClock, SpeechProbeController } from './SpeechProbeController';
import { NoticeConfirmedWriter } from '../notice/NoticeConfirmedWriter';
import { NoticeSaveController } from '../notice/NoticeSaveController';
import { noticeImportOwner } from '../notice/NoticeImportOwner';

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
      const controller = new NoticeSaveController(new ArkNoticeExtractionTransport(),
        new NoticeConfirmedWriter(storage.local, storage.commits), speech);
      try { noticeImportOwner.claim(controller); }
      catch (error) { controller.dispose(); throw error; }
      this.controller = controller;
    }
    return this.controller;
  }
  pause(): void { this.controller?.pause(); }
  destroy(): void {
    if (this.controller !== undefined) noticeImportOwner.release(this.controller);
    this.controller = undefined;
  }
}
export const noticeSpeechOwner = new NoticeSpeechOwner();
