import { ChecklistItem, Task } from '../domain/StorageModels';
import { TaskChecklistProgress } from '../domain/TaskContracts';

export function checklistProgress(taskId: string, items: ChecklistItem[]): TaskChecklistProgress {
  const own = items.filter(item => item.taskId === taskId);
  return new TaskChecklistProgress(taskId, own.length, own.filter(item => item.state === 'prepared').length);
}
/** Current checklist completion is a read-only projection, never a platform-submission declaration. */
export function taskIsComplete(task: Task, progress?: TaskChecklistProgress): boolean {
  if (task.status === 'cancelled') return false;
  if (progress !== undefined && progress.total > 0) return progress.prepared === progress.total;
  return task.status === 'done' || task.status === 'submitted';
}
export function taskCompletionLabel(task: Task, progress?: TaskChecklistProgress): string {
  if (task.status === 'cancelled') return '已取消';
  if (taskIsComplete(task, progress)) return '已完成';
  return task.status === 'in_progress' ? '进行中' : '待办';
}
