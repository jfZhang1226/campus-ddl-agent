import common from '@ohos.app.ability.common';
import { getClientStorage } from '../data/ClientStorage';
import { ReminderPort, UnavailableReminderPort } from './ReminderPlan';
import { ReminderService } from './ReminderService';
import { StorageFailure } from '../data/storage/StorageTypes';

export class ReminderOwner {
  private service: ReminderService | undefined;
  private detach: (() => void) | undefined;
  private running: boolean = false;
  private pending: boolean = false;
  private generation: number = 0;
  private factory: ((context: common.UIAbilityContext) => ReminderPort) | undefined;
  lastError: string = '';
  constructor(factory: ((context: common.UIAbilityContext) => ReminderPort) | undefined = undefined) { this.factory = factory; }
  get(context: common.UIAbilityContext): ReminderService {
    if (this.service === undefined) {
      const storage = getClientStorage(context.filesDir);
      this.service = new ReminderService(storage.tasks, storage.reminderSettings,
        this.factory === undefined ? new UnavailableReminderPort() : this.factory(context));
      this.detach = storage.local.subscribeChanges(() => { this.refresh(); });
      this.refresh();
    }
    return this.service;
  }
  refresh(): void {
    if (this.service === undefined) return;
    this.pending = true;
    if (!this.running) this.drain(this.service, this.generation);
  }
  private async drain(service: ReminderService, generation: number): Promise<void> {
    this.running = true;
    try {
      do {
        this.pending = false;
        await service.reconcile();
        if (generation !== this.generation) return;
        this.lastError = '';
      } while (this.pending);
    } catch (error) {
      if (generation === this.generation) this.lastError = error instanceof StorageFailure ? error.message : '提醒同步未完成，请进入任务详情重新核对。';
    } finally { if (generation === this.generation) this.running = false; }
  }
  destroy(): void {
    ++this.generation; this.detach?.(); this.detach = undefined;
    this.service = undefined; this.running = false; this.pending = false;
    // User-enabled OS reminders deliberately survive app destruction.
  }
}
export const reminderOwner = new ReminderOwner();
