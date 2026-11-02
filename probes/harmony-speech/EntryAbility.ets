import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { speechProbeOwner } from './pages/SpeechProbeOwner';

export default class EntryAbility extends UIAbility {
  onWindowStageCreate(stage: window.WindowStage): void {
    stage.loadContent('pages/SpeechProbe');
  }
  onBackground(): void { speechProbeOwner.pause(); }
  onWindowStageDestroy(): void { speechProbeOwner.pause(); }
  onDestroy(): void { speechProbeOwner.destroy(); }
}
