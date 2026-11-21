import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { isNativeAndroidEnvironment } from './nativeAndroidTtsBridge';

export interface NativeAudioPlayParams {
  url: string;
  playbackId: string;
  volume?: number;
  expectedSha256?: string;
}

export interface NativeAudioStartEvent {
  playbackId: string;
  durationMs: number;
}

export interface NativeAudioProgressEvent {
  playbackId: string;
  positionMs: number;
  durationMs: number;
  level: number;
}

export interface NativeAudioDoneEvent {
  playbackId: string;
  durationMs: number;
  positionMs?: number;
}

export interface NativeAudioErrorEvent {
  playbackId: string;
  what?: number;
  extra?: number;
  message: string;
}

export interface NativeAudioStatus {
  playing: boolean;
  paused: boolean;
  playbackId: string | null;
  positionMs: number;
  durationMs: number;
}

export interface NurIDuaAudioPlugin {
  play(params: NativeAudioPlayParams): Promise<{ ok: boolean; playbackId: string; error?: string }>;
  pause(): Promise<{ ok: boolean; playbackId?: string; positionMs?: number; error?: string }>;
  resume(): Promise<{ ok: boolean; playbackId?: string; error?: string }>;
  stop(): Promise<{ ok: boolean }>;
  getStatus(): Promise<NativeAudioStatus>;
  addListener(
    eventName: 'audioStart',
    listenerFunc: (event: NativeAudioStartEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'audioProgress',
    listenerFunc: (event: NativeAudioProgressEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'audioDone',
    listenerFunc: (event: NativeAudioDoneEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'audioError',
    listenerFunc: (event: NativeAudioErrorEvent) => void
  ): Promise<PluginListenerHandle>;
}

const NurIDuaAudio = registerPlugin<NurIDuaAudioPlugin>('NurIDuaAudio');

export function isNativeArabicAudioPluginAvailable(): boolean {
  try {
    return isNativeAndroidEnvironment() && Capacitor.isPluginAvailable('NurIDuaAudio');
  } catch {
    return false;
  }
}

export async function playNativeArabicAudio(
  params: NativeAudioPlayParams
): Promise<{ ok: boolean; playbackId: string; error?: string }> {
  if (!isNativeArabicAudioPluginAvailable()) {
    return {
      ok: false,
      playbackId: params.playbackId,
      error: 'NurIDuaAudio yerel eklentisi bu ortamda kullanılamıyor.',
    };
  }
  return NurIDuaAudio.play(params);
}

export async function pauseNativeArabicAudio(): Promise<void> {
  if (!isNativeArabicAudioPluginAvailable()) return;
  try {
    await NurIDuaAudio.pause();
  } catch {
    // ignore
  }
}

export async function resumeNativeArabicAudio(): Promise<{ ok: boolean; error?: string }> {
  if (!isNativeArabicAudioPluginAvailable()) {
    return { ok: false, error: 'NurIDuaAudio yerel eklentisi kullanılamıyor.' };
  }
  try {
    return await NurIDuaAudio.resume();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Yerel Arapça ses kaydı devam ettirilemedi.',
    };
  }
}

export async function stopNativeArabicAudio(): Promise<void> {
  if (!isNativeArabicAudioPluginAvailable()) return;
  try {
    await NurIDuaAudio.stop();
  } catch {
    // ignore
  }
}

export async function getNativeArabicAudioStatus(): Promise<NativeAudioStatus | null> {
  if (!isNativeArabicAudioPluginAvailable()) return null;
  try {
    return await NurIDuaAudio.getStatus();
  } catch {
    return null;
  }
}

export async function subscribeNativeArabicAudioEvents(handlers: {
  onStart?: (event: NativeAudioStartEvent) => void;
  onProgress?: (event: NativeAudioProgressEvent) => void;
  onDone?: (event: NativeAudioDoneEvent) => void;
  onError?: (event: NativeAudioErrorEvent) => void;
}): Promise<() => void> {
  if (!isNativeArabicAudioPluginAvailable()) {
    return () => {};
  }

  const handles: PluginListenerHandle[] = [];
  if (handlers.onStart) {
    handles.push(await NurIDuaAudio.addListener('audioStart', handlers.onStart));
  }
  if (handlers.onProgress) {
    handles.push(await NurIDuaAudio.addListener('audioProgress', handlers.onProgress));
  }
  if (handlers.onDone) {
    handles.push(await NurIDuaAudio.addListener('audioDone', handlers.onDone));
  }
  if (handlers.onError) {
    handles.push(await NurIDuaAudio.addListener('audioError', handlers.onError));
  }

  return () => {
    handles.forEach((h) => {
      h.remove().catch(() => {
        // ignore
      });
    });
  };
}
