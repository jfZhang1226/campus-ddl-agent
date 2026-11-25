import { ArkGatewayTransport } from '../adapters/ArkGatewayTransport';
import { ChatController } from './ChatController';
import { SystemChatClock } from './ChatModels';
import { StoredChatHistory } from './StoredChatHistory';
import { getClientStorage } from '../data/ClientStorage';
import { StorageFailure } from '../data/storage/StorageTypes';
import { GatewaySettings, UnavailableGatewaySecretStore } from './GatewaySettings';

// Shared default explicitly lacks a native credential vault; history remains separate.
class ChatOwner {
  private controller: ChatController | undefined;
  private filesDir: string = '';
  private connection: GatewaySettings | undefined;

  get(filesDir?: string): ChatController {
    if (this.controller === undefined) {
      if (filesDir === undefined) throw new StorageFailure('INVALID_ARGUMENT', '请先初始化应用会话目录。');
      this.filesDir = filesDir;
      this.controller = new ChatController(new ArkGatewayTransport(), new SystemChatClock(),
        new StoredChatHistory(getClientStorage(filesDir).history));
      this.controller.initializeHistory();
      this.connection = new GatewaySettings(new UnavailableGatewaySecretStore(), this.controller);
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
  settings(filesDir: string): GatewaySettings { this.get(filesDir); return this.connection!; }

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
      this.connection = undefined;
    }
  }
}

export const chatOwner: ChatOwner = new ChatOwner();
