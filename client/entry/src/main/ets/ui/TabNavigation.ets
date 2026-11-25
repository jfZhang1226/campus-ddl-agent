import router from '@ohos.router';
import { TabNavigator, TabRoutePort, tabDirection } from './TabRoutePolicy';

class ArkTabRoutePort implements TabRoutePort {
  direction(value: number): void { AppStorage.setOrCreate('tabTravelDirection', value); }
  async open(page: string): Promise<void> {
    if (page === 'pages/TaskAssistant') router.back({ url: page });
    else await router.pushUrl({ url: page }, router.RouterMode.Single);
  }
}

const navigator: TabNavigator = new TabNavigator();
const port: ArkTabRoutePort = new ArkTabRoutePort();

export function openAppTab(from: string, to: string): Promise<void> { return navigator.go(from, to, port); }

/** Call only after the current page's dirty/busy guards allow a real back. */
export function prepareTabBack(from: string): void {
  const index: number = router.getState().index;
  const target = index > 1 ? router.getStateByIndex(index - 1) : undefined;
  const direction: number = target === undefined ? 0 : tabDirection(from, (target.path + target.name).replace(/^\//, ''));
  AppStorage.setOrCreate('tabTravelDirection', direction === 0 ? -1 : direction);
}
