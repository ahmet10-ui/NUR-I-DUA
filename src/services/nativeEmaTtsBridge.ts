import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import type {
  SeslenDownloadProgressEvent,
  SeslenIntegrityResult,
  SeslenMemoryStats,
  SeslenPcmStats,
  SeslenTensorMeta,
} from './nativeSeslenTtsBridge';
import { EMA_LIGHTNING_MODEL_METADATA } from './emaTextFrontend';

export interface EmaModelFileStatus {
  fileName: string;
  exists: boolean;
  actualBytes: number;
  expectedBytes: number;
  sizeMatched: boolean;
}

export interface EmaStatusResult {
  platform: string;
  isNativeAndroid: boolean;
  pluginAvailable: boolean;
  modelInstalled: boolean;
  isDownloading: boolean;
  wifiConnected: boolean;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  storagePath: string | null;
  sessionsLoaded: boolean;
  hasLastTestWav?: boolean;
  sampleRate: number;
  files: EmaModelFileStatus[];
  memory: SeslenMemoryStats | null;
  logs?: string[];
}

export interface EmaContractVerificationResult {
  ok: boolean;
  normalizedText?: string;
  tokenLengthL?: number;
  chunkCount?: number;
  sampleRate?: number;
  textInputs?: Record<string, SeslenTensorMeta>;
  textOutputs?: Record<string, SeslenTensorMeta>;
  soundInputs?: Record<string, SeslenTensorMeta>;
  soundOutputs?: Record<string, SeslenTensorMeta>;
  decoderInputs?: Record<string, SeslenTensorMeta>;
  decoderOutputs?: Record<string, SeslenTensorMeta>;
  memory?: SeslenMemoryStats;
  logs?: string[];
  error?: string;
}

export interface EmaSpeakTestResult {
  ok: boolean;
  cancelled?: boolean;
  engineUsed?: string;
  antaliaUsed?: boolean;
  sampleRate?: number;
  modelLoadMs?: number;
  preprocessMs?: number;
  firstAudioMs?: number;
  timeToFirstAudioMs?: number;
  synthesisMs?: number;
  audioDurationMs?: number;
  totalWallMs?: number;
  chunkCount?: number;
  windowCount?: number;
  streamingUsed?: boolean;
  rtf?: number;
  realTimeFactor?: number;
  rawPcmStats?: SeslenPcmStats;
  playedPcmStats?: SeslenPcmStats;
  wavFile?: string;
  memory?: SeslenMemoryStats;
  logs?: string[];
  error?: string;
}

