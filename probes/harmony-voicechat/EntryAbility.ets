import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { voiceChatOwner } from '../pages/VoiceChatOwner';
import { speechProbeOwner } from '../pages/SpeechProbeOwner';

export default class EntryAbility extends UIAbility {
  onWindowStageCreate(stage: window.WindowStage): void { stage.loadContent('pages/VoiceChat'); }
  onBackground(): void { voiceChatOwner.pause(); speechProbeOwner.pause(); }
  onWindowStageDestroy(): void { voiceChatOwner.pause(); speechProbeOwner.pause(); }
  onDestroy(): void { voiceChatOwner.destroy(); speechProbeOwner.destroy(); }
}
