import { FilePort } from '../../adapters/storage/FilePort';
import { Task } from '../../domain/StorageModels';
import { TaskDraft, TaskList, TaskQuery, TaskWrite } from '../../domain/TaskContracts';
import { TaskRepository } from '../TaskRepository';
import { LocalStore } from '../LocalStore';
import { StorageCoordinator } from '../storage/StorageCoordinator';
import { StorageFailure, StorageResult } from '../storage/StorageTypes';
import { MissingPathPort } from './FailureProbe';

export class TaskProbeReport {
  revision: number = 0;
  tasks: Task[] = [];
  deletedId: string = '';
  checks: string[] = [];
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new StorageFailure('CHECK_FAILED', message);
}

function result<T>(response: StorageResult<T>): T {
  if (!response.success || response.data === null) throw new StorageFailure(response.errorCode === null ?
    'CHECK_FAILED' : response.errorCode, response.message);
  return response.data;
}

/** Fresh synthetic directory only. No production data, network or model call. */
export async function writeTaskProbe(files: FilePort): Promise<TaskProbeReport> {
  const port: MissingPathPort = new MissingPathPort(files);
  const repository: TaskRepository = new TaskRepository(new LocalStore(new StorageCoordinator(port)));
  const report: TaskProbeReport = new TaskProbeReport();
  check(result(await repository.list()).revision === 0, '验证目录必须为空。');
  const unknown: TaskDraft = new TaskDraft();
  unknown.title = 'T14 中文任务 🗓️';
  const first: TaskWrite = result(await repository.create(unknown, 0));
  const day: TaskDraft = new TaskDraft();
  day.title = 'T14 仅日期任务'; day.deadlinePrecision = 'date_only'; day.deadlineDate = '2028-02-29';
  const second: TaskWrite = result(await repository.create(day, 1));
  const exact: TaskDraft = new TaskDraft();
  exact.title = 'T14 精确时刻任务'; exact.deadlinePrecision = 'exact'; exact.dueAt = '2028-02-28T16:30:00Z';
  result(await repository.create(exact, 2));
  report.checks.push('创建三种日期任务，null 保持');
  const beforeInvalid: string = await files.readText('task-store.json');
  day.deadlineDate = '2027-02-29';
  check((await repository.create(day, 3)).errorCode === 'INVALID_ARGUMENT' &&
    await files.readText('task-store.json') === beforeInvalid, '非法日期被写入。');
  report.checks.push('非法日期零提交，正式字节保持');
  unknown.remainingMinutes = 0;
  const edited: TaskWrite = result(await repository.update(first.task.id, unknown, 3, 1));
  check(edited.revision === 4 && edited.task.version === 2 && edited.task.remainingMinutes === 0 &&
    edited.task.createdAt === first.task.createdAt, '任务编辑版本或空值错误。');
  const unchanged: TaskWrite = result(await repository.update(first.task.id, unknown, 4, 2));
  check(!unchanged.changed && unchanged.revision === 4 && unchanged.task.version === 2, '无变化编辑触发额外写入。');
  const attempts: StorageResult<TaskWrite>[] = await Promise.all([
    repository.update(first.task.id, exact, 4, 2), repository.update(first.task.id, exact, 4, 2)
  ]);
  check(attempts.filter((entry: StorageResult<TaskWrite>) => entry.success).length === 1 &&
    attempts.filter((entry: StorageResult<TaskWrite>) => entry.errorCode === 'VERSION_CONFLICT').length === 1,
    '并发旧版本未阻止覆盖。');
  report.checks.push('编辑与无变化结果、并发版本冲突');
  const beforeFailure: string = await files.readText('task-store.json');
  port.arm('replace', 'task-store.json');
  const failed: StorageResult<TaskWrite> = await repository.update(first.task.id, unknown, 5, 3);
  check(port.triggered && failed.errorCode === 'STORAGE_FAILED' && failed.data === null &&
    await files.readText('task-store.json') === beforeFailure, '替换失败未保留正式数据。');
  result(await repository.update(first.task.id, unknown, 5, 3));
  report.checks.push('受控真实文件 API 替换失败保护与人工重试');
  const query: TaskQuery = new TaskQuery();
  query.dateFrom = '2028-02-29'; query.dateTo = '2028-02-29';
  check(result(await repository.list(query)).tasks.length === 2, '仅日期或跨日偏移查询错误。');
  const deleted: TaskWrite = result(await repository.delete(second.task.id, 6, 1));
  check(deleted.deleted && deleted.revision === 7 && (await repository.get(second.task.id)).errorCode === 'NOT_FOUND',
    '删除未落盘。');
  const final: TaskList = result(await repository.list());
  report.tasks = final.tasks; report.revision = final.revision; report.deletedId = second.task.id;
  report.checks.push('日期范围查询与删除后 NOT_FOUND');
  await files.writeText('task-probe.json', JSON.stringify(report));
  return report;
}

export async function readTaskProbe(files: FilePort): Promise<TaskProbeReport> {
  const report: TaskProbeReport = JSON.parse(await files.readText('task-probe.json')) as TaskProbeReport;
  const repository: TaskRepository = new TaskRepository(new LocalStore(new StorageCoordinator(files)));
  const actual: TaskList = result(await repository.list());
  check(actual.revision === report.revision && JSON.stringify(actual.tasks) === JSON.stringify(report.tasks) &&
    (await repository.get(report.deletedId)).errorCode === 'NOT_FOUND', '冷启动读取内容或删除结果不一致。');
  report.checks = report.checks.concat(['新 Repository 读取结果与已保存样例一致，删除记录未恢复']);
  return report;
}
