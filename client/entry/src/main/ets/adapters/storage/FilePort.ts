/** All names are relative to one application-private directory. */
export interface FilePort {
  ensureDirectory(name: string): Promise<void>;
  exists(name: string): Promise<boolean>;
  readText(name: string): Promise<string>;
  /** Complete UTF-8 write, flush and close; callers also verify the readback. */
  writeText(name: string, text: string): Promise<void>;
  /** Same-directory rename, replacing the destination without unlinking it first. */
  replace(source: string, destination: string): Promise<void>;
  listNames(directory: string): Promise<string[]>;
}
