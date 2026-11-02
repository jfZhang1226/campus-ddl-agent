import { FilePort } from '../../adapters/storage/FilePort';

/** One coordinator owns all records in one private directory, for the app lifetime. */
export class StorageCoordinator {
  files: FilePort;
  private tail: Promise<void> = Promise.resolve();

  constructor(files: FilePort) {
    this.files = files;
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    const result: Promise<T> = this.tail.then(work);
    // A failed operation must not poison the queue for subsequent retries.
    this.tail = result.then(() => {}, () => {});
    return result;
  }
}
