import { Session, SessionDocument } from '../domain/StorageModels';
import { StorageCoordinator } from './storage/StorageCoordinator';
import { JsonSnapshotFile } from './storage/JsonSnapshotFile';
import { SessionDocumentCodec } from './storage/SnapshotCodecs';
import { requireSessionJson } from './storage/MessageCodec';
import { StorageFailure, StorageResult, isStorageId, storageError, storageSuccess } from './storage/StorageTypes';

export class SessionIssue {
  sessionId: string;
  errorCode: string;

  constructor(sessionId: string, errorCode: string) {
    this.sessionId = sessionId;
    this.errorCode = errorCode;
  }
}

export class SessionIndex {
  sessions: Session[] = [];
  issues: SessionIssue[] = [];
}

/** Each session has an independent snapshot; listing reports individual damaged files. */
export class SessionStore {
  private coordinator: StorageCoordinator;

  constructor(coordinator: StorageCoordinator) {
    this.coordinator = coordinator;
  }

  private record(id: string): JsonSnapshotFile<SessionDocument> {
    if (!isStorageId(id)) {
      throw new StorageFailure('INVALID_ARGUMENT', '会话 ID 无效。');
    }
    const empty: Session = { id: id, title: '', createdAt: '1970-01-01T00:00:00Z',
      updatedAt: '1970-01-01T00:00:00Z', pendingProposalId: null };
    return new JsonSnapshotFile(this.coordinator, new SessionDocumentCodec(empty), id, 'sessions');
  }

  async read(id: string): Promise<StorageResult<SessionDocument>> {
    try {
      return await this.record(id).read(true);
    } catch (error) {
      return storageError<SessionDocument>(error as Error);
    }
  }

  async save(document: SessionDocument, expectedRevision: number): Promise<StorageResult<SessionDocument>> {
    try {
      requireSessionJson(document);
      return await this.record(document.session.id).save(document, expectedRevision);
    } catch (error) {
      return storageError<SessionDocument>(error as Error);
    }
  }

  async recoverBackup(id: string): Promise<StorageResult<SessionDocument>> {
    try {
      return await this.record(id).recoverBackup();
    } catch (error) {
      return storageError<SessionDocument>(error as Error);
    }
  }

  async list(): Promise<StorageResult<SessionIndex>> {
    try {
      const names: string[] = await this.coordinator.run(async () => {
        await this.coordinator.files.ensureDirectory('sessions');
        return this.coordinator.files.listNames('sessions');
      });
      // Include backup/tmp-only records, so a missing primary is not silently hidden.
      const ids: string[] = [];
      for (const name of names) {
        const id: string = name.split('.')[0];
        if (name.endsWith('.json') && isStorageId(id) && !ids.includes(id)) {
          ids.push(id);
        }
      }
      const index: SessionIndex = new SessionIndex();
      for (const id of ids) {
        const result: StorageResult<SessionDocument> = await this.read(id);
        if (result.success && result.data !== null) {
          index.sessions.push(result.data.session);
        } else {
          index.issues.push(new SessionIssue(id, result.errorCode === null ? 'STORAGE_FAILED' : result.errorCode));
        }
      }
      index.sessions.sort((left: Session, right: Session) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      return storageSuccess(index);
    } catch (error) {
      return storageError<SessionIndex>(error as Error);
    }
  }
}
