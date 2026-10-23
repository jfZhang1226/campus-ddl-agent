import { BusinessSnapshot } from '../domain/StorageModels';
import { StorageCoordinator } from './storage/StorageCoordinator';
import { JsonSnapshotFile } from './storage/JsonSnapshotFile';
import { BusinessSnapshotCodec } from './storage/SnapshotCodecs';
import { StorageResult } from './storage/StorageTypes';

/** Internal persistence boundary; do not expose save directly as an Agent tool. */
export class LocalStore {
  private snapshot: JsonSnapshotFile<BusinessSnapshot>;

  constructor(coordinator: StorageCoordinator) {
    this.snapshot = new JsonSnapshotFile(coordinator, new BusinessSnapshotCodec(), 'task-store');
  }

  read(): Promise<StorageResult<BusinessSnapshot>> {
    return this.snapshot.read();
  }

  save(candidate: BusinessSnapshot, expectedRevision: number): Promise<StorageResult<BusinessSnapshot>> {
    return this.snapshot.save(candidate, expectedRevision);
  }

  recoverBackup(): Promise<StorageResult<BusinessSnapshot>> {
    return this.snapshot.recoverBackup();
  }
}
