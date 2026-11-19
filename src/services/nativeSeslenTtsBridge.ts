import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';

export interface SeslenMemoryStats {
  jvmUsedMb: number;
  jvmMaxMb: number;
  nativeHeapMb: number;
  systemAvailMb?: number;
  systemTotalMb?: number;
  isLowMemory?: boolean;
}

export interface SeslenModelFileStatus {
  fileName: string;
  exists: boolean;
  actualBytes: number;
  expectedBytes: number;
  sizeMatched: boolean;
}

export interface SeslenStyleVerification {
  speakerKey?: string;
  dim?: number;
  npyHeader?: string;
  refHead?: string;
  styleHead?: string;
  l2Norm?: number;
  matchesExpectedHasan?: boolean;
}

export interface SeslenPcmStats {
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

export interface SeslenStatusResult {
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
  hasOfficialSampleWav?: boolean;
  files: SeslenModelFileStatus[];
  memory: SeslenMemoryStats | null;
  logs?: string[];
}

export interface SeslenDownloadProgressEvent {
  phase: 'downloading' | 'verifying' | 'ready';
  currentFile: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface SeslenIntegrityFileResult {
  fileName: string;
  expectedBytes: number;
  actualBytes: number;
  expectedSha256: string;
  actualSha256: string | null;
  valid: boolean;
  error?: string;
}

export interface SeslenIntegrityResult {
  ok: boolean;
  files: SeslenIntegrityFileResult[];
  logs?: string[];
  error?: string;
}

export interface SeslenTensorMeta {
  type?: string;
  shape?: number[];
}

export interface SeslenContractVerificationResult {
  ok: boolean;
  styleDim?: number;
  styleVerification?: SeslenStyleVerification;
  pythonOkunus?: string;
  tokenLengthL?: number;
  chunkCount?: number;
  metinInputs?: Record<string, SeslenTensorMeta>;
  metinOutputs?: Record<string, SeslenTensorMeta>;
  sesInputs?: Record<string, SeslenTensorMeta>;
  sesOutputs?: Record<string, SeslenTensorMeta>;
  memory?: SeslenMemoryStats;
  logs?: string[];
  error?: string;
}

export interface SeslenSpeakTestResult {
  ok: boolean;
  cancelled?: boolean;
  engineUsed?: string;
  antaliaUsed?: boolean;
  synthesisMs?: number;
  audioDurationMs?: number;
  rtf?: number;
  styleVerification?: SeslenStyleVerification;
  rawPcmStats?: SeslenPcmStats;
  playedPcmStats?: SeslenPcmStats;
  wavFile?: string;
  memory?: SeslenMemoryStats;
  logs?: string[];
  error?: string;
}

interface SeslenLocalTtsPluginContract {
  getStatus(): Promise<Omit<SeslenStatusResult, 'platform' | 'isNativeAndroid' | 'pluginAvailable'>>;
  verifyModelIntegrity(): Promise<SeslenIntegrityResult>;
  downloadModel(): Promise<{ ok: boolean; percent?: number; wifiRequired?: boolean; error?: string }>;
  cancelDownload(): Promise<{ ok: boolean }>;
  verifyInferenceContract(params: { text?: string }): Promise<SeslenContractVerificationResult>;
  speakTest(params: { text: string; rate?: number; volume?: number }): Promise<SeslenSpeakTestResult>;
  replayLastTestWav(params: { volume?: number }): Promise<{ ok: boolean; playedPcmStats?: SeslenPcmStats; logs?: string[]; error?: string }>;
  playOfficialHasanSample(params: { volume?: number }): Promise<{ ok: boolean; officialSampleStats?: SeslenPcmStats; logs?: string[]; error?: string }>;
  stopTest(): Promise<{ ok: boolean }>;
  addListener(
    eventName: 'seslenDownloadProgress',
    listenerFunc: (event: SeslenDownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'seslenDownloadError',
    listenerFunc: (event: { message: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'seslenStart',
    listenerFunc: (event: { token: number }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'seslenMouth',
    listenerFunc: (event: { level: number }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'seslenLog',
    listenerFunc: (event: { line: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'seslenDone',
    listenerFunc: (event: SeslenSpeakTestResult & { token: number; totalWallMs?: number }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'seslenError',
    listenerFunc: (event: { token: number; message: string }) => void
  ): Promise<PluginListenerHandle>;
}

const SeslenLocalTts = registerPlugin<SeslenLocalTtsPluginContract>('SeslenLocalTts');

export function isSeslenLocalPluginAvailable(): boolean {
  try {
    return (
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === 'android' &&
      Capacitor.isPluginAvailable('SeslenLocalTts')
    );
  } catch {
    return false;
  }
}

export async function getSeslenStatus(): Promise<SeslenStatusResult> {
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

  if (!isAndroid || !Capacitor.isPluginAvailable('SeslenLocalTts')) {
    return {
      platform,
      isNativeAndroid: isAndroid,
      pluginAvailable: false,
      modelInstalled: false,
      isDownloading: false,
      wifiConnected: false,
      downloadedBytes: 0,
      totalBytes: 325739036,
      percent: 0,
      storagePath: null,
      sessionsLoaded: false,
      hasLastTestWav: false,
      hasOfficialSampleWav: false,
      files: [],
      memory: null,
      logs: [],
    };
  }

  const raw = await SeslenLocalTts.getStatus();
  return {
    ...raw,
    platform,
    isNativeAndroid: true,
    pluginAvailable: true,
  };
}

export async function downloadSeslenModel(): Promise<{
  ok: boolean;
  percent?: number;
  wifiRequired?: boolean;
  error?: string;
}> {
  if (!isSeslenLocalPluginAvailable()) {
    return {
      ok: false,
      error: 'SeslenLocalTts yalnızca Android APK (Redmi Note 10T 5G) üzerinde çalışır.',
    };
  }
  return SeslenLocalTts.downloadModel();
}

export async function cancelSeslenDownload(): Promise<void> {
  if (!isSeslenLocalPluginAvailable()) return;
  await SeslenLocalTts.cancelDownload();
}

export async function verifySeslenModelIntegrity(): Promise<SeslenIntegrityResult> {
  if (!isSeslenLocalPluginAvailable()) {
    return {
      ok: false,
      files: [],
      error: 'SeslenLocalTts yalnızca Android APK içinde doğrulanabilir.',
    };
  }
  return SeslenLocalTts.verifyModelIntegrity();
}

export async function verifySeslenContract(
  text?: string
): Promise<SeslenContractVerificationResult> {
  if (!isSeslenLocalPluginAvailable()) {
    return {
      ok: false,
      error: 'ONNX kontrat doğrulaması yalnızca Android APK içinde çalıştırılabilir.',
    };
  }
  return SeslenLocalTts.verifyInferenceContract({ text });
}

export async function speakSeslenTest(params: {
  text: string;
  rate?: number;
  volume?: number;
}): Promise<SeslenSpeakTestResult> {
  if (!isSeslenLocalPluginAvailable()) {
    return {
      ok: false,
      error: 'Seslen Hasan testi yalnızca Android APK içinde çalıştırılabilir.',
    };
  }
  return SeslenLocalTts.speakTest(params);
}

export async function replayLastSeslenWav(volume = 0.95): Promise<{
  ok: boolean;
  playedPcmStats?: SeslenPcmStats;
  logs?: string[];
  error?: string;
}> {
  if (!isSeslenLocalPluginAvailable()) {
    return { ok: false, error: 'Yalnızca Android APK içinde kullanılabilir.' };
  }
  return SeslenLocalTts.replayLastTestWav({ volume });
}

export async function playOfficialHasanSample(volume = 0.95): Promise<{
  ok: boolean;
  officialSampleStats?: SeslenPcmStats;
  logs?: string[];
  error?: string;
}> {
  if (!isSeslenLocalPluginAvailable()) {
    return { ok: false, error: 'Yalnızca Android APK içinde kullanılabilir.' };
  }
  return SeslenLocalTts.playOfficialHasanSample({ volume });
}

export async function stopSeslenTest(): Promise<void> {
  if (!isSeslenLocalPluginAvailable()) return;
  await SeslenLocalTts.stopTest();
}

export async function subscribeSeslenEvents(handlers: {
  onDownloadProgress?: (ev: SeslenDownloadProgressEvent) => void;
  onDownloadError?: (ev: { message: string }) => void;
  onStart?: (ev: { token: number }) => void;
  onMouth?: (ev: { level: number }) => void;
  onLog?: (ev: { line: string }) => void;
  onDone?: (ev: SeslenSpeakTestResult & { token: number; totalWallMs?: number }) => void;
  onError?: (ev: { token: number; message: string }) => void;
}): Promise<() => void> {
  if (!isSeslenLocalPluginAvailable()) {
    return () => {};
  }

  const handles: PluginListenerHandle[] = [];
  if (handlers.onDownloadProgress) {
    handles.push(
      await SeslenLocalTts.addListener('seslenDownloadProgress', handlers.onDownloadProgress)
    );
  }
  if (handlers.onDownloadError) {
    handles.push(
      await SeslenLocalTts.addListener('seslenDownloadError', handlers.onDownloadError)
    );
  }
  if (handlers.onStart) {
    handles.push(await SeslenLocalTts.addListener('seslenStart', handlers.onStart));
  }
  if (handlers.onMouth) {
    handles.push(await SeslenLocalTts.addListener('seslenMouth', handlers.onMouth));
  }
  if (handlers.onLog) {
    handles.push(await SeslenLocalTts.addListener('seslenLog', handlers.onLog));
  }
  if (handlers.onDone) {
    handles.push(await SeslenLocalTts.addListener('seslenDone', handlers.onDone));
  }
  if (handlers.onError) {
    handles.push(await SeslenLocalTts.addListener('seslenError', handlers.onError));
  }

  return () => {
    handles.forEach((h) => {
      h.remove().catch(() => {
        // ignore
      });
    });
  };
}
