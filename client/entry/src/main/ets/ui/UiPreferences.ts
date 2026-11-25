import { StorageCoordinator } from '../data/storage/StorageCoordinator';
import { JsonSnapshotFile } from '../data/storage/JsonSnapshotFile';
import { SnapshotCodec, StorageResult, checkHeader, requireStorage } from '../data/storage/StorageTypes';

export class UiPreferencesDocument {
  schemaVersion: number = 1;
  revision: number = 0;
  largeSimpleMode: boolean = false;
}

class UiPreferencesCodec implements SnapshotCodec<UiPreferencesDocument> {
  empty(): UiPreferencesDocument { return new UiPreferencesDocument(); }
  decode(text: string): UiPreferencesDocument {
    const value: UiPreferencesDocument = JSON.parse(text) as UiPreferencesDocument;
    checkHeader(value);
    requireStorage(typeof value.largeSimpleMode === 'boolean' &&
      Object.keys(value).every(key => ['schemaVersion', 'revision', 'largeSimpleMode'].includes(key)), '显示设置无效，原记录已保留。');
    return value;
  }
}

export interface UiPreferencesPort {
  read(): Promise<StorageResult<UiPreferencesDocument>>;
  save(value: UiPreferencesDocument, revision: number): Promise<StorageResult<UiPreferencesDocument>>;
}

/** Display-only file; never contains a credential, task, notification or session. */
export class UiPreferencesRepository implements UiPreferencesPort {
  private snapshot: JsonSnapshotFile<UiPreferencesDocument>;
  constructor(coordinator: StorageCoordinator) {
    this.snapshot = new JsonSnapshotFile(coordinator, new UiPreferencesCodec(), 'display-settings');
  }
  read(): Promise<StorageResult<UiPreferencesDocument>> { return this.snapshot.read(); }
  save(value: UiPreferencesDocument, revision: number): Promise<StorageResult<UiPreferencesDocument>> {
    return this.snapshot.save(value, revision);
  }
}

export class UiPreferencesController {
  loaded: boolean = false;
  busy: boolean = false;
  enabled: boolean = false;
  notice: string = '';
  private revision: number = 0;
  private port: UiPreferencesPort;
  private publish: (value: boolean) => void;
  constructor(port: UiPreferencesPort, publish: (value: boolean) => void) { this.port = port; this.publish = publish; }
  async restore(): Promise<void> {
    if (this.loaded || this.busy) return;
    this.busy = true;
    try {
      const result = await this.port.read();
      if (!result.success || result.data === null) { this.notice = '显示设置暂时无法读取，请重试。'; return; }
      this.revision = result.data.revision; this.enabled = result.data.largeSimpleMode;
      this.loaded = true; this.notice = ''; this.publish(this.enabled);
    } catch (_) { this.notice = '显示设置暂时无法读取，请重试。'; }
    finally { this.busy = false; }
  }
  async setEnabled(value: boolean): Promise<boolean> {
    if (this.busy) { this.notice = '显示设置正在处理，请稍后再试。'; return false; }
    if (!this.loaded) await this.restore();
    if (!this.loaded || this.busy) return false;
    if (value === this.enabled) return true;
    this.busy = true;
    try {
      const candidate = new UiPreferencesDocument();
      candidate.revision = this.revision; candidate.largeSimpleMode = value;
      const result = await this.port.save(candidate, this.revision);
      if (!result.success || result.data === null) {
        if (result.errorCode === 'VERSION_CONFLICT') this.loaded = false;
        this.notice = '显示设置未保存，请重试。'; return false;
      }
      this.revision = result.data.revision; this.enabled = result.data.largeSimpleMode;
      this.notice = ''; this.publish(this.enabled); return true;
    } catch (_) { this.notice = '显示设置未保存，请重试。'; return false; }
    finally { this.busy = false; }
  }
}

export function readableFont(size: number, large: boolean): number {
  return large ? Math.max(18, size + 6) : size;
}

export function readableLineHeight(height: number, large: boolean): number {
  return large ? Math.max(28, height + 8) : height;
}
