export const APP_TABS: string[] = ['pages/TaskAssistant', 'pages/Tasks', 'pages/Schedule', 'pages/GatewaySettings'];

/** Physical tab order, independent of push/pop and visit history. */
export function tabDirection(from: string, to: string): number {
  const start: number = APP_TABS.indexOf(from);
  const end: number = APP_TABS.indexOf(to);
  if (start < 0 || end < 0 || start === end) return 0;
  return end > start ? 1 : -1;
}

export interface TabRoutePort {
  direction(value: number): void;
  open(page: string): Promise<void>;
}

export class TabNavigator {
  private busy: boolean = false;
  async go(from: string, to: string, port: TabRoutePort): Promise<void> {
    const direction: number = tabDirection(from, to);
    if (direction === 0 || this.busy) return;
    this.busy = true;
    try {
      port.direction(direction);
      await port.open(to);
    } finally { this.busy = false; }
  }
}
