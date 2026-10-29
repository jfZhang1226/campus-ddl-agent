import { ArkGatewayTransport } from '../adapters/ArkGatewayTransport';
import { ChatController } from './ChatController';

// Runtime-only owner. T11 will connect the reviewed conversation store through this boundary.
class ChatOwner {
  private controller: ChatController | undefined;

  get(): ChatController {
    if (this.controller === undefined) {
      this.controller = new ChatController(new ArkGatewayTransport());
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
    }
  }
}

export const chatOwner: ChatOwner = new ChatOwner();
