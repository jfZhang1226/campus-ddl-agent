import { BusinessSnapshot } from '../domain/StorageModels';
import { StorageCoordinator } from './storage/StorageCoordinator';
import { JsonSnapshotFile } from './storage/JsonSnapshotFile';
import { BusinessSnapshotCodec } from './storage/SnapshotCodecs';
import { requireJsonValue } from './storage/JsonValues';
import { StorageResult, storageError } from './storage/StorageTypes';

/** Internal persistence boundary; do not expose save directly as an Agent tool. */
export class LocalStore {
  private snapshot: JsonSnapshotFile<BusinessSnapshot>;
  private listeners: (() => void)[] = [];

  constructor(coordinator: StorageCoordinator) {
    this.snapshot = new JsonSnapshotFile(coordinator, new BusinessSnapshotCodec(), 'task-store');
  }

  read(): Promise<StorageResult<BusinessSnapshot>> {
    return this.snapshot.read();
  }
  /** Post-commit side effects cannot change the business receipt or delay the storage queue. */
  subscribeChanges(listener: () => void): () => void {
    this.listeners.push(listener);
    return (): void => { this.listeners = this.listeners.filter(item => item !== listener); };
  }
  private notify(): void {
    this.listeners.slice().forEach(listener => { try { Promise.resolve(listener()).catch(() => {}); } catch (_) {} });
  }

  save(candidate: BusinessSnapshot, expectedRevision: number): Promise<StorageResult<BusinessSnapshot>> {
    try {
      requireJsonValue(candidate);
      return this.snapshot.save(candidate, expectedRevision).then(result => {
        if (result.success) this.notify();
        return result;
      });
    } catch (error) {
      return Promise.resolve(storageError<BusinessSnapshot>(error as Error));
    }
  }

  recoverBackup(): Promise<StorageResult<BusinessSnapshot>> {
    return this.snapshot.recoverBackup().then(result => {
      if (result.success) this.notify();
      return result;
    });
  }
}
