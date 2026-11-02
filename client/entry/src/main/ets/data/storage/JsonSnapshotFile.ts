import { StorageCoordinator } from './StorageCoordinator';
import {
  SnapshotCodec, StorageFailure, StorageResult, VersionedDocument,
  isStorageId, storageError, storageSuccess
} from './StorageTypes';

/** Storage primitive only. Confirmation, operationId and domain mutations belong to T14/T16. */
export class JsonSnapshotFile<T extends VersionedDocument> {
  private coordinator: StorageCoordinator;
  private codec: SnapshotCodec<T>;
  private directory: string;
  private stem: string;

  constructor(coordinator: StorageCoordinator, codec: SnapshotCodec<T>, stem: string, directory: string = '') {
    if (!isStorageId(stem) || (directory !== '' && !isStorageId(directory))) {
      throw new StorageFailure('INVALID_ARGUMENT', '存储名称无效。');
    }
    this.coordinator = coordinator;
    this.codec = codec;
    this.directory = directory;
    this.stem = stem;
  }

  private path(suffix: string): string {
    return (this.directory === '' ? '' : this.directory + '/') + this.stem + suffix;
  }

  read(requireExisting: boolean = false): Promise<StorageResult<T>> {
    return this.coordinator.run(async () => {
      try {
        return storageSuccess(await this.readCurrent(requireExisting));
      } catch (error) {
        return storageError<T>(error as Error);
      }
    });
  }

  /** Compare-and-save is a storage guard, not the confirmed-proposal protocol. */
  save(candidate: T, expectedRevision: number): Promise<StorageResult<T>> {
    // Freeze input before waiting in the queue; caller mutations must not change this request.
    let requestText: string;
    try {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new StorageFailure('INVALID_ARGUMENT', 'expectedRevision 无效。');
      }
      requestText = JSON.stringify(candidate);
      const request: T = this.codec.decode(requestText);
      if (request.revision !== expectedRevision) {
        throw new StorageFailure('INVALID_ARGUMENT', '候选快照版本与 expectedRevision 不一致。');
      }
    } catch (error) {
      return Promise.resolve(new StorageResult<T>(false, null, 'INVALID_ARGUMENT', '候选快照无效，未写入文件。'));
    }
    return this.coordinator.run(async () => {
      try {
        const current: T = await this.readCurrent();
        if (current.revision !== expectedRevision) {
          throw new StorageFailure('VERSION_CONFLICT', '本地数据已变化，请重新读取后确认。');
        }
        const next: T = this.codec.decode(requestText);
        if (!Number.isSafeInteger(expectedRevision + 1)) {
          throw new StorageFailure('INVALID_ARGUMENT', '存储版本已超出支持范围。');
        }
        next.revision = expectedRevision + 1;
        const nextText: string = JSON.stringify(next);
        // Construct the return value before the commit point. No fallible I/O follows replace.
        const committed: T = this.codec.decode(nextText);
        await this.writeVerified(this.path('.tmp.json'), nextText);
        if (await this.coordinator.files.exists(this.path('.json'))) {
          const oldText: string = await this.coordinator.files.readText(this.path('.json'));
          this.codec.decode(oldText);
          await this.writeVerified(this.path('.backup.tmp.json'), oldText);
          await this.coordinator.files.replace(this.path('.backup.tmp.json'), this.path('.backup.json'));
        }
        await this.coordinator.files.replace(this.path('.tmp.json'), this.path('.json'));
        return storageSuccess(committed);
      } catch (error) {
        return storageError<T>(error as Error);
      }
    });
  }

  /** Explicit recovery only; invalid/unsupported files are never silently reset. */
  recoverBackup(): Promise<StorageResult<T>> {
    return this.coordinator.run(async () => {
      try {
        await this.coordinator.files.ensureDirectory(this.directory);
        let damagedText: string | null = null;
        if (await this.coordinator.files.exists(this.path('.json'))) {
          damagedText = await this.coordinator.files.readText(this.path('.json'));
          let valid: boolean = false;
          try {
            this.codec.decode(damagedText);
            valid = true;
          } catch (error) {
            if (error instanceof StorageFailure && error.code === 'UNSUPPORTED_SCHEMA') {
              throw error;
            }
          }
          if (valid) {
            throw new StorageFailure('INVALID_ARGUMENT', '正式快照有效，无需从备份恢复。');
          }
        }
        if (!await this.coordinator.files.exists(this.path('.backup.json'))) {
          throw new StorageFailure('RECOVERY_REQUIRED', '没有可用备份；请保留现有文件。');
        }
        const backupText: string = await this.coordinator.files.readText(this.path('.backup.json'));
        const restored: T = this.codec.decode(backupText);
        // Preserve the corrupt primary under a new name before replacing it.
        if (damagedText !== null) {
          let index: number = 0;
          let archive: string = this.path('.corrupt-' + index + '.json');
          while (await this.coordinator.files.exists(archive)) {
            index += 1;
            archive = this.path('.corrupt-' + index + '.json');
          }
          await this.coordinator.files.writeText(archive, damagedText);
          if (await this.coordinator.files.readText(archive) !== damagedText) {
            throw new StorageFailure('STORAGE_FAILED', '损坏文件保留失败，尚未恢复。');
          }
        }
        await this.writeVerified(this.path('.recovery.tmp.json'), backupText);
        await this.coordinator.files.replace(this.path('.recovery.tmp.json'), this.path('.json'));
        return storageSuccess(restored);
      } catch (error) {
        return storageError<T>(error as Error);
      }
    });
  }

  private async readCurrent(requireExisting: boolean = false): Promise<T> {
    await this.coordinator.files.ensureDirectory(this.directory);
    if (await this.coordinator.files.exists(this.path('.json'))) {
      return this.codec.decode(await this.coordinator.files.readText(this.path('.json')));
    }
    const names: string[] = await this.coordinator.files.listNames(this.directory);
    if (names.some((name: string) => name.startsWith(this.stem + '.'))) {
      throw new StorageFailure('RECOVERY_REQUIRED', '正式快照缺失且存在恢复痕迹，未创建空数据。');
    }
    if (requireExisting) {
      throw new StorageFailure('NOT_FOUND', '记录尚未保存。');
    }
    const empty: T = this.codec.empty();
    return this.codec.decode(JSON.stringify(empty));
  }

  private async writeVerified(name: string, text: string): Promise<void> {
    await this.coordinator.files.writeText(name, text);
    const actual: string = await this.coordinator.files.readText(name);
    if (actual !== text) {
      throw new StorageFailure('STORAGE_FAILED', '临时快照读回不一致，正式数据未替换。');
    }
    this.codec.decode(actual);
  }
}
