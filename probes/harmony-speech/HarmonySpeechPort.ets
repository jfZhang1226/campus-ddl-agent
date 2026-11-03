import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { speechRecognizer, textToSpeech } from '@kit.CoreSpeechKit';
import { BusinessError } from '@kit.BasicServicesKit';
import deviceInfo from '@ohos.deviceInfo';
import { ProbePort, RecognitionEvents, PlaybackEvents } from './SpeechProbeController';

// HarmonyOS-only capability probe. Never import this file from the shared ArkUI-X app.
export class HarmonySpeechPort implements ProbePort {
  private asr: speechRecognizer.SpeechRecognitionEngine | undefined;
  private tts: textToSpeech.TextToSpeechEngine | undefined;
  private asrId: string = '';
  private ttsId: string = '';

  private context: common.UIAbilityContext;
  constructor(context: common.UIAbilityContext) {
    if (!deviceInfo.osFullName.startsWith('OpenHarmony')) throw new Error('HARMONY_ONLY');
    this.context = context;
  }
  async microphone(): Promise<boolean> {
    const result = await abilityAccessCtrl.createAtManager()
      .requestPermissionsFromUser(this.context, ['ohos.permission.MICROPHONE']);
    return result.authResults.length === 1 && result.authResults[0] === 0;
  }
  async listen(id: string, events: RecognitionEvents): Promise<void> {
    this.asrId = id;
    const params: speechRecognizer.CreateEngineParams = {
      language: 'zh-CN', online: 1, extraParams: { locate: 'CN', recognizerMode: 'short' }
    };
    let engine: speechRecognizer.SpeechRecognitionEngine;
    try { engine = await speechRecognizer.createEngine(params); }
    catch (error) {
      const cause = error as BusinessError;
      events.failed(id, 'ASR_CREATE_' + cause.code); return;
    }
    if (this.asrId !== id) { engine.shutdown(); return; }
    this.asr = engine;
    const listener: speechRecognizer.RecognitionListener = {
      onStart: (sessionId: string, message: string): void => events.started(sessionId),
      onEvent: (sessionId: string, code: number, message: string): void => {},
      onResult: (sessionId: string, result: speechRecognizer.SpeechRecognitionResult): void => {
        events.result(sessionId, result.result, result.isFinal);
      },
      onComplete: (sessionId: string, message: string): void => {
        events.completed(sessionId); this.closeAsr(sessionId);
      },
      onError: (sessionId: string, code: number, message: string): void => {
        events.failed(sessionId, 'ASR_' + code); this.closeAsr(sessionId);
      }
    };
    engine.setListener(listener);
    const start: speechRecognizer.StartParams = {
      sessionId: id,
      audioInfo: { audioType: 'pcm', sampleRate: 16000, soundChannel: 1, sampleBit: 16 },
      extraParams: { recognitionMode: 0, maxAudioDuration: 30000 }
    };
    // recognitionMode 0 captures the microphone inside Core Speech; no audio file or upload.
    engine.startListening(start);
  }
  finish(id: string): void { if (id === this.asrId) this.asr?.finish(id); }
  cancel(id: string): void {
    if (id !== this.asrId) return;
    const engine = this.asr;
    this.asrId = ''; this.asr = undefined;
    if (engine) {
      try { engine.cancel(id); } finally { engine.shutdown(); }
    }
  }
  private closeAsr(id: string): void {
    if (id !== this.asrId) return;
    const engine = this.asr;
    this.asrId = ''; this.asr = undefined;
    engine?.shutdown();
  }
  async speak(id: string, text: string, events: PlaybackEvents): Promise<void> {
    this.ttsId = id;
    const params: textToSpeech.CreateEngineParams = {
      language: 'zh-CN', person: 0, online: 1, extraParams: { name: 'CampusDdlT09', isBackStage: false }
    };
    let engine: textToSpeech.TextToSpeechEngine;
    try { engine = await textToSpeech.createEngine(params); }
    catch (error) {
      const cause = error as BusinessError;
      events.failed(id, 'TTS_CREATE_' + cause.code); return;
    }
    if (this.ttsId !== id) { engine.shutdown(); return; }
    this.tts = engine;
    const listener: textToSpeech.SpeakListener = {
      onStart: (requestId: string, response: textToSpeech.StartResponse): void => events.started(requestId),
      onComplete: (requestId: string, response: textToSpeech.CompleteResponse): void => {
        // type 0 is synthesis only; only type 1 confirms playback completion.
        if (response.type === 1) { events.completed(requestId); this.closeTts(requestId); }
      },
      onStop: (requestId: string, response: textToSpeech.StopResponse): void => {
        events.stopped(requestId); this.closeTts(requestId);
      },
      onData: (requestId: string, audio: ArrayBuffer, response: textToSpeech.SynthesisResponse): void => {},
      onError: (requestId: string, code: number, message: string): void => {
        events.failed(requestId, 'TTS_' + code); this.closeTts(requestId);
      }
    };
    engine.setListener(listener);
    const speakParams: textToSpeech.SpeakParams = {
      requestId: id, extraParams: { playType: 1, queueMode: 1, speed: 1, volume: 1 }
    };
    engine.speak(text, speakParams);
  }
  stop(): void {
    const engine = this.tts;
    this.ttsId = ''; this.tts = undefined;
    if (engine) { try { engine.stop(); } finally { engine.shutdown(); } }
  }
  private closeTts(id: string): void {
    if (id !== this.ttsId) return;
    const engine = this.tts;
    this.ttsId = ''; this.tts = undefined;
    engine?.shutdown();
  }
  release(): void {
    try { this.cancel(this.asrId); } finally { this.stop(); }
  }
}
