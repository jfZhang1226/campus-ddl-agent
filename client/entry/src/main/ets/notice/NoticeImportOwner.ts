import { NoticeSaveController } from './NoticeSaveController';
import { StorageFailure } from '../data/storage/StorageTypes';

/** One visible import flow; the application's storage and confirmation services stay authoritative. */
export class NoticeImportOwner {
  private current: NoticeSaveController | undefined;

  claim(controller: NoticeSaveController): void {
    if (this.current !== undefined && this.current !== controller) {
      throw new StorageFailure('BUSY', '已有通知正在整理，请先返回当前通知。');
    }
    this.current = controller;
  }
  release(controller: NoticeSaveController): void {
    if (this.current === controller) this.current = undefined;
    controller.dispose();
  }
  pause(): void { this.current?.pause(); }
  destroy(): void {
    this.current?.dispose();
    this.current = undefined;
  }
}

export const noticeImportOwner = new NoticeImportOwner();
