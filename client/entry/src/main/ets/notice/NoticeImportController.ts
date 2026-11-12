import { GatewayConfig, GatewayResponse } from '../chat/ChatModels';
import { validateConfig } from '../chat/GatewayProtocol';
import { NoticeImportInput, NoticeImportWrite } from '../data/NoticeImportRepository';
import { StorageResult } from '../data/storage/StorageTypes';
import {
  ZonedDateTimeParts, isCalendarDate, isOffsetTimestamp, isTaskTimezone, zonedDateTimeParts, zonedTimestamp
} from '../domain/DateRules';
import { NoticeDraft, NoticeDraftChecklistItem, cloneNoticeDraft } from './NoticeDraftModels';
import {
  NoticeExtractionCall, NoticeExtractionRequest, NoticeExtractionResult, NoticeExtractionTransport,
  decodeNoticeExtraction, noticeErrorText
} from './NoticeImportProtocol';

export interface NoticeImportWriter {
  create(input: NoticeImportInput, expectedRevision: number): Promise<StorageResult<NoticeImportWrite>>;
  revision(): Promise<StorageResult<number>>;
}

export class NoticeImportState {
  phase: string = 'idle';
  rawText: string = '';
  sourceLabel: string = '';
  publishedAt: string = '';
  timezone: string = 'Asia/Shanghai';
  draft: NoticeDraft | null = null;
  title: string = '';
  course: string = '';
  kind: string = '';
  deadlinePrecision: string = 'unknown';
  deadlineDate: string = '';
  deadlineTime: string = '';
  originalDueAt: string = '';
  priority: string = '';
  remainingMinutes: string = '';
  submissionChannel: string = '';
  materials: string[] = [];
  missingFields: string[] = [];
  questions: string[] = [];
  expectedRevision: number = 0;
  configured: boolean = false;
  errorCode: string = '';
  notice: string = '';
  requestId: string = '';
  savedTaskId: string = '';
  savedRevision: number = -1;
}

export class NoticeImportController {
  private state: NoticeImportState = new NoticeImportState();
  private config: GatewayConfig = new GatewayConfig();
  private transport: NoticeExtractionTransport;
  private writer: NoticeImportWriter;
  private listener: ((state: NoticeImportState) => void) | undefined;
  private active: NoticeExtractionCall | undefined;
  private generation: number = 0;

  constructor(transport: NoticeExtractionTransport, writer: NoticeImportWriter) {
    this.transport = transport;
    this.writer = writer;
  }

  snapshot(): NoticeImportState {
    const copy = new NoticeImportState();
    copy.phase = this.state.phase;
    copy.rawText = this.state.rawText;
    copy.sourceLabel = this.state.sourceLabel;
    copy.publishedAt = this.state.publishedAt;
    copy.timezone = this.state.timezone;
    copy.draft = this.state.draft === null ? null : cloneNoticeDraft(this.state.draft);
    copy.title = this.state.title;
    copy.course = this.state.course;
    copy.kind = this.state.kind;
    copy.deadlinePrecision = this.state.deadlinePrecision;
    copy.deadlineDate = this.state.deadlineDate;
    copy.deadlineTime = this.state.deadlineTime;
    copy.originalDueAt = this.state.originalDueAt;
    copy.priority = this.state.priority;
    copy.remainingMinutes = this.state.remainingMinutes;
    copy.submissionChannel = this.state.submissionChannel;
    copy.materials = this.state.materials.slice();
    copy.missingFields = this.state.missingFields.slice();
    copy.questions = this.state.questions.slice();
    copy.expectedRevision = this.state.expectedRevision;
    copy.configured = this.state.configured;
    copy.errorCode = this.state.errorCode;
    copy.notice = this.state.notice;
    copy.requestId = this.state.requestId;
    copy.savedTaskId = this.state.savedTaskId;
    copy.savedRevision = this.state.savedRevision;
    return copy;
  }

  subscribe(listener: (state: NoticeImportState) => void): void {
    this.listener = listener;
    this.publish();
  }

  unsubscribe(): void {
    this.listener = undefined;
  }

  configure(config: GatewayConfig): boolean {
    if (this.busy()) return false;
    const error: string = validateConfig(config);
    if (error.length > 0) {
      this.fail(error);
      return false;
    }
    this.config = new GatewayConfig(config.baseUrl.trim().replace(/\/+$/, ''), config.token, config.timeoutMs);
    this.state.configured = true;
    this.publish();
    return true;
  }

  setExpectedRevision(revision: number): void {
    if (Number.isSafeInteger(revision) && revision >= 0) {
      this.state.expectedRevision = revision;
      this.publish();
    }
  }

  setRawText(value: string): void {
    if (this.busy() || value === this.state.rawText) return;
    this.state.rawText = value;
    this.clearDraft(false);
    this.state.phase = 'idle';
    this.state.notice = '';
    this.publish();
  }

