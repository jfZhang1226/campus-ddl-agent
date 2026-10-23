export interface VersionedDocument {
  schemaVersion: number;
  revision: number;
}

export interface SnapshotCodec<T extends VersionedDocument> {
  empty(): T;
  decode(text: string): T;
}

export class StorageFailure extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StorageFailure';
    this.code = code;
  }
}

export class StorageResult<T> {
  success: boolean;
  data: T | null;
  errorCode: string | null;
  message: string;

  constructor(success: boolean, data: T | null, errorCode: string | null, message: string) {
    this.success = success;
    this.data = data;
    this.errorCode = errorCode;
    this.message = message;
  }
}

export function storageSuccess<T>(value: T): StorageResult<T> {
  return new StorageResult<T>(true, value, null, '');
}

export function storageError<T>(error: Error): StorageResult<T> {
  if (error instanceof StorageFailure) {
    return new StorageResult<T>(false, null, error.code, error.message);
  }
  // Do not expose platform paths, raw data or vendor error messages to UI/model logs.
  return new StorageResult<T>(false, null, 'STORAGE_FAILED', '本地文件操作失败，请保留输入后重试。');
}

export function requireStorage(condition: boolean, message: string): void {
  if (!condition) {
    throw new StorageFailure('CORRUPT_DATA', message);
  }
}

export function checkHeader(document: VersionedDocument): void {
  requireStorage(document !== null && typeof document === 'object' && !Array.isArray(document),
    '存储内容不是有效对象。');
  requireStorage(Number.isInteger(document.schemaVersion) && document.schemaVersion > 0,
    '缺少有效的存储结构版本。');
  if (document.schemaVersion !== 1) {
    throw new StorageFailure('UNSUPPORTED_SCHEMA', '存储结构版本不受支持，原文件已保留。');
  }
  requireStorage(Number.isSafeInteger(document.revision) && document.revision >= 0,
    '存储 revision 无效。');
}

export function isStorageId(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}
