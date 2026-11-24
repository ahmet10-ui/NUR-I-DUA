import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { ZERRE_TOTAL_BYTES } from './zerreTextFrontend';

export interface ZerreModelFileStatus {
  fileName: string;
  exists: boolean;
  actualBytes: number;
  expectedBytes: number;
  sizeMatched: boolean;
}

export interface ZerreMemoryStats {
  jvmUsedMb: number;
  jvmMaxMb: number;
  nativeHeapMb: number;
  systemAvailMb?: number;
  systemTotalMb?: number;
  isLowMemory?: boolean;
}

export interface ZerrePcmStats {
  sampleRate: number;
  channels: number;
  encoding: string;
  sampleCount: number;
  durationMs: number;
  min: number;
  max: number;
  peak: number;
  rms: number;
  dcOffset: number;
  nanOrInfCount: number;
}

export interface ZerreStatusResult {
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
  sessionLoaded: boolean;
  hasLastTestWav?: boolean;
  voiceLabel?: string;
  sampleRate?: number;
  files: ZerreModelFileStatus[];
  memory: ZerreMemoryStats | null;
  logs?: string[];
}

export interface ZerreDownloadProgressEvent {
  phase: 'downloading' | 'verifying' | 'ready';
  currentFile: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface ZerreIntegrityFileResult {
  fileName: string;
  expectedBytes: number;
  actualBytes: number;
  expectedSha256: string;
  actualSha256: string | null;
  valid: boolean;
  error?: string;
}

export interface ZerreIntegrityResult {
  ok: boolean;
  files: ZerreIntegrityFileResult[];
  logs?: string[];
  error?: string;
}

export interface ZerreTensorMeta {
  type?: string;
  shape?: number[];
}

export interface ZerreContractVerificationResult {
  ok: boolean;
  voiceSelected?: string;
  voiceIndex?: number;
  sampleRate?: number;
  symbolCount?: number;
  lexiconWordCount?: number;
  tokensLength?: number;
  inputs?: Record<string, ZerreTensorMeta>;
  outputs?: Record<string, ZerreTensorMeta>;
  memory?: ZerreMemoryStats;
  logs?: string[];
  error?: string;
}

export interface ZerreSpeakTestResult {
  ok: boolean;
  cancelled?: boolean;
  engineUsed?: string;
  voiceSelected?: string;
  voiceIndex?: number;
  antaliaUsed?: boolean;
  modelLoadMs?: number;
  phonemizeMs?: number;
  timeToFirstAudioMs?: number;
  synthesisMs?: number;
  audioDurationMs?: number;
  totalWallMs?: number;
  chunkCount?: number;
  streamingUsed?: boolean;
  rtf?: number;
  rawPcmStats?: ZerrePcmStats;
  playedPcmStats?: ZerrePcmStats;
  wavFile?: string;
  memory?: ZerreMemoryStats;
  logs?: string[];
  error?: string;
}

interface ZerreTtsPluginContract {
  getStatus(): Promise<Omit<ZerreStatusResult, 'platform' | 'isNativeAndroid' | 'pluginAvailable'>>;
  verifyModelIntegrity(): Promise<ZerreIntegrityResult>;
  downloadModel(): Promise<{ ok: boolean; percent?: number; wifiRequired?: boolean; error?: string }>;
  cancelDownload(): Promise<{ ok: boolean }>;
  verifyInferenceContract(params: { text?: string }): Promise<ZerreContractVerificationResult>;
  speakTest(params: { text: string; rate?: number; volume?: number }): Promise<ZerreSpeakTestResult>;
  speak(params: {
    text: string;
    utteranceId: string;
    rate?: number;
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
  replayLastTestWav(params: { volume?: number }): Promise<{ ok: boolean; playedPcmStats?: ZerrePcmStats; logs?: string[]; error?: string }>;
  stopTest(): Promise<{ ok: boolean }>;
  addListener(
    eventName: 'zerreDownloadProgress',
    listenerFunc: (event: ZerreDownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'zerreDownloadError',
    listenerFunc: (event: { message: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'zerreStart',
    listenerFunc: (event: { token: number; utteranceId?: string; timeToFirstAudioMs?: number }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'zerreMouth',
    listenerFunc: (event: { level: number; positionMs?: number; hfRatio?: number; utteranceId?: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'zerreLog',
    listenerFunc: (event: { line: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'zerreDone',
    listenerFunc: (event: ZerreSpeakTestResult & { token: number; utteranceId?: string; totalWallMs?: number }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'zerreError',
    listenerFunc: (event: { token: number; utteranceId?: string; message: string }) => void
  ): Promise<PluginListenerHandle>;
}

const ZerreTts = registerPlugin<ZerreTtsPluginContract>('ZerreTts');

export function isZerrePluginAvailable(): boolean {
  try {
    return (
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === 'android' &&
      Capacitor.isPluginAvailable('ZerreTts')
    );
  } catch {
    return false;
  }
}

export async function getZerreStatus(): Promise<ZerreStatusResult> {
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

  if (!isAndroid || !Capacitor.isPluginAvailable('ZerreTts')) {
    return {
      platform,
      isNativeAndroid: isAndroid,
      pluginAvailable: false,
      modelInstalled: false,
      isDownloading: false,
      wifiConnected: false,
      downloadedBytes: 0,
      totalBytes: ZERRE_TOTAL_BYTES,
      percent: 0,
      storagePath: null,
      sessionLoaded: false,
      hasLastTestWav: false,
      voiceLabel: 'SES-A (MK)',
      sampleRate: 24000,
      files: [],
      memory: null,
      logs: [],
    };
  }

  const raw = await ZerreTts.getStatus();
  return {
    ...raw,
    platform,
    isNativeAndroid: true,
    pluginAvailable: true,
  };
}

export async function downloadZerreModel(): Promise<{
  ok: boolean;
  percent?: number;
  wifiRequired?: boolean;
  error?: string;
}> {
  if (!isZerrePluginAvailable()) {
    return {
      ok: false,
      error: 'Zerre SES-A (MK) eklentisi yalnızca Android APK (Redmi Note 10T 5G) üzerinde çalışır.',
    };
  }
  return ZerreTts.downloadModel();
}

export async function cancelZerreDownload(): Promise<void> {
  if (!isZerrePluginAvailable()) return;
  await ZerreTts.cancelDownload();
}

export async function verifyZerreModelIntegrity(): Promise<ZerreIntegrityResult> {
  if (!isZerrePluginAvailable()) {
    return {
      ok: false,
      files: [],
      error: 'Zerre SES-A (MK) yalnızca Android APK içinde doğrulanabilir.',
    };
  }
  return ZerreTts.verifyModelIntegrity();
}

export async function verifyZerreContract(
  text?: string
): Promise<ZerreContractVerificationResult> {
  if (!isZerrePluginAvailable()) {
    return {
      ok: false,
      error: 'Zerre ONNX kontrat doğrulaması yalnızca Android APK içinde çalıştırılabilir.',
    };
  }
  return ZerreTts.verifyInferenceContract({ text });
}

export async function speakZerreTest(params: {
  text: string;
  rate?: number;
  volume?: number;
}): Promise<ZerreSpeakTestResult> {
  if (!isZerrePluginAvailable()) {
    return {
      ok: false,
      error: 'Zerre SES-A (MK) testi yalnızca Android APK içinde çalıştırılabilir.',
    };
  }
  return ZerreTts.speakTest(params);
}

export async function replayLastZerreWav(volume = 0.95): Promise<{
  ok: boolean;
  playedPcmStats?: ZerrePcmStats;
  logs?: string[];
  error?: string;
}> {
  if (!isZerrePluginAvailable()) {
    return { ok: false, error: 'Yalnızca Android APK içinde kullanılabilir.' };
  }
  return ZerreTts.replayLastTestWav({ volume });
}

export async function speakZerreQueue(params: {
  text: string;
  utteranceId: string;
  rate?: number;
  volume?: number;
}): Promise<{
  ok: boolean;
  utteranceId?: string;
  engineUsed?: string;
  antaliaUsed?: boolean;
  modelMissing?: boolean;
  error?: string;
}> {
  if (!isZerrePluginAvailable()) {
    return {
      ok: false,
      utteranceId: params.utteranceId,
      antaliaUsed: false,
      error:
        'Zerre SES-A (MK) eklentisi yalnızca Android APK üzerinde çalışır; Antalia-2 Mini motoruna geçilmedi.',
    };
  }
  return ZerreTts.speak(params);
}

export async function pauseZerreQueue(): Promise<void> {
  if (!isZerrePluginAvailable()) return;
  try {
    await ZerreTts.pause();
  } catch {
    // ignore
  }
}

export async function resumeZerreQueue(): Promise<{ ok: boolean; utteranceId?: string }> {
  if (!isZerrePluginAvailable()) return { ok: false };
  try {
    return await ZerreTts.resume();
  } catch {
    return { ok: false };
  }
}

export async function stopZerreQueue(): Promise<void> {
  if (!isZerrePluginAvailable()) return;
  try {
    await ZerreTts.stop();
  } catch {
    // ignore
  }
}

export async function stopZerreTest(): Promise<void> {
  if (!isZerrePluginAvailable()) return;
  await ZerreTts.stopTest();
}

export async function subscribeZerreEvents(handlers: {
  onDownloadProgress?: (ev: ZerreDownloadProgressEvent) => void;
  onDownloadError?: (ev: { message: string }) => void;
  onStart?: (ev: { token: number; utteranceId?: string; timeToFirstAudioMs?: number }) => void;
  onMouth?: (ev: { level: number; positionMs?: number; hfRatio?: number; utteranceId?: string }) => void;
  onLog?: (ev: { line: string }) => void;
  onDone?: (ev: ZerreSpeakTestResult & { token: number; utteranceId?: string; totalWallMs?: number }) => void;
  onError?: (ev: { token: number; utteranceId?: string; message: string }) => void;
}): Promise<() => void> {
  if (!isZerrePluginAvailable()) {
    return () => {};
  }

  const handles: PluginListenerHandle[] = [];
  if (handlers.onDownloadProgress) {
    handles.push(await ZerreTts.addListener('zerreDownloadProgress', handlers.onDownloadProgress));
  }
  if (handlers.onDownloadError) {
    handles.push(await ZerreTts.addListener('zerreDownloadError', handlers.onDownloadError));
  }
  if (handlers.onStart) {
    handles.push(await ZerreTts.addListener('zerreStart', handlers.onStart));
  }
  if (handlers.onMouth) {
    handles.push(await ZerreTts.addListener('zerreMouth', handlers.onMouth));
  }
  if (handlers.onLog) {
    handles.push(await ZerreTts.addListener('zerreLog', handlers.onLog));
  }
  if (handlers.onDone) {
    handles.push(await ZerreTts.addListener('zerreDone', handlers.onDone));
  }
  if (handlers.onError) {
    handles.push(await ZerreTts.addListener('zerreError', handlers.onError));
  }

  return () => {
    handles.forEach((h) => {
      h.remove().catch(() => {
        // ignore
      });
    });
  };
}
