import { StorageFailure } from './StorageTypes';

export function isJsonRecord(value: Object | null): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]';
}

/** Validate before stringify: JSON must not silently replace/drop caller data. */
export function isJsonValue(value: Object | null, parents: Object[] = []): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || parents.includes(value) || parents.length >= 64) return false;
  const nested: Object[] = parents.concat([value]);
  if (Array.isArray(value)) {
    for (let i: number = 0; i < value.length; i++) {
      if (!isJsonValue(value[i], nested)) return false;
    }
    return true;
  }
  if (!isJsonRecord(value)) return false;
  const fields = value as Record<string, Object | null>;
  return Object.keys(fields).every((key: string) => isJsonValue(fields[key], nested));
}

export function requireJsonValue(value: Object): void {
  if (!isJsonValue(value)) {
    throw new StorageFailure('INVALID_ARGUMENT', '存储内容必须是有限、无循环且对象/数组嵌套不超过64层的 JSON 数据。');
  }
}
