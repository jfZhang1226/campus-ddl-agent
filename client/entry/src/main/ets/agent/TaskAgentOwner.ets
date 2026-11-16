import { getClientStorage } from '../data/ClientStorage';
import { ArkAgentGatewayTransport } from '../adapters/ArkAgentGatewayTransport';
import { TaskAgentSession } from './TaskAgentSession';
import { TaskAgentController } from './TaskAgentController';
import common from '@ohos.app.ability.common';

class TaskAgentOwner {
  private controller: TaskAgentController | undefined;
  get(context: common.UIAbilityContext): TaskAgentController {
    if (this.controller === undefined) {
      const storage = getClientStorage(context.filesDir);
      this.controller = new TaskAgentController(new TaskAgentSession(storage.local, storage.commits, storage.sessions),
        new ArkAgentGatewayTransport(), storage.tasks, storage.local);
      this.controller.initialize();
    }
    return this.controller;
  }
  pause(): void { this.controller?.pause(); }
  destroy(): void { this.controller?.dispose(); this.controller = undefined; }
}
export const taskAgentOwner: TaskAgentOwner = new TaskAgentOwner();
