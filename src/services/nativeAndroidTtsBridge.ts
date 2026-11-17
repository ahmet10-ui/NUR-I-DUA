import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';

export interface AndroidTTSEngineInfo {
  name: string;
  label: string;
  isDefault: boolean;
}

export interface AndroidTTSVoiceInfo {
  name: string;
  locale: string;
  quality: number;
  latency: number;
  isNetworkConnectionRequired: boolean;
  features: string[];
  matchesAntalia: boolean;
}

export type TurkishSupportStatus =
  | 'supported'
  | 'country_available'
  | 'missing_data'
  | 'not_supported'
  | 'unknown';

export interface AndroidTTSEngineStatus {
  platform: string;
  isNativeAndroid: boolean;
  pluginAvailable: boolean;
  initialized: boolean;
  defaultEngine: string | null;
  defaultEngineLabel: string | null;
  engines: AndroidTTSEngineInfo[];
  turkishSupport: TurkishSupportStatus;
  turkishSupportCode: number | null;
  voices: AndroidTTSVoiceInfo[];
  antaliaEngineMatched: boolean;
  antaliaVoiceMatched: boolean;
  lastError: string | null;
}

export interface NativeTTSSpeakParams {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  voiceName?: string;
  utteranceId: string;
}

export interface NativeTTSStartEvent {
  utteranceId: string;
}

export interface NativeTTSRangeEvent {
  utteranceId: string;
  start: number;
  end: number;
  frame: number;
}

export interface NativeTTSDoneEvent {
  utteranceId: string;
}

export interface NativeTTSErrorEvent {
  utteranceId: string;
  errorCode?: number;
  message: string;
}

export interface NurIDuaTtsPlugin {
  getEngineInfo(): Promise<AndroidTTSEngineStatus>;
  speak(params: NativeTTSSpeakParams): Promise<{ ok: boolean; utteranceId: string; error?: string }>;
  stop(): Promise<{ ok: boolean }>;
  pause(): Promise<{ ok: boolean; pausedAtOffset?: number }>;
  resume(): Promise<{ ok: boolean; utteranceId?: string; error?: string }>;
  addListener(
    eventName: 'ttsStart',
    listenerFunc: (event: NativeTTSStartEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'ttsRange',
    listenerFunc: (event: NativeTTSRangeEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'ttsDone',
    listenerFunc: (event: NativeTTSDoneEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'ttsError',
    listenerFunc: (event: NativeTTSErrorEvent) => void
  ): Promise<PluginListenerHandle>;
}

const NurIDuaTts = registerPlugin<NurIDuaTtsPlugin>('NurIDuaTts');

export function isNativeAndroidEnvironment(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

export function isNativeTtsPluginAvailable(): boolean {
  try {
    return isNativeAndroidEnvironment() && Capacitor.isPluginAvailable('NurIDuaTts');
  } catch {
    return false;
  }
}

export async function getEngineInfo(): Promise<AndroidTTSEngineStatus> {
  const platform = (() => {
    try {
      return Capacitor.getPlatform();
    } catch {
      return 'web';
    }
  })();

  if (!isNativeAndroidEnvironment()) {
    return {
      platform,
      isNativeAndroid: false,
      pluginAvailable: false,
      initialized: false,
      defaultEngine: null,
      defaultEngineLabel: null,
      engines: [],
      turkishSupport: 'unknown',
      turkishSupportCode: null,
      voices: [],
      antaliaEngineMatched: false,
      antaliaVoiceMatched: false,
      lastError:
        'Yerel Android Capacitor ortamı algılanmadı (Chrome Preview / Web ortamı aktif). Mevcut tarayıcı SpeechSynthesis sistem sesine geri dönüldü.',
    };
  }

  if (!Capacitor.isPluginAvailable('NurIDuaTts')) {
    return {
      platform,
      isNativeAndroid: true,
      pluginAvailable: false,
      initialized: false,
      defaultEngine: null,
      defaultEngineLabel: null,
      engines: [],
      turkishSupport: 'unknown',
      turkishSupportCode: null,
      voices: [],
      antaliaEngineMatched: false,
      antaliaVoiceMatched: false,
      lastError:
        'NurIDuaTts yerel eklentisi Android MainActivity içinde kayıtlı değil veya APK senkronize edilmedi.',
    };
  }

  try {
    const info = await NurIDuaTts.getEngineInfo();
    return {
      ...info,
      platform,
      isNativeAndroid: true,
      pluginAvailable: true,
    };
  } catch (err) {
    return {
      platform,
      isNativeAndroid: true,
      pluginAvailable: true,
      initialized: false,
      defaultEngine: null,
      defaultEngineLabel: null,
      engines: [],
      turkishSupport: 'unknown',
      turkishSupportCode: null,
      voices: [],
      antaliaEngineMatched: false,
      antaliaVoiceMatched: false,
      lastError:
        err instanceof Error
          ? err.message
          : 'Android TextToSpeech motor bilgisi sorgulanamadı.',
    };
  }
}

export async function speakNativeAndroid(
  params: NativeTTSSpeakParams
): Promise<{ ok: boolean; utteranceId: string; error?: string }> {
  if (!isNativeTtsPluginAvailable()) {
    return {
      ok: false,
      utteranceId: params.utteranceId,
      error: 'Native Android TTS eklentisi bu ortamda kullanılamıyor.',
    };
  }
  return NurIDuaTts.speak(params);
}

export async function stopNativeAndroid(): Promise<void> {
  if (!isNativeTtsPluginAvailable()) return;
  try {
    await NurIDuaTts.stop();
  } catch {
    // ignore cleanup failures
  }
}

export async function pauseNativeAndroid(): Promise<void> {
  if (!isNativeTtsPluginAvailable()) return;
  try {
    await NurIDuaTts.pause();
  } catch {
    // ignore
  }
}

export async function resumeNativeAndroid(): Promise<{ ok: boolean; utteranceId?: string; error?: string }> {
  if (!isNativeTtsPluginAvailable()) {
    return { ok: false, error: 'Native Android TTS eklentisi kullanılamıyor.' };
  }
  try {
    return await NurIDuaTts.resume();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Native Android TTS devam ettirilemedi.',
    };
  }
}

export async function subscribeNativeAndroidTtsEvents(handlers: {
  onStart?: (event: NativeTTSStartEvent) => void;
  onRange?: (event: NativeTTSRangeEvent) => void;
  onDone?: (event: NativeTTSDoneEvent) => void;
  onError?: (event: NativeTTSErrorEvent) => void;
}): Promise<() => void> {
  if (!isNativeTtsPluginAvailable()) {
    return () => {};
  }

  const handles: PluginListenerHandle[] = [];
  if (handlers.onStart) {
    handles.push(await NurIDuaTts.addListener('ttsStart', handlers.onStart));
  }
  if (handlers.onRange) {
    handles.push(await NurIDuaTts.addListener('ttsRange', handlers.onRange));
  }
  if (handlers.onDone) {
    handles.push(await NurIDuaTts.addListener('ttsDone', handlers.onDone));
  }
  if (handlers.onError) {
    handles.push(await NurIDuaTts.addListener('ttsError', handlers.onError));
  }

  return () => {
    handles.forEach((h) => {
      h.remove().catch(() => {
        // ignore
      });
    });
  };
}
