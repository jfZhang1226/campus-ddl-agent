import { Message, Session, SessionDocument } from '../domain/StorageModels';
import { isOffsetTimestamp, timestampMillis } from '../domain/DateRules';
import { SessionIndex, SessionStore } from './SessionStore';
import { requireSessionJson } from './storage/MessageCodec';
import { SessionDocumentCodec } from './storage/SnapshotCodecs';
import { StorageFailure, StorageResult, isStorageId, storageError, storageSuccess } from './storage/StorageTypes';

export interface SessionRuntime {
  now(): string;
  nextId(): string;
}

export class LocalSessionRuntime implements SessionRuntime {
  now(): string { return new Date().toISOString(); }
  nextId(): string {
    return 'session-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14) +
      '-' + Math.random().toString(36).slice(2, 14);
  }
}

/** Local history only. This repository never sends messages or executes stored calls/proposals. */
export class SessionRepository {
  constructor(private store: SessionStore, private runtime: SessionRuntime = new LocalSessionRuntime()) {}

  timestamp(): string {
    const value: string = this.runtime.now();
    if (!isOffsetTimestamp(value)) throw new StorageFailure('INVALID_ARGUMENT', '本机时间无效，请检查后重试。');
    return value;
  }

  /** In-memory candidate, not a saved record. A colliding ID is rejected by compare-and-save. */
  newDocument(title: string = '新会话'): SessionDocument {
    const id: string = this.runtime.nextId();
    const now: string = this.timestamp();
    if (!isStorageId(id) || typeof title !== 'string' || title.trim().length === 0) {
      throw new StorageFailure('INVALID_ARGUMENT', '会话 ID 或标题无效。');
    }
    const session: Session = { id: id, title: title, createdAt: now, updatedAt: now, pendingProposalId: null };
    return new SessionDocument(session);
  }

  async list(): Promise<StorageResult<SessionIndex>> {
    const result: StorageResult<SessionIndex> = await this.store.list();
    if (result.success && result.data !== null) {
      result.data.sessions.sort((left: Session, right: Session) => {
        const time: number = timestampMillis(right.updatedAt) - timestampMillis(left.updatedAt);
        return time !== 0 ? time : (left.id < right.id ? -1 : (left.id === right.id ? 0 : 1));
      });
    }
    return result;
  }

  get(id: string): Promise<StorageResult<SessionDocument>> { return this.store.read(id); }

  /** Complete history candidate. Capture before awaiting; preserve stored metadata and extensions. */
  async save(document: SessionDocument, expectedRevision: number): Promise<StorageResult<SessionDocument>> {
    let request: SessionDocument;
    try {
      requireSessionJson(document);
      const captured: string = JSON.stringify(document);
      request = new SessionDocumentCodec(document.session).decode(captured);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || request.revision !== expectedRevision) {
        throw new StorageFailure('INVALID_ARGUMENT', '会话候选版本无效。');
      }
    } catch (_) {
      return new StorageResult<SessionDocument>(false, null, 'INVALID_ARGUMENT', '会话候选无效，未写入文件。');
    }
    try {
      const currentResult: StorageResult<SessionDocument> = await this.store.read(request.session.id);
      let current: SessionDocument | null = null;
      if (currentResult.success && currentResult.data !== null) {
        current = currentResult.data;
        if (current.revision !== expectedRevision) {
          throw new StorageFailure('VERSION_CONFLICT', '会话已变化，请保留输入并重新读取后确认。');
        }
        if (current.session.createdAt !== request.session.createdAt ||
          current.session.pendingProposalId !== request.session.pendingProposalId) {
          throw new StorageFailure('INVALID_ARGUMENT', '不能通过历史保存改写创建时间或待确认方案关联。');
        }
        if (JSON.stringify(current.messages) === JSON.stringify(request.messages) &&
          JSON.stringify(current.session) === JSON.stringify(request.session)) return storageSuccess(current);
      } else if (currentResult.errorCode !== 'NOT_FOUND' || expectedRevision !== 0) {
        return currentResult;
      }
      const now: string = this.timestamp();
      const previous: string = current === null ? request.session.createdAt : current.session.updatedAt;
      if (timestampMillis(now) < timestampMillis(previous)) {
        throw new StorageFailure('INVALID_ARGUMENT', '本机时间早于已保存的会话时间，请保留输入后重试。');
      }
      request.session.updatedAt = now;
      return await this.store.save(request, expectedRevision);
    } catch (error) {
      return storageError<SessionDocument>(error as Error);
    }
  }
}