interface EmaLightningTtsPluginContract {
  getStatus(): Promise<Omit<EmaStatusResult, 'platform' | 'isNativeAndroid' | 'pluginAvailable'>>;
  verifyModelIntegrity(): Promise<SeslenIntegrityResult>;
  downloadModel(): Promise<{ ok: boolean; percent?: number; wifiRequired?: boolean; error?: string }>;
  cancelDownload(): Promise<{ ok: boolean }>;
  verifyInferenceContract(params: { text?: string }): Promise<EmaContractVerificationResult>;
  speakTest(params: { text: string; rate?: number; seed?: number; volume?: number }): Promise<EmaSpeakTestResult>;
  speak(params: {
    text: string;
    utteranceId: string;
    rate?: number;
    seed?: number;
    volume?: number;
  }): Promise<{
    ok: boolean;
    utteranceId?: string;
    engineUsed?: string;
    antaliaUsed?: boolean;
    modelMissing?: boolean;
    error?: string;
  }>;
  pause(): Promise<{ ok: boolean }>;
  resume(): Promise<{ ok: boolean; utteranceId?: string }>;
  stop(): Promise<{ ok: boolean }>;
  replayLastTestWav(params: { volume?: number }): Promise<{ ok: boolean; playedPcmStats?: SeslenPcmStats; logs?: string[]; error?: string }>;
  stopTest(): Promise<{ ok: boolean }>;
  addListener(
    eventName: 'emaDownloadProgress',
    listenerFunc: (event: SeslenDownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'emaDownloadError',
    listenerFunc: (event: { message: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'emaStart',
    listenerFunc: (event: { token: number; utteranceId?: string; firstAudioMs?: number; timeToFirstAudioMs?: number }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'emaMouth',
    listenerFunc: (event: { level: number; positionMs?: number; hfRatio?: number; utteranceId?: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'emaLog',
    listenerFunc: (event: { line: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'emaDone',
    listenerFunc: (event: EmaSpeakTestResult & { token: number; utteranceId?: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'emaError',
    listenerFunc: (event: { token: number; utteranceId?: string; message: string }) => void
  ): Promise<PluginListenerHandle>;
}

const EmaLightningTts = registerPlugin<EmaLightningTtsPluginContract>('EmaLightningTts');

export function isEmaLightningPluginAvailable(): boolean {
  try {
    return (
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === 'android' &&
      Capacitor.isPluginAvailable('EmaLightningTts')
    );
  } catch {
    return false;
  }
}

export async function getEmaStatus(): Promise<EmaStatusResult> {
  const platform = (() => {
    try {
      return Capacitor.getPlatform();
    } catch {
      return 'web';
    }
  })();

  const isAndroid = (() => {
    try {
      return Capacitor.isNativePlatform() && platform === 'android';
    } catch {
      return false;
    }
  })();

  if (!isAndroid || !Capacitor.isPluginAvailable('EmaLightningTts')) {
    return {
      platform,
      isNativeAndroid: isAndroid,
      pluginAvailable: false,
      modelInstalled: false,
      isDownloading: false,
      wifiConnected: false,
      downloadedBytes: 0,
      totalBytes: EMA_LIGHTNING_MODEL_METADATA.totalBytes,
      percent: 0,
      storagePath: null,
      sessionsLoaded: false,
      hasLastTestWav: false,
      sampleRate: 48000,
      files: [],
      memory: null,
      logs: [],
    };
  }

  const raw = await EmaLightningTts.getStatus();
  return {
    ...raw,
    platform,
    isNativeAndroid: true,
    pluginAvailable: true,
  };
}

export async function downloadEmaModel(): Promise<{
  ok: boolean;
  percent?: number;
  wifiRequired?: boolean;
  error?: string;
}> {
  if (!isEmaLightningPluginAvailable()) {
    return {
      ok: false,
      error: 'EmaLightningTts yalnızca Android APK (Redmi Note 10T 5G) üzerinde çalışır.',
    };
  }
  return EmaLightningTts.downloadModel();
}

export async function cancelEmaDownload(): Promise<void> {
  if (!isEmaLightningPluginAvailable()) return;
  await EmaLightningTts.cancelDownload();
}

export async function verifyEmaModelIntegrity(): Promise<SeslenIntegrityResult> {
  if (!isEmaLightningPluginAvailable()) {
    return {
      ok: false,
      files: [],
      error: 'EmaLightningTts yalnızca Android APK içinde doğrulanabilir.',
    };
  }
  return EmaLightningTts.verifyModelIntegrity();
}

export async function verifyEmaContract(text?: string): Promise<EmaContractVerificationResult> {
  if (!isEmaLightningPluginAvailable()) {
    return {
      ok: false,
      error: 'EMA Lightning ONNX kontrat doğrulaması yalnızca Android APK içinde çalıştırılabilir.',
    };
  }
  return EmaLightningTts.verifyInferenceContract({ text });
}

export async function speakEmaTest(params: {
  text: string;
  rate?: number;
  seed?: number;
  volume?: number;
}): Promise<EmaSpeakTestResult> {
  if (!isEmaLightningPluginAvailable()) {
    return {
      ok: false,
      error: 'EMA Lightning testi yalnızca Android APK içinde çalıştırılabilir.',
    };
  }
  return EmaLightningTts.speakTest(params);
}

export async function replayLastEmaWav(volume = 0.95): Promise<{
  ok: boolean;
  playedPcmStats?: SeslenPcmStats;
  logs?: string[];
  error?: string;
}> {
  if (!isEmaLightningPluginAvailable()) {
    return { ok: false, error: 'Yalnızca Android APK içinde kullanılabilir.' };
  }
  return EmaLightningTts.replayLastTestWav({ volume });
}

export async function speakEmaQueue(params: {
  text: string;
  utteranceId: string;
  rate?: number;
  seed?: number;
  volume?: number;
}): Promise<{
  ok: boolean;
  utteranceId?: string;
  engineUsed?: string;
  antaliaUsed?: boolean;
  modelMissing?: boolean;
  error?: string;
}> {
  if (!isEmaLightningPluginAvailable()) {
    return {
      ok: false,
      utteranceId: params.utteranceId,
      antaliaUsed: false,
      error: 'EMA Lightning eklentisi yalnızca Android APK üzerinde çalışır.',
    };
  }
  return EmaLightningTts.speak(params);
}

export async function pauseEmaQueue(): Promise<void> {
  if (!isEmaLightningPluginAvailable()) return;
  try {
    await EmaLightningTts.pause();
  } catch {
    // ignore
  }
}

export async function resumeEmaQueue(): Promise<{ ok: boolean; utteranceId?: string }> {
  if (!isEmaLightningPluginAvailable()) return { ok: false };
  try {
    return await EmaLightningTts.resume();
  } catch {
    return { ok: false };
  }
}

export async function stopEmaQueue(): Promise<void> {
  if (!isEmaLightningPluginAvailable()) return;
  try {
    await EmaLightningTts.stop();
  } catch {
    // ignore
  }
}

export async function stopEmaTest(): Promise<void> {
  if (!isEmaLightningPluginAvailable()) return;
  await EmaLightningTts.stopTest();
}

export async function subscribeEmaEvents(handlers: {
  onDownloadProgress?: (ev: SeslenDownloadProgressEvent) => void;
  onDownloadError?: (ev: { message: string }) => void;
  onStart?: (ev: { token: number; utteranceId?: string; firstAudioMs?: number; timeToFirstAudioMs?: number }) => void;
  onMouth?: (ev: { level: number; positionMs?: number; hfRatio?: number; utteranceId?: string }) => void;
  onLog?: (ev: { line: string }) => void;
  onDone?: (ev: EmaSpeakTestResult & { token: number; utteranceId?: string }) => void;
  onError?: (ev: { token: number; utteranceId?: string; message: string }) => void;
}): Promise<() => void> {
  if (!isEmaLightningPluginAvailable()) {
    return () => {};
  }

  const handles: PluginListenerHandle[] = [];
  if (handlers.onDownloadProgress) {
    handles.push(await EmaLightningTts.addListener('emaDownloadProgress', handlers.onDownloadProgress));
  }
  if (handlers.onDownloadError) {
    handles.push(await EmaLightningTts.addListener('emaDownloadError', handlers.onDownloadError));
  }
  if (handlers.onStart) {
    handles.push(await EmaLightningTts.addListener('emaStart', handlers.onStart));
  }
  if (handlers.onMouth) {
    handles.push(await EmaLightningTts.addListener('emaMouth', handlers.onMouth));
  }
  if (handlers.onLog) {
    handles.push(await EmaLightningTts.addListener('emaLog', handlers.onLog));
  }
  if (handlers.onDone) {
    handles.push(await EmaLightningTts.addListener('emaDone', handlers.onDone));
  }
  if (handlers.onError) {
    handles.push(await EmaLightningTts.addListener('emaError', handlers.onError));
  }

  return () => {
    handles.forEach((h) => {
      h.remove().catch(() => {
        // ignore
      });
    });
  };
}
