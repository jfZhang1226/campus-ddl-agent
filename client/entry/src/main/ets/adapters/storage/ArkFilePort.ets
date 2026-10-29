import fs from '@ohos.file.fs';
import { BusinessError } from '@ohos.base';
import { FilePort } from './FilePort';
import { StorageFailure } from '../../data/storage/StorageTypes';

// ENOENT in the shared @ohos.file.fs API; regression records the native code on both OSes.
const FILE_NOT_FOUND_CODE: number = 13900002;

/** Same ArkUI-X file API on both platforms. root must come from UIAbilityContext.filesDir. */
export class ArkFilePort implements FilePort {
  private root: string;

  constructor(filesDir: string, namespace: string = 'campus-ddl') {
    if (!filesDir.startsWith('/') || filesDir.includes('/../') ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(namespace)) {
      throw new StorageFailure('INVALID_ARGUMENT', '应用私有目录配置无效。');
    }
    this.root = filesDir.replace(/\/$/, '') + '/' + namespace;
  }

  private path(name: string): string {
    if (name === '') {
      return this.root;
    }
    if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*(\/[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*)*$/.test(name)) {
      throw new StorageFailure('INVALID_ARGUMENT', '文件相对名称无效。');
    }
    return this.root + '/' + name;
  }

  async ensureDirectory(name: string): Promise<void> {
    if (!await this.exists('')) {
      await fs.mkdir(this.root);
    }
    if (name !== '' && !await this.exists(name)) {
      await fs.mkdir(this.path(name));
    }
  }

  async exists(name: string): Promise<boolean> {
    try {
      await fs.stat(this.path(name));
      return true;
    } catch (error) {
      // A permissions/I/O failure must never be mistaken for a new installation.
      const failure: BusinessError = error as BusinessError;
      if (failure.code === FILE_NOT_FOUND_CODE) {
        return false;
      }
      throw new StorageFailure('STORAGE_FAILED', '无法检查应用私有文件，未初始化或覆盖数据。');
    }
  }

  async readText(name: string): Promise<string> {
    return fs.readText(this.path(name));
  }

  async writeText(name: string, text: string): Promise<void> {
    const file: fs.File = await fs.open(this.path(name), fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    try {
      await fs.write(file.fd, text);
      await fs.fsync(file.fd);
    } finally {
      await fs.close(file);
    }
  }

  async replace(source: string, destination: string): Promise<void> {
    await fs.rename(this.path(source), this.path(destination));
  }

  async listNames(directory: string): Promise<string[]> {
    return fs.listFile(this.path(directory), { recursion: false });
  }
}
