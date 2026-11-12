import { Message, SessionDocument } from '../domain/StorageModels';
import { SessionRepository } from '../data/SessionRepository';
import { SessionIndex } from '../data/SessionStore';
import { requireSessionJson } from '../data/storage/MessageCodec';
import { StorageFailure, StorageResult, storageError, storageSuccess } from '../data/storage/StorageTypes';
import { ChatHistoryPort, ChatHistorySnapshot, ChatMessage } from './ChatModels';

/** One instance per app chat owner. Failed writes latch until an explicit local-save retry/read. */
export class StoredChatHistory implements ChatHistoryPort {
  private current: SessionDocument | null = null;
  private tail: Promise<void> = Promise.resolve();
  private failure: StorageResult<ChatHistorySnapshot> | null = null;

  constructor(private repository: SessionRepository) {}

  private run<T>(work: () => Promise<T>): Promise<T> {
    const result: Promise<T> = this.tail.then(work);
    this.tail = result.then(() => {}, () => {});
    return result;
  }

  read(sessionId: string = ''): Promise<StorageResult<ChatHistorySnapshot>> {
    return this.run(async () => {
      try {
        let warning: string = '';
        let id: string = sessionId;
        if (id.length === 0) {
          const list: StorageResult<SessionIndex> = await this.repository.list();
          if (!list.success || list.data === null) return this.fail(list.errorCode, list.message);
          if (list.data.issues.length > 0) {
            warning = String(list.data.issues.length) + ' 个会话暂不可读，原文件已保留，请在历史页处理。';
            if (list.data.sessions.length === 0) return this.fail('RECOVERY_REQUIRED', warning);
          }
          if (list.data.sessions.length > 0) id = list.data.sessions[0].id;
        }
        if (id.length === 0) {
          this.current = null;
        } else {
          const record: StorageResult<SessionDocument> = await this.repository.get(id);
          if (!record.success || record.data === null) return this.fail(record.errorCode, record.message);
          this.current = record.data;
        }
        this.failure = null;
        const view: ChatHistorySnapshot = this.snapshot();
        view.warning = warning;
        return storageSuccess(view);
      } catch (error) { return this.remember(storageError<ChatHistorySnapshot>(error as Error)); }
    });
  }

  /** The controller must first guard pending writes and unsaved input before starting a new chat. */
  fresh(): void { this.current = null; this.failure = null; }

  save(messages: ChatMessage[], retry: boolean = false): Promise<StorageResult<ChatHistorySnapshot>> {
    let rows: ChatMessage[];
    try {
      requireSessionJson(messages);
      rows = JSON.parse(JSON.stringify(messages)) as ChatMessage[];
    } catch (error) { return Promise.resolve(storageError<ChatHistorySnapshot>(error as Error)); }
    return this.run(async () => {
      try {
        if (this.failure !== null && !retry) return this.failure;
        if (this.current === null) {
          const first: ChatMessage | undefined = rows.find((row: ChatMessage) => row.role === 'user');
          let title: string = first === undefined ? '新会话' : first.text.slice(0, 60);
          // Do not split a surrogate pair in the automatically generated list title.
          const last: number = title.charCodeAt(title.length - 1);
          if (last >= 0xD800 && last <= 0xDBFF) title = title.slice(0, -1);
          this.current = this.repository.newDocument(title.trim().length === 0 ? '新会话' : title);
        }
        const candidate: SessionDocument = JSON.parse(JSON.stringify(this.current)) as SessionDocument;
        if (rows.length < candidate.messages.length || candidate.messages.some((old: Message, index: number) =>
          rows[index].id !== old.id || rows[index].role !== old.role || rows[index].type !== old.type)) {
          throw new StorageFailure('INVALID_ARGUMENT', '历史消息不能在保存时丢失、改序或更换身份。');
        }
        candidate.messages = rows.map((row: ChatMessage, index: number) => this.record(row, index, candidate));
        const saved: StorageResult<SessionDocument> = await this.repository.save(candidate, candidate.revision);
        if (!saved.success || saved.data === null) return this.fail(saved.errorCode, saved.message);
        this.current = saved.data;
        this.failure = null;
        return storageSuccess(this.snapshot());
      } catch (error) { return this.remember(storageError<ChatHistorySnapshot>(error as Error)); }
    });
  }

  private record(row: ChatMessage, index: number, document: SessionDocument): Message {
    const old: Message | undefined = document.messages[index];
    if (old !== undefined && !['text', 'answer', 'clarification'].includes(old.type)) {
      return old; // Preserve tool data, display hints and unknown extension fields.
    }
    if (!['user', 'assistant', 'system'].includes(row.role) ||
      !['text', 'answer', 'clarification'].includes(row.type) || typeof row.text !== 'string') {
      throw new StorageFailure('INVALID_ARGUMENT', '新增聊天消息格式无效。');
    }
    const record: Message = old === undefined ? {
      id: row.id, sessionId: document.session.id, role: row.role, type: row.type, text: row.text,
      calls: [], results: [], toolName: null, toolResultSummary: null, status: 'pending',
      createdAt: this.repository.timestamp()
    } : old;
    record.text = row.text;
    record.status = row.phase === 'done' ? 'completed' : row.phase;
    return record;
  }

  private snapshot(): ChatHistorySnapshot {
    const view: ChatHistorySnapshot = new ChatHistorySnapshot();
    if (this.current === null) return view;
    view.sessionId = this.current.session.id;
    view.title = this.current.session.title;
    view.revision = this.current.revision;
    view.messages = this.current.messages.map((message: Message) => {
      let phase: string = message.status === 'completed' || message.status === 'done' ? 'done' : message.status;
      if (phase === 'pending') phase = 'interrupted'; // Display only; reading never mutates disk.
      const text: string = message.text === null ?
        (message.type === 'tool_calls' ? '工具调用记录（仅回看）' : '工具结果记录（仅回看）') : message.text;
      return new ChatMessage(message.id, message.role, text, phase, message.type);
    });
    return view;
  }

  private fail(code: string | null, message: string): StorageResult<ChatHistorySnapshot> {
    return this.remember(new StorageResult<ChatHistorySnapshot>(false, null, code === null ? 'STORAGE_FAILED' : code, message));
  }
  private remember(result: StorageResult<ChatHistorySnapshot>): StorageResult<ChatHistorySnapshot> {
    this.failure = result;
    return result;
  }
}
