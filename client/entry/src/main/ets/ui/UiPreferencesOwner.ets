import { ArkFilePort } from '../adapters/storage/ArkFilePort';
import { StorageCoordinator } from '../data/storage/StorageCoordinator';
import { UiPreferencesController, UiPreferencesRepository } from './UiPreferences';

let controller: UiPreferencesController | null = null;
let ownerDirectory: string = '';

export function displayPreferences(filesDir: string): UiPreferencesController {
  if (controller === null) {
    ownerDirectory = filesDir;
    controller = new UiPreferencesController(
      new UiPreferencesRepository(new StorageCoordinator(new ArkFilePort(filesDir, 'campus-ui'))),
      (value: boolean): void => { AppStorage.setOrCreate('largeSimpleMode', value); });
  }
  if (ownerDirectory !== filesDir) throw new Error('显示设置不能切换应用目录。');
  return controller;
}
