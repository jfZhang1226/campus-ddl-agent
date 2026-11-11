import { ArkGatewayTransport } from '../adapters/ArkGatewayTransport';
import { ChatController } from './ChatController';
import { SystemChatClock } from './ChatModels';
import { StoredChatHistory } from './StoredChatHistory';
import { getClientStorage } from '../data/ClientStorage';
import { StorageFailure } from '../data/storage/StorageTypes';

// Runtime credentials stay in memory; history uses the one application storage owner.
class ChatOwner {
  private controller: ChatController | undefined;
  private filesDir: string = '';

  get(filesDir?: string): ChatController {
    if (this.controller === undefined) {
      if (filesDir === undefined) throw new StorageFailure('INVALID_ARGUMENT', '请先初始化应用会话目录。');
      this.filesDir = filesDir;
      this.controller = new ChatController(new ArkGatewayTransport(), new SystemChatClock(),
        new StoredChatHistory(getClientStorage(filesDir).history));
      this.controller.initializeHistory();
    }
    if (filesDir !== undefined && filesDir !== this.filesDir) {
      throw new StorageFailure('INVALID_ARGUMENT', '运行中不能切换会话目录。');
    }
    return this.controller;
  }

  pause(): void {
    if (this.controller !== undefined) {
      this.controller.stop('BACKGROUND');
    }
  }

  detach(): void {
    if (this.controller !== undefined) {
      this.controller.unsubscribe();
    }
  }

  destroy(): void {
    if (this.controller !== undefined) {
      this.controller.dispose();
      this.controller = undefined;
      this.filesDir = '';
    }
  }
}

export const chatOwner: ChatOwner = new ChatOwner();
