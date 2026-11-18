import { common } from '@kit.AbilityKit';
import { getClientStorage } from '../data/ClientStorage';
import { ArkAgentGatewayTransport } from '../adapters/ArkAgentGatewayTransport';
import { TaskAgentSession } from '../agent/TaskAgentSession';
import { TaskAgentController } from '../agent/TaskAgentController';
import { SystemChatClock } from '../chat/ChatModels';
import { HarmonySpeechPort } from './HarmonySpeechPort';
import { SpeechProbeController } from './SpeechProbeController';

/** Only the native assembly supplies the microphone/playback port. Business code is shared. */
class TaskAgentSpeechOwner {
  private controller: TaskAgentController | undefined;
  get(context: common.UIAbilityContext): TaskAgentController {
    if (this.controller === undefined) {
      const storage = getClientStorage(context.filesDir);
      const clock = new SystemChatClock();
      const speech = new SpeechProbeController(new HarmonySpeechPort(context), clock);
      this.controller = new TaskAgentController(new TaskAgentSession(storage.local, storage.commits, storage.sessions),
        new ArkAgentGatewayTransport(), storage.tasks, storage.local, clock, speech);
      this.controller.initialize();
    }
    return this.controller;
  }
  pause(): void { this.controller?.pause(); }
  destroy(): void { this.controller?.dispose(); this.controller = undefined; }
}
export const taskAgentSpeechOwner = new TaskAgentSpeechOwner();