  setSourceLabel(value: string): void {
    if (this.busy()) return;
    this.state.sourceLabel = value;
    this.publish();
  }

  setPublishedAt(value: string): void {
    if (this.busy()) return;
    this.state.publishedAt = value;
    this.publish();
  }

  edit(field: string, value: string): void {
    if (this.busy() || this.state.phase === 'saved' || this.state.draft === null) return;
    switch (field) {
      case 'title': this.state.title = value; break;
      case 'course': this.state.course = value; break;
      case 'kind': this.state.kind = value; break;
      case 'precision':
        this.state.deadlinePrecision = value;
        this.state.originalDueAt = '';
        break;
      case 'date':
        this.state.deadlineDate = value;
        this.state.originalDueAt = '';
        break;
      case 'time':
        this.state.deadlineTime = value;
        this.state.originalDueAt = '';
        break;
      case 'priority': this.state.priority = value; break;
      case 'remaining': this.state.remainingMinutes = value; break;
      case 'channel': this.state.submissionChannel = value; break;
      default: return;
    }
    this.state.errorCode = '';
    this.state.notice = '';
    this.publish();
  }

  setMaterial(index: number, value: string): void {
    if (this.busy() || index < 0 || index >= this.state.materials.length) return;
    this.state.materials[index] = value;
    this.publish();
  }

  addMaterial(): void {
    if (this.busy() || this.state.draft === null || this.state.phase === 'saved') return;
    this.state.materials.push('');
    this.publish();
  }

  removeMaterial(index: number): void {
    if (this.busy() || index < 0 || index >= this.state.materials.length) return;
    this.state.materials.splice(index, 1);
    this.publish();
  }

  extract(): void {
    if (this.busy()) return;
    const raw: string = this.state.rawText;
    if (raw.trim().length === 0 || raw.length > 10000) {
      this.fail('INVALID_RAW_TEXT');
      return;
    }
    const configError: string = validateConfig(this.config);
    if (configError.length > 0) {
      this.fail(configError);
      return;
    }
    this.state.phase = 'extracting';
    this.state.errorCode = '';
    this.state.notice = '正在理解通知并整理可编辑草案…';
    this.state.requestId = '';
    this.state.savedTaskId = '';
    this.state.savedRevision = -1;
    const generation: number = ++this.generation;
    this.publish();
    const request = new NoticeExtractionRequest();
    request.rawText = raw;
    request.sourceLabel = this.nullable(this.state.sourceLabel);
    request.publishedAt = this.nullable(this.state.publishedAt);
    request.timezone = this.state.timezone;
    try {
      const call: NoticeExtractionCall = this.transport.start(this.config, request);
      this.active = call;
      call.result.then((response: GatewayResponse) => {
        if (generation !== this.generation) return;
        this.finishExtraction(decodeNoticeExtraction(response));
      }).catch((error: Error) => {
        if (generation !== this.generation) return;
        const result = new NoticeExtractionResult();
        result.errorCode = error.message === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK';
        this.finishExtraction(result);
      });
    } catch (error) {
      const result = new NoticeExtractionResult();
      result.errorCode = 'NETWORK';
      this.finishExtraction(result);
    }
  }

  async confirm(): Promise<void> {
    if (this.busy() || this.state.phase === 'saved' || this.state.draft === null) return;
    const draft: NoticeDraft = this.editableDraft();
    const validation: string = this.validateDraft(draft);
    if (validation.length > 0) {
      this.fail(validation);
      return;
    }
    this.state.phase = 'saving';
    this.state.errorCode = '';
    this.state.notice = '正在保存已确认的通知与任务…';
    const generation: number = ++this.generation;
    this.publish();
    const input = new NoticeImportInput();
    input.draft = draft;
    input.expectedRevision = this.state.expectedRevision;
    let result: StorageResult<NoticeImportWrite>;
    try {
      result = await this.writer.create(input, this.state.expectedRevision);
    } catch (error) {
      if (generation !== this.generation) return;
      this.state.phase = 'idle';
      this.state.errorCode = 'STORAGE_FAILED';
      this.state.notice = noticeErrorText('STORAGE_FAILED');
      this.publish();
      return;
    }
    if (generation !== this.generation) return;
    if (!result.success || result.data === null) {
      this.state.phase = 'idle';
      this.state.errorCode = result.errorCode === null ? 'STORAGE_FAILED' : result.errorCode;
      this.state.notice = noticeErrorText(this.state.errorCode);
      this.publish();
      return;
    }
    this.state.phase = 'saved';
    this.state.savedTaskId = result.data.task.id;
    this.state.savedRevision = result.data.revision;
    this.state.errorCode = '';
    this.state.notice = '已确认保存：通知来源、任务和材料清单已写入本地数据。';
    this.publish();
  }

