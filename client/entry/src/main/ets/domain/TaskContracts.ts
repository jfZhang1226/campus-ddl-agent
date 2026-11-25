import { ChecklistItem, Notice, Task } from './StorageModels';

/** Full editable replacement. Null is explicit; there is no implicit partial-patch behavior. */
export class TaskDraft {
  title: string = '';
  course: string | null = null;
  kind: string | null = null;
  deadlinePrecision: string = 'unknown';
  deadlineDate: string | null = null;
  dueAt: string | null = null;
  timezone: string = 'Asia/Shanghai';
  priority: string | null = null;
  status: string = 'todo';
  remainingMinutes: number | null = null;
  submissionChannel: string | null = null;
  noticeIds: string[] = [];
}

export class TaskQuery {
  keyword: string | null = null;
  course: string | null = null;
  statuses: string[] = [];
  dateFrom: string | null = null;
  dateTo: string | null = null;
  timezone: string = 'Asia/Shanghai';
  includeUndated: boolean = false;
}

export class TaskChecklistProgress {
  constructor(public taskId: string, public total: number = 0, public prepared: number = 0) {}
}
export class TaskList {
  tasks: Task[];
  revision: number;
  progress: TaskChecklistProgress[];
  constructor(tasks: Task[], revision: number, progress: TaskChecklistProgress[] = []) {
    this.tasks = tasks; this.revision = revision; this.progress = progress;
  }
}

export class TaskDetail {
  task: Task;
  notices: Notice[];
  checklistItems: ChecklistItem[];
  revision: number;
  constructor(task: Task, notices: Notice[], items: ChecklistItem[], revision: number) {
    this.task = task; this.notices = notices; this.checklistItems = items; this.revision = revision;
  }
}

/** revision is a storage snapshot version, not an operationId receipt. */
export class TaskWrite {
  task: Task;
  revision: number;
  changed: boolean;
  deleted: boolean;
  constructor(task: Task, revision: number, changed: boolean, deleted: boolean = false) {
    this.task = task; this.revision = revision; this.changed = changed; this.deleted = deleted;
  }
}

export interface TaskRuntime {
  now(): string;
  nextId(): string;
}

/** IDs are opaque local record IDs, not credentials or T16 operation IDs. Collisions are checked. */
export class LocalTaskRuntime implements TaskRuntime {
  now(): string { return new Date().toISOString(); }
  nextId(): string {
    return 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14) +
      '-' + Math.random().toString(36).slice(2, 14);
  }
}
