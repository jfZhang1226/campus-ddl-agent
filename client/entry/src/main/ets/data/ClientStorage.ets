import { ArkFilePort } from '../adapters/storage/ArkFilePort';
import { StorageCoordinator } from './storage/StorageCoordinator';
import { StorageFailure } from './storage/StorageTypes';
import { LocalStore } from './LocalStore';
import { SessionStore } from './SessionStore';
import { TaskRepository } from './TaskRepository';
import { SessionRepository } from './SessionRepository';
import { CommitServices } from './CommitServices';

export class ClientStorage {
  local: LocalStore;
  sessions: SessionStore;
  tasks: TaskRepository;
  history: SessionRepository;
  commits: CommitServices;

  constructor(coordinator: StorageCoordinator) {
    this.local = new LocalStore(coordinator);
    this.sessions = new SessionStore(coordinator);
    this.tasks = new TaskRepository(this.local);
    this.history = new SessionRepository(this.sessions);
    this.commits = new CommitServices(this.local);
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