  /** Re-read storage without discarding the editable draft, then require a fresh user confirmation. */
  async refreshRevision(): Promise<void> {
    if (this.busy() || this.state.draft === null) return;
    this.state.phase = 'refreshing';
    this.state.errorCode = '';
    this.state.notice = '正在重新读取本地数据版本…';
    const generation: number = ++this.generation;
    this.publish();
    const result: StorageResult<number> = await this.writer.revision();
    if (generation !== this.generation) return;
    this.state.phase = 'idle';
    if (!result.success || result.data === null) {
      this.state.errorCode = result.errorCode === null ? 'STORAGE_FAILED' : result.errorCode;
      this.state.notice = noticeErrorText(this.state.errorCode);
      this.publish();
      return;
    }
    this.state.expectedRevision = result.data;
    this.state.errorCode = '';
    this.state.notice = '已重新读取本地版本 ' + String(result.data) + '；草案和修改均已保留，请再次确认保存。';
    this.publish();
  }

  cancel(): void {
    if (this.state.phase === 'saving') return;
    this.release('CANCELLED');
    this.clearDraft(false);
    this.state.phase = 'cancelled';
    this.state.notice = '已取消整理；通知原文保留，没有新增任务。';
    this.state.errorCode = '';
    this.publish();
  }

  pause(): void {
    if (this.state.phase !== 'extracting') return;
    this.release('BACKGROUND');
    this.state.phase = 'idle';
    this.state.errorCode = 'BACKGROUND';
    this.state.notice = noticeErrorText('BACKGROUND');
    this.publish();
  }

  dispose(): void {
    this.release('');
    this.unsubscribe();
    this.listener = undefined;
  }

  private finishExtraction(result: NoticeExtractionResult): void {
    this.release('');
    this.state.requestId = result.requestId;
    if (result.errorCode.length > 0 || result.draft === null) {
      this.state.phase = 'idle';
      this.state.errorCode = result.errorCode.length > 0 ? result.errorCode : 'INVALID_RESPONSE';
      this.state.notice = noticeErrorText(this.state.errorCode);
      this.publish();
      return;
    }
    this.state.draft = result.draft;
    this.state.title = result.draft.task.title;
    this.state.course = result.draft.task.course === null ? '' : result.draft.task.course;
    this.state.kind = result.draft.task.kind === null ? '' : result.draft.task.kind;
    this.state.deadlinePrecision = result.draft.task.deadlinePrecision;
    this.state.timezone = result.draft.task.timezone;
    this.state.deadlineDate = '';
    this.state.deadlineTime = '';
    this.state.originalDueAt = result.draft.task.dueAt === null ? '' : result.draft.task.dueAt;
    if (result.draft.task.deadlinePrecision === 'date_only' && result.draft.task.deadlineDate !== null) {
      this.state.deadlineDate = result.draft.task.deadlineDate;
    } else if (result.draft.task.deadlinePrecision === 'exact' && result.draft.task.dueAt !== null) {
      const parts: ZonedDateTimeParts | null = zonedDateTimeParts(
        result.draft.task.dueAt, result.draft.task.timezone);
      if (parts === null) {
        this.state.deadlinePrecision = 'unknown';
        this.state.originalDueAt = '';
      } else {
        this.state.deadlineDate = parts.date;
        this.state.deadlineTime = parts.time;
      }
    }
    this.state.priority = result.draft.task.priority === null ? '' : result.draft.task.priority;
    this.state.remainingMinutes = result.draft.task.remainingMinutes === null ?
      '' : String(result.draft.task.remainingMinutes);
    this.state.submissionChannel = result.draft.task.submissionChannel === null ?
      '' : result.draft.task.submissionChannel;
    this.state.materials = result.draft.checklistItems.map((item: NoticeDraftChecklistItem) => item.label);
    this.state.missingFields = result.draft.missingFields.slice();
    this.state.questions = result.draft.clarification.map((item) => item.question);
    this.state.sourceLabel = result.draft.notice.sourceLabel === null ? '' : result.draft.notice.sourceLabel;
    this.state.publishedAt = result.draft.notice.publishedAt === null ? '' : result.draft.notice.publishedAt;
    this.state.phase = 'idle';
    this.state.errorCode = '';
    this.state.notice = result.degraded ?
      '模型输出无法解析，已转人工录入草案；确认前不会保存。' :
      '已生成可编辑草案；确认前不会新增任务。';
    this.publish();
  }

