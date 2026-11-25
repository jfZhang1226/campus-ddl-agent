import { ChecklistItem, Task } from './StorageModels';
import { TaskDraft } from './TaskContracts';
import { requireArgument } from './TaskValidation';

/** Formal task writes enforce readiness and protect terminal declarations. No platform submission is inferred. */
export function validateTaskTransition(before: Task | null, after: TaskDraft, materials: ChecklistItem[],
  confirmSubmission: boolean = false, hasMaterialChanges: boolean = false, appendOnly: boolean = false): void {
  if (before === null) {
    requireArgument(after.status === 'todo' || after.status === 'in_progress', '新任务请先记录为待办或进行中，再核对材料与完成状态。');
    requireArgument(!confirmSubmission, '不能在新建时跳过材料核对声明已提交。');
    return;
  }
  const reopening: boolean = before.status === 'done' && after.status === 'in_progress' && appendOnly &&
    hasMaterialChanges && after.remainingMinutes === null && !confirmSubmission;
  if (['submitted', 'done', 'cancelled'].includes(before.status) && !reopening) {
    requireArgument(after.status === before.status, '任务已进入终态，修改截止或要求不能抹去原有提交/完成/取消状态。');
  }
  if (before.status === 'cancelled' || (before.status === 'done' && !reopening)) requireArgument(!hasMaterialChanges, '已结束任务不能改写原事项；追加新事项需明确重新开始。');
  const hasRequirements: boolean = materials.length > 0 || after.submissionChannel !== null;
  const allPrepared: boolean = materials.every(item => item.state === 'prepared');
  if (after.status === 'ready' && (before.status !== 'ready' || materials.some(item => item.state !== 'prepared'))) {
    requireArgument(allPrepared, '仍有待准备材料，不能标记准备完成。');
  }
  if (after.status === 'submitted' && (before.status !== 'submitted' || confirmSubmission)) {
    requireArgument(before.status === 'ready' || before.status === 'submitted', '请先核对材料并标记准备完成，再明确确认已提交。');
    requireArgument(allPrepared, '仍有待准备材料，请先核对；用户标记不代表学校平台已收到。');
  }
  if (after.status === 'done' && before.status !== 'done') {
    requireArgument(!hasRequirements, '此任务有提交要求，请分别核对准备状态与用户确认提交，不能用工作完成替代已提交。');
  }
  requireArgument(!confirmSubmission || after.status === 'submitted', '提交确认标记只能用于已提交状态。');
}
