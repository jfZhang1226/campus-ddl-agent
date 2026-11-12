import { LocalStore } from '../../client/entry/src/main/ets/data/LocalStore';
import { NoticeImportInput, NoticeImportWrite } from '../../client/entry/src/main/ets/data/NoticeImportRepository';
import { NoticeImportWriter } from '../../client/entry/src/main/ets/notice/NoticeImportController';
import { StorageFailure, StorageResult, storageError, storageSuccess } from '../../client/entry/src/main/ets/data/storage/StorageTypes';

/** Read-only gate until T13/T16 agree on atomic material changes. Never fall back to base CRUD. */
export class NoticeCommitGate implements NoticeImportWriter {
  constructor(private store: LocalStore) {}
  async revision(): Promise<StorageResult<number>> {
    const result = await this.store.read();
    if (!result.success || result.data === null) {
      return storageError<number>(new StorageFailure(result.errorCode === null ? 'STORAGE_FAILED' : result.errorCode,
        '无法读取当前本地数据。'));
    }
    return storageSuccess(result.data.revision);
  }
  create(_input: NoticeImportInput, _revision: number): Promise<StorageResult<NoticeImportWrite>> {
    return Promise.resolve(storageError<NoticeImportWrite>(new StorageFailure('COMMIT_UNAVAILABLE',
      '正式确认保存尚未接通，草案与材料已保留。')));
  }
}
