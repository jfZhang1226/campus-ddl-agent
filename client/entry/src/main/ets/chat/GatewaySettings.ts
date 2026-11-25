import { GatewayConfig } from './ChatModels';
import { validateConfig } from './GatewayProtocol';

export interface GatewaySecretStore {
  supported: boolean;
  read(): string | null;
  write(secret: string): void;
  remove(): void;
}
export interface GatewayRuntime {
  canConfigure(): boolean;
  configuration(): GatewayConfig;
  configure(config: GatewayConfig): boolean;
  clearConfiguration(): boolean;
}
export class GatewaySettingsView {
  saved: boolean = false;
  supported: boolean = false;
  errorCode: string = '';
  notice: string = '';
}
class SavedGateway {
  constructor(public version: number, public baseUrl: string, public token: string, public timeoutMs: number) {}
}
export function encodeGatewaySetting(config: GatewayConfig): string {
  if (typeof config.baseUrl !== 'string' || typeof config.token !== 'string' || typeof config.timeoutMs !== 'number' ||
    config.baseUrl.length > 500 || config.token.length > 1000 || validateConfig(config).length > 0) throw new Error('连接信息无效。');
  const raw = JSON.stringify(new SavedGateway(1, config.baseUrl.trim(), config.token, config.timeoutMs));
  // URL/token validation accepts ASCII only; JSON escaping is included in this 1 KiB bound.
  if (raw.length > 1024) throw new Error('连接信息过长，请缩短地址或凭证。');
  return raw;
}
export function decodeGatewaySetting(raw: string): GatewayConfig {
  if (raw.length > 1024) throw new Error('连接记录无效。');
  let value: SavedGateway | null = null;
  try { value = JSON.parse(raw) as SavedGateway | null; } catch (_) { throw new Error('连接记录无效。'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 ||
    Object.keys(value).length !== 4 || !Object.keys(value).every(key => ['version', 'baseUrl', 'token', 'timeoutMs'].includes(key))) throw new Error('连接记录无效。');
  const config = new GatewayConfig(value.baseUrl, value.token, value.timeoutMs);
  encodeGatewaySetting(config);
  return config;
}
/** No task/history/file ports. Failure messages never include platform errors or secret values. */
export class GatewaySettings {
  private view: GatewaySettingsView = new GatewaySettingsView();
  constructor(private store: GatewaySecretStore, private runtime: GatewayRuntime) {
    this.view.supported = store.supported;
    if (store.supported) this.restore();
  }
  snapshot(): GatewaySettingsView { return Object.assign(new GatewaySettingsView(), this.view); }
  private fail(code: string, message: string): boolean { this.view.errorCode = code; this.view.notice = message; return false; }
  restore(): boolean {
    if (!this.store.supported) return this.fail('UNAVAILABLE', '当前平台只支持本次连接。');
    if (!this.runtime.canConfigure()) return this.fail('BUSY', '请先停止正在进行的操作。');
    try {
      const raw = this.store.read();
      if (raw === null) { this.view.saved = false; this.view.errorCode = ''; this.view.notice = ''; return true; }
      const config = decodeGatewaySetting(raw);
      if (!this.runtime.configure(config)) return this.fail('BUSY', '请先停止正在进行的操作。');
      this.view.saved = true; this.view.errorCode = ''; this.view.notice = ''; return true;
    } catch (_) { return this.fail('READ_FAILED', '暂时无法读取已保存的连接，请解锁手机后重试。'); }
  }
  save(config: GatewayConfig): boolean {
    if (!this.runtime.canConfigure()) return this.fail('BUSY', '请先停止正在进行的操作。');
    let raw = '';
    try { raw = encodeGatewaySetting(config); }
    catch (_) { return this.fail('INVALID_CONFIG', '请检查地址和凭证，连接信息过长时请缩短后重试。'); }
    if (this.store.supported) {
      try { this.store.write(raw); }
      catch (_) { return this.fail('SAVE_FAILED', '未能安全保存连接信息，原设置仍保留，请解锁手机后重试。'); }
      this.view.saved = true;
    }
    // The port is synchronous, so no UI/request event can interleave after canConfigure().
    if (!this.runtime.configure(config)) return this.fail('APPLY_FAILED', this.view.saved ? '连接信息已保存，请重新打开应用后使用。' : '暂时无法应用连接，请重试。');
    this.view.errorCode = ''; this.view.notice = this.store.supported ? '' : '连接仅在本次运行生效，当前平台暂不支持安全保存。'; return true;
  }
  clear(): boolean {
    if (!this.runtime.canConfigure()) return this.fail('BUSY', '请先停止正在进行的操作。');
    if (this.store.supported) {
      try { this.store.remove(); }
      catch (_) { return this.fail('CLEAR_FAILED', '未能清除连接信息，原连接仍保留，请重试。'); }
    }
    this.view.saved = false;
    if (!this.runtime.clearConfiguration()) return this.fail('APPLY_FAILED', '已清除保存的信息，请重新打开应用完成断开。');
    this.view.errorCode = ''; this.view.notice = '连接信息已清除。'; return true;
  }
}
export class UnavailableGatewaySecretStore implements GatewaySecretStore {
  supported: boolean = false;
  read(): string | null { throw new Error('UNAVAILABLE'); }
  write(_secret: string): void { throw new Error('UNAVAILABLE'); }
  remove(): void { throw new Error('UNAVAILABLE'); }
}
