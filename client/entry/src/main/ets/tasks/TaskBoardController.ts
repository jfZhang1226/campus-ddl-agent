import { Task } from '../domain/StorageModels';
import { TaskDetail, TaskList, TaskQuery, TaskChecklistProgress } from '../domain/TaskContracts';
import { taskIsComplete, taskCompletionLabel } from './TaskCompletion';
import { deadlineDay, timestampMillis, zonedDateTimeParts } from '../domain/DateRules';
import { StorageResult } from '../data/storage/StorageTypes';

export interface TaskReadPort {
  list(query: TaskQuery): Promise<StorageResult<TaskList>>;
  get(id: string): Promise<StorageResult<TaskDetail>>;
}
export class TaskBoardRow {
  constructor(public task: Task, public section: string, public deadlineText: string,
    public completionLabel: string = '', public totalItems: number = 0, public preparedItems: number = 0) {}
}
export class TaskBoardView {
  loading: boolean = false;
  rows: TaskBoardRow[] = [];
  detail: TaskDetail | null = null;
  detailDeadline: string = '';
  keyword: string = '';
  filter: string = 'active';
  total: number = 0;
  revision: number = 0;
  error: string = '';
  stale: boolean = false;
  today: string = '';
}
function deadlineText(task: Task): string {
  const exact = task.dueAt === null ? null : zonedDateTimeParts(task.dueAt, 'Asia/Shanghai');
  const day = deadlineDay(task.deadlinePrecision, task.deadlineDate, task.dueAt, 'Asia/Shanghai');
  return exact !== null ? exact.date + ' ' + exact.time + '（北京时间）' :
    day !== null ? day + '（具体时刻未知）' : '截止时间待补充';
}
/** Read the actual repository; this calendar of deadlines is not an allocated work plan. */
export class TaskBoardController {
  private view: TaskBoardView = new TaskBoardView();
  private tasks: Task[] = [];
  private progress: TaskChecklistProgress[] = [];
  private generation: number = 0;
  private disposed: boolean = false;
  private observer: ((view: TaskBoardView) => void) | undefined;
  constructor(private repository: TaskReadPort, private now: () => string = () => new Date().toISOString()) {}
  snapshot(): TaskBoardView { return JSON.parse(JSON.stringify(this.view)) as TaskBoardView; }
  subscribe(observer: (view: TaskBoardView) => void): void { this.observer = observer; this.publish(); }
  private publish(): void { if (!this.disposed) this.observer?.(this.snapshot()); }
  editKeyword(value: string): void { if (!this.disposed) { this.view.keyword = value.slice(0, 100); this.filterRows(); } }
  setFilter(value: string): void {
    if (this.disposed || !['active', 'all', 'completed', 'week', 'undated'].includes(value)) return;
    this.view.filter = value; this.filterRows();
  }
  private filterRows(): void {
    const now: string = this.now();
    const parts = zonedDateTimeParts(now, 'Asia/Shanghai');
    if (parts === null) { this.view.stale = true; this.view.error = '当前时间无效，请校正设备时钟后刷新。'; this.publish(); return; }
    const today: string = parts.date;
    const end = zonedDateTimeParts(new Date(timestampMillis(now) + 6 * 86400000).toISOString(), 'Asia/Shanghai');
    const keyword: string = this.view.keyword.trim().toLowerCase();
    this.view.today = today; this.view.total = this.tasks.length;
    this.view.rows = this.tasks.filter(task => {
      const complete: boolean = taskIsComplete(task, this.progress.find(item => item.taskId === task.id));
      const inactive: boolean = complete || task.status === 'cancelled';
      const day = deadlineDay(task.deadlinePrecision, task.deadlineDate, task.dueAt, 'Asia/Shanghai');
      if (keyword && !(task.title + '\n' + (task.course || '')).toLowerCase().includes(keyword)) return false;
      if (this.view.filter === 'active') return !inactive;
      if (this.view.filter === 'completed') return complete;
      if (this.view.filter === 'undated') return !inactive && day === null;
      if (this.view.filter === 'week') return !inactive && day !== null && day >= today && end !== null && day <= end.date;
      return true;
    }).map(task => {
      const day = deadlineDay(task.deadlinePrecision, task.deadlineDate, task.dueAt, 'Asia/Shanghai');
      const progress = this.progress.find(item => item.taskId === task.id);
      const complete: boolean = taskIsComplete(task, progress);
      const overdue: boolean = !complete && task.status !== 'cancelled' && (task.deadlinePrecision === 'exact' && task.dueAt !== null
        ? timestampMillis(task.dueAt) < timestampMillis(now) : day !== null && day < today);
      const section: string = task.status === 'cancelled' ? '已取消' : complete ? '已完成' : overdue ? '已逾期' : day === null ? '截止待补充' :
        day === today ? '今天到期' : end !== null && day <= end.date ? '未来七天' : '之后到期';
      return new TaskBoardRow(task, section, deadlineText(task), taskCompletionLabel(task, progress), progress?.total || 0, progress?.prepared || 0);
    }).sort((a, b) => {
      const sections: string[] = ['已逾期', '今天到期', '未来七天', '之后到期', '截止待补充', '已完成', '已取消'];
      const group: number = sections.indexOf(a.section) - sections.indexOf(b.section);
      if (group !== 0) return group;
      const key = (task: Task): string => deadlineDay(task.deadlinePrecision, task.deadlineDate, task.dueAt, 'Asia/Shanghai') || '9999-99-99';
      const dayCompare = key(a.task).localeCompare(key(b.task));
      if (dayCompare !== 0) return dayCompare;
      if (a.task.dueAt !== null && b.task.dueAt !== null) return timestampMillis(a.task.dueAt) - timestampMillis(b.task.dueAt) || a.task.id.localeCompare(b.task.id);
      return a.task.id.localeCompare(b.task.id);
    });
    this.publish();
  }
  async reload(): Promise<void> {
    if (this.disposed) return;
    const generation: number = ++this.generation;
    this.view.loading = true; this.view.error = ''; this.view.detail = null; this.publish();
    try {
      const result = await this.repository.list(new TaskQuery());
      if (this.disposed || generation !== this.generation) return;
      if (!result.success || result.data === null) { this.view.stale = true; this.view.error = result.message || '任务读取失败，请刷新重试。'; }
      else { this.tasks = result.data.tasks; this.progress = result.data.progress || []; this.view.revision = result.data.revision; this.view.stale = false; this.filterRows(); }
    } catch (_) { if (generation === this.generation) { this.view.stale = true; this.view.error = '任务读取失败，已有显示可能过期，请刷新。'; } }
    finally { if (!this.disposed && generation === this.generation) { this.view.loading = false; this.publish(); } }
  }
  async select(id: string): Promise<void> {
    if (this.disposed || this.view.loading || this.view.stale || !this.tasks.some(task => task.id === id)) return;
    const generation: number = ++this.generation;
    this.view.loading = true; this.view.error = ''; this.view.detail = null; this.publish();
    try {
      const result = await this.repository.get(id);
      if (this.disposed || generation !== this.generation) return;
      if (!result.success || result.data === null) this.view.error = result.message || '任务详情读取失败，请刷新。';
      else { this.view.detail = result.data; this.view.detailDeadline = deadlineText(result.data.task); }
    } catch (_) { if (generation === this.generation) this.view.error = '任务详情读取失败，请刷新重试。'; }
    finally { if (!this.disposed && generation === this.generation) { this.view.loading = false; this.publish(); } }
  }
  closeDetail(): void { if (!this.disposed) { ++this.generation; this.view.loading = false; this.view.detail = null; this.publish(); } }
  dispose(): void { this.disposed = true; ++this.generation; this.observer = undefined; }
}
