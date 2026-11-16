import { getClientStorage } from '../data/ClientStorage';
import { ArkAgentGatewayTransport } from '../adapters/ArkAgentGatewayTransport';
import { TaskAgentSession } from './TaskAgentSession';
import { TaskAgentController } from './TaskAgentController';

class TaskAgentOwner {
  private controller: TaskAgentController | undefined;
  get(filesDir: string): TaskAgentController {
    if (this.controller === undefined) {
      const storage = getClientStorage(filesDir);
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
