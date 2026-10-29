import { ArkFilePort } from '../adapters/storage/ArkFilePort';
import { StorageCoordinator } from './storage/StorageCoordinator';
import { StorageFailure } from './storage/StorageTypes';
import { LocalStore } from './LocalStore';
import { SessionStore } from './SessionStore';

export class ClientStorage {
  local: LocalStore;
  sessions: SessionStore;

  constructor(coordinator: StorageCoordinator) {
    this.local = new LocalStore(coordinator);
    this.sessions = new SessionStore(coordinator);
  }
}

let applicationStorage: ClientStorage | null = null;
let applicationFilesDir: string = '';

/** Call from the application owner with context.filesDir; reuse for its entire lifetime. */
export function getClientStorage(filesDir: string): ClientStorage {
  if (applicationStorage === null) {
    applicationFilesDir = filesDir;
    applicationStorage = new ClientStorage(new StorageCoordinator(new ArkFilePort(filesDir)));
  }
  if (applicationFilesDir !== filesDir) {
    throw new StorageFailure('INVALID_ARGUMENT', '应用存储不能在运行中切换目录。');
  }
  return applicationStorage;
}
