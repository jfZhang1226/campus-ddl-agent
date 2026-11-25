import { Task } from '../domain/StorageModels';
import { ReminderPlan, deadlineReminderPlan } from './ReminderPlan';
import { ReminderService } from './ReminderService';
import { ReminderSetting } from './ReminderSettings';
import { StorageFailure } from '../data/storage/StorageTypes';

export class TaskReminderView {
  supported: boolean = false;
  permission: boolean = false;
  busy: boolean = false;
  setting: ReminderSetting | null = null;
  preview: ReminderPlan | null = null;
  notice: string = '';
  errorCode: string = '';
  permissionAction: string = '允许本应用通知';
  permissionNotice: string = '';
}
/** Reminder preview and screen-only confirmation are separate from model/task confirmation. */
export class TaskReminderController {
  private view: TaskReminderView = new TaskReminderView();
  private task: Task | null = null;
  private generation: number = 0;
  private disposed: boolean = false;
  private observer: ((view: TaskReminderView) => void) | undefined;
  constructor(private service: ReminderService, private now: () => string = () => new Date().toISOString()) {
    this.view.supported = service.supported();
    this.view.permissionAction = service.permissionAction(); this.view.permissionNotice = service.permissionNotice();
  }
  snapshot(): TaskReminderView { return JSON.parse(JSON.stringify(this.view)) as TaskReminderView; }
  subscribe(observer: (view: TaskReminderView) => void): void { this.observer = observer; this.publish(); }
  private publish(): void { if (!this.disposed) this.observer?.(this.snapshot()); }
  select(task: Task | null): void {
    if (this.disposed) return;
    ++this.generation; this.task = task === null ? null : JSON.parse(JSON.stringify(task)) as Task;
    this.view = new TaskReminderView(); this.view.supported = this.service.supported();
    this.view.permissionAction = this.service.permissionAction(); this.view.permissionNotice = this.service.permissionNotice(); this.publish();
    if (task !== null) this.refresh();
  }
  private error(error: Error): void {
    this.view.errorCode = error instanceof StorageFailure ? error.code : 'REMINDER_UNCERTAIN';
    this.view.notice = error instanceof StorageFailure ? error.message : '提醒状态未核实，请重新读取；不要假定已设置成功。';
  }
  async refresh(): Promise<void> {
    if (this.disposed || this.view.busy || this.task === null || !this.view.supported) return;
    const generation: number = ++this.generation;
    const id: string = this.task.id;
    this.view.busy = true; this.view.preview = null; this.publish();
    try {
      const permission = await this.service.permission();
      if (generation !== this.generation || this.disposed) return;
      this.view.permission = permission;
      const settings = await this.service.reconcile();
      if (generation !== this.generation || this.disposed) return;
      this.view.setting = settings.find(entry => entry.taskId === id) || null;
      this.view.permission = permission; this.view.errorCode = ''; this.view.notice = '';
    } catch (error) { if (generation === this.generation) { this.view.setting = null; this.error(error as Error); } }
    finally { if (generation === this.generation) { this.view.busy = false; this.publish(); } }
  }
  async requestPermission(): Promise<void> {
    if (this.disposed || this.view.busy || !this.view.supported) return;
    const generation: number = ++this.generation;
    this.view.busy = true; this.publish();
    try {
      const allowed = await this.service.requestPermission();
      if (generation === this.generation) { this.view.permission = allowed; this.view.notice = allowed ? '提醒所需权限已允许，请核对提醒计划后再启用。' : '未允许提醒所需权限，任务查看与保存仍可用。'; }
    } catch (error) { if (generation === this.generation) this.error(error as Error); }
    finally { if (generation === this.generation) { this.view.busy = false; this.publish(); } }
  }
  prepare(leadMinutes: number): void {
    if (this.disposed || this.view.busy || this.task === null || !this.view.supported) return;
    this.view.preview = null;
    try {
      if (!this.view.permission) throw new StorageFailure('NOTIFICATION_PERMISSION_REQUIRED', '请先允许提醒所需权限，再核对并启用。');
      this.view.preview = deadlineReminderPlan(this.task, leadMinutes, this.now()); this.view.errorCode = ''; this.view.notice = '';
    } catch (error) { this.error(error as Error); }
    this.publish();
  }
  cancelPreview(): void { if (!this.disposed && !this.view.busy) { this.view.preview = null; this.publish(); } }
  async confirm(): Promise<void> {
    if (this.disposed || this.view.busy || this.view.preview === null) return;
    const generation: number = ++this.generation;
    const plan = this.view.preview;
    this.view.busy = true; this.publish();
    try {
      const setting = await this.service.enable(plan.taskId, plan.taskVersion, plan.leadMinutes);
      if (generation === this.generation) {
        this.view.setting = setting; this.view.preview = null; this.view.errorCode = '';
        this.view.notice = '已在系统登记并读回提醒；实际送达受系统设置影响，尚未据此验证。';
      }
    } catch (error) { if (generation === this.generation) { this.view.setting = null; this.view.preview = null; this.error(error as Error); } }
    finally { if (generation === this.generation) { this.view.busy = false; this.publish(); } }
  }
  async disable(): Promise<void> {
    if (this.disposed || this.view.busy || this.task === null) return;
    const generation: number = ++this.generation;
    const id: string = this.task.id;
    this.view.busy = true; this.view.preview = null; this.publish();
    try {
      const setting = await this.service.disable(id);
      if (generation === this.generation) { this.view.setting = setting; this.view.notice = '已核对系统中的本任务提醒已取消。'; this.view.errorCode = ''; }
    } catch (error) { if (generation === this.generation) { this.view.setting = null; this.error(error as Error); } }
    finally { if (generation === this.generation) { this.view.busy = false; this.publish(); } }
  }
  dispose(): void { this.disposed = true; ++this.generation; this.observer = undefined; }
}