  private editableDraft(): NoticeDraft {
    const draft: NoticeDraft = this.state.draft === null ? new NoticeDraft() : cloneNoticeDraft(this.state.draft);
    draft.notice.rawText = this.state.rawText;
    draft.notice.sourceLabel = this.nullable(this.state.sourceLabel);
    draft.notice.publishedAt = this.nullable(this.state.publishedAt);
    draft.notice.timezone = this.state.timezone;
    draft.task.title = this.state.title;
    draft.task.course = this.nullable(this.state.course);
    draft.task.kind = this.nullable(this.state.kind);
    draft.task.deadlinePrecision = this.state.deadlinePrecision;
    draft.task.deadlineDate = this.state.deadlinePrecision === 'date_only' ? this.state.deadlineDate : null;
    draft.task.dueAt = this.state.deadlinePrecision === 'exact' ? this.dueAt() : null;
    draft.task.timezone = this.state.timezone;
    draft.task.priority = this.nullable(this.state.priority);
    draft.task.remainingMinutes = this.remainingMinutes();
    draft.task.submissionChannel = this.nullable(this.state.submissionChannel);
    draft.checklistItems = this.state.materials.filter((label: string) => label.trim().length > 0)
      .map((label: string) => {
        const item = new NoticeDraftChecklistItem();
        item.label = label.trim();
        item.state = 'pending';
        return item;
      });
    draft.missingFields = [];
    draft.clarification = [];
    return draft;
  }

  private validateDraft(draft: NoticeDraft): string {
    if (draft.task.title.trim().length === 0 || draft.task.title.length > 300) return 'EMPTY_TITLE';
    if (draft.notice.publishedAt !== null && !isOffsetTimestamp(draft.notice.publishedAt)) return 'INVALID_SOURCE';
    if (!isTaskTimezone(draft.notice.timezone) || !isTaskTimezone(draft.task.timezone)) return 'INVALID_SOURCE';
    if (draft.task.kind !== null && !['assignment', 'report', 'registration', 'other'].includes(draft.task.kind)) {
      return 'INVALID_KIND';
    }
    if (draft.task.priority !== null && !['low', 'normal', 'high'].includes(draft.task.priority)) {
      return 'INVALID_PRIORITY';
    }
    if (!(draft.task.remainingMinutes === null ||
      (Number.isSafeInteger(draft.task.remainingMinutes) && draft.task.remainingMinutes >= 0))) {
      return 'INVALID_REMAINING';
    }
    if (draft.task.deadlinePrecision === 'unknown') {
      if (draft.task.deadlineDate !== null || draft.task.dueAt !== null) return 'INVALID_DEADLINE';
      return '';
    }
    if (draft.task.deadlinePrecision === 'date_only') {
      if (!isCalendarDate(draft.task.deadlineDate as string) || draft.task.dueAt !== null) return 'INVALID_DEADLINE';
      return '';
    }
    if (draft.task.deadlinePrecision !== 'exact' || draft.task.deadlineDate !== null ||
      draft.task.dueAt === null || !isOffsetTimestamp(draft.task.dueAt)) {
      return 'INVALID_DEADLINE';
    }
    return '';
  }

  private dueAt(): string | null {
    if (this.state.originalDueAt.length > 0) return this.state.originalDueAt;
    return zonedTimestamp(this.state.deadlineDate, this.state.deadlineTime, this.state.timezone);
  }

  private remainingMinutes(): number | null {
    const source: string = this.state.remainingMinutes.trim();
    if (source.length === 0) return null;
    if (!/^(0|[1-9]\d*)$/.test(source)) return -1;
    const value: number = Number(source);
    return Number.isSafeInteger(value) ? value : -1;
  }

  private nullable(value: string): string | null {
    const trimmed: string = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private busy(): boolean {
    return this.state.phase === 'extracting' || this.state.phase === 'saving' ||
      this.state.phase === 'refreshing';
  }

  private clearDraft(clearRawText: boolean): void {
    this.state.draft = null;
    this.state.title = '';
    this.state.course = '';
    this.state.kind = '';
    this.state.deadlinePrecision = 'unknown';
    this.state.deadlineDate = '';
    this.state.deadlineTime = '';
    this.state.originalDueAt = '';
    this.state.priority = '';
    this.state.remainingMinutes = '';
    this.state.submissionChannel = '';
    this.state.materials = [];
    this.state.missingFields = [];
    this.state.questions = [];
    this.state.savedTaskId = '';
    this.state.savedRevision = -1;
    if (clearRawText) this.state.rawText = '';
  }

  private release(code: string): void {
    ++this.generation;
    const call: NoticeExtractionCall | undefined = this.active;
    this.active = undefined;
    if (call !== undefined) call.cancel();
    if (code.length > 0) {
      this.state.errorCode = code;
      this.state.notice = noticeErrorText(code);
    }
  }

  private fail(code: string): void {
    this.state.errorCode = code;
    this.state.notice = noticeErrorText(code);
    this.state.requestId = '';
    this.state.phase = 'idle';
    this.publish();
  }

  private publish(): void {
    if (this.listener !== undefined) this.listener(this.snapshot());
  }
}
