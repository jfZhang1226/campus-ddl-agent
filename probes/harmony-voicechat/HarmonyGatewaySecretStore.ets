import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { GatewaySecretStore } from '../chat/GatewaySettings';

/** Native-only: one encrypted record, app scoped, device local, unavailable while locked. */
export class HarmonyGatewaySecretStore implements GatewaySecretStore {
  supported: boolean = true;
  private query(): asset.AssetMap {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, new util.TextEncoder().encodeInto('campusddl.gateway.connection.v1'));
    return query;
  }
  read(): string | null {
    const query = this.query(); query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const results = asset.querySync(query);
      if (results.length === 0) return null;
      if (results.length !== 1) throw new Error('INVALID_RECORD');
      const secret = results[0].get(asset.Tag.SECRET);
      if (!(secret instanceof Uint8Array) || secret.length > 1024) throw new Error('INVALID_RECORD');
      return util.TextDecoder.create('utf-8', { fatal: true }).decodeToString(secret);
    } catch (error) {
      if ((error as BusinessError).code === 24000002) return null;
      throw new Error('SECURE_READ_FAILED');
    }
  }
  write(raw: string): void {
    const secret = new util.TextEncoder().encodeInto(raw);
    if (secret.length === 0 || secret.length > 1024) throw new Error('INVALID_RECORD');
    const attributes = this.query();
    attributes.set(asset.Tag.SECRET, secret);
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_UNLOCKED);
    attributes.set(asset.Tag.AUTH_TYPE, asset.AuthType.NONE);
    attributes.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER);
    attributes.set(asset.Tag.WRAP_TYPE, asset.WrapType.NEVER);
    attributes.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
    // IS_PERSISTENT is intentionally omitted: do not retain credentials after uninstall.
    try { asset.addSync(attributes); } catch (_) { throw new Error('SECURE_SAVE_FAILED'); }
  }
  remove(): void {
    try { asset.removeSync(this.query()); }
    catch (error) { if ((error as BusinessError).code !== 24000002) throw new Error('SECURE_CLEAR_FAILED'); }
  }
}
