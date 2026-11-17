import {
  ITTSProvider,
  NeuralTTSProviderId,
  ScholarId,
  TTSProviderType,
  TTSSpeakOptions,
} from '../types/nuridua';
import {
  isNativeTtsPluginAvailable,
  pauseNativeAndroid,
  resumeNativeAndroid,
  speakNativeAndroid,
  stopNativeAndroid,
  subscribeNativeAndroidTtsEvents,
} from './nativeAndroidTtsBridge';

export interface AvailableVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  isDefault: boolean;
  isTurkish: boolean;
  genderHint: 'male' | 'female' | 'unknown';
  qualityHint: 'natural-online' | 'standard';
  rankScore: number;
}

export interface ResolvedSystemVoice {
  voice: SpeechSynthesisVoice | undefined;
  mode: 'explicit' | 'os-default-tr' | 'single-tr' | 'os-lang-delegated';
  name: string;
  lang: string;
  localService: boolean | null;
  isDefault: boolean;
}

export interface ServerTTSProviderStatus {
  id: NeuralTTSProviderId;
  label: string;
  requiresPaidApi: boolean;
  configured: boolean;
  missingEnv: string[];
  notes: string;
}

export interface ServerNeuralVoicePreset {
  id: string;
  provider: NeuralTTSProviderId;
  name: string;
  lang: 'tr-TR';
  gender: 'male';
  description: string;
  recommendedFor: string;
  defaultRate: number;
  defaultPitchShift: string;
}

export interface ServerTTSStatusResponse {
  providers: ServerTTSProviderStatus[];
  voices: ServerNeuralVoicePreset[];
  anyConfigured: boolean;
}

const MALE_VOICE_HINTS = [
  'ahmet',
  'tolga',
  'cem',
  'kerem',
  'mehmet',
  'mustafa',
  'yusuf',
  'ali',
  'murat',
  'male',
  'erkek',
];

const FEMALE_VOICE_HINTS = [
  'emel',
  'yelda',
  'seda',
  'filiz',
  'aylin',
  'zeynep',
  'female',
  'kadin',
];

export function isTurkishLangTag(lang: string | undefined): boolean {
  if (!lang) return false;
  const normalized = lang.trim().toLowerCase().replace(/_/g, '-');
  return normalized === 'tr' || normalized.startsWith('tr-') || normalized === 'tur';
}

function classifyVoice(v: SpeechSynthesisVoice): AvailableVoice {
  const lowerName = v.name.toLowerCase();
  const isTurkish = isTurkishLangTag(v.lang);

  let genderHint: AvailableVoice['genderHint'] = 'unknown';
  if (MALE_VOICE_HINTS.some((k) => lowerName.includes(k))) {
    genderHint = 'male';
  } else if (FEMALE_VOICE_HINTS.some((k) => lowerName.includes(k))) {
    genderHint = 'female';
  }

  const qualityHint: AvailableVoice['qualityHint'] =
    lowerName.includes('natural') || lowerName.includes('online') || lowerName.includes('neural')
      ? 'natural-online'
      : 'standard';

  // Respect the OS/Android default voice and local on-device engines without forcing any fixed vendor.
  let rankScore = 0;
  if (isTurkish) rankScore += 100;
  if (v.default) rankScore += 60;
  if (v.localService) rankScore += 20;
  if (genderHint === 'male') rankScore += 10;

  return {
    voiceURI: v.voiceURI,
    name: v.name,
    lang: v.lang,
    localService: v.localService,
    isDefault: Boolean(v.default),
    isTurkish,
    genderHint,
    qualityHint,
    rankScore,
  };
}

export function getAvailableSpeechVoices(): AvailableVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [];
  }
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    return voices
      .map(classifyVoice)
      .sort((a, b) => {
        if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}

/**
 * Resolves the effective SpeechSynthesisVoice without forcing any fixed vendor (e.g. Google).
 * When the user leaves voice selection on automatic, Android's default Turkish voice (`default: true`)
 * is preferred, or `utterance.voice` is left undefined with `lang: 'tr-TR'` so the Android OS routes
 * directly to the user's preferred system TTS engine (such as Antalia-2 Mini).
 */
export function resolveTurkishSystemVoice(
  voices: SpeechSynthesisVoice[],
  preferredURI?: string,
  targetLang = 'tr-TR'
): ResolvedSystemVoice {
  if (preferredURI) {
    const exact = voices.find((v) => v.voiceURI === preferredURI);
    if (exact) {
      return {
        voice: exact,
        mode: 'explicit',
        name: exact.name,
        lang: exact.lang,
        localService: exact.localService,
        isDefault: Boolean(exact.default),
      };
    }
  }

  const turkishVoices = voices.filter((v) => isTurkishLangTag(v.lang));
  if (turkishVoices.length > 0) {
    const osDefault = turkishVoices.find((v) => v.default);
    if (osDefault) {
      return {
        voice: osDefault,
        mode: 'os-default-tr',
        name: osDefault.name,
        lang: osDefault.lang,
        localService: osDefault.localService,
        isDefault: true,
      };
    }

    if (turkishVoices.length === 1) {
      const only = turkishVoices[0];
      return {
        voice: only,
        mode: 'single-tr',
        name: only.name,
        lang: only.lang,
        localService: only.localService,
        isDefault: Boolean(only.default),
      };
    }
  }

  return {
    voice: undefined,
    mode: 'os-lang-delegated',
    name: 'Sistem Varsayılan Türkçe Motoru (Otomatik)',
    lang: targetLang || 'tr-TR',
    localService: null,
    isDefault: true,
  };
}

/**
 * Computes effective rate and pitch per scholar so the two scholars remain audibly distinct
 * using only real SpeechSynthesis prosody parameters (never fake voice IDs).
 */
export function getScholarProsody(
  baseRate: number,
  basePitch: number,
  scholarId: ScholarId
): { rate: number; pitch: number } {
  const clampRate = (v: number) => Math.min(1.4, Math.max(0.55, Number(v.toFixed(2))));
  const clampPitch = (v: number) => Math.min(1.4, Math.max(0.6, Number(v.toFixed(2))));

  if (scholarId === 'scholar_2') {
    return {
      rate: clampRate(baseRate + 0.03),
      pitch: clampPitch(basePitch - 0.05),
    };
  }
  return {
    rate: clampRate(baseRate),
    pitch: clampPitch(basePitch),
  };
}

/**
 * Splits exceptionally long texts (> 900 chars) at sentence boundaries so Android TTS stays responsive,
 * while keeping normal Turkish prayers in a single uninterrupted SpeechSynthesisUtterance.
 */
function splitLongTextIfNeeded(rawText: string): string[] {
  const normalized = rawText
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;!?])/g, '$1')
    .trim();

  if (!normalized) return [];
  if (normalized.length <= 900) return [normalized];

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const groups: string[] = [];
  let current = '';
  for (const s of sentences) {
    if (current && current.length + s.length + 1 > 750) {
      groups.push(current);
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current) groups.push(current);
  return groups;
}

/**
 * Browser SpeechSynthesis implementation of ITTSProvider.
 * Uses the device / Android system TTS engine via Web Speech API without forcing fixed vendors.
 * Note: SpeechSynthesis does not expose raw PCM audio data; mouth animation uses
 * utterance boundary events and an estimated speech-cadence envelope (not waveform analysis).
 */
export class BrowserSpeechSynthesisProvider implements ITTSProvider {
  readonly id: TTSProviderType = 'browser_speech_synthesis';
  readonly label = 'Cihaz / Android Sistem TTS Motoru (SpeechSynthesis)';
  readonly isStudioGrade = false;

  private activeTimer: number | null = null;
  private startDelayTimer: number | null = null;
  private safetyTimeout: number | null = null;
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private isPaused = false;
  private isSpeakingInternal = false;
  private pulseBoost = 0;
  private playbackToken = 0;

  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      'SpeechSynthesisUtterance' in window
    );
  }

  private clearTimers() {
    if (this.activeTimer !== null) {
      window.clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
    if (this.startDelayTimer !== null) {
      window.clearTimeout(this.startDelayTimer);
      this.startDelayTimer = null;
    }
    if (this.safetyTimeout !== null) {
      window.clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }
  }

  speak(text: string, options: TTSSpeakOptions): void {
    const hadActiveSpeech =
      this.isSpeakingInternal ||
      (this.isSupported() &&
        (window.speechSynthesis.speaking || window.speechSynthesis.pending));

    this.stop();
    const token = ++this.playbackToken;

    if (!this.isSupported()) {
      options.onError?.(
        'Bu tarayıcı veya WebView Web Speech API (speechSynthesis) desteğini sunmuyor.'
      );
      return;
    }

    const segments = splitLongTextIfNeeded(text);
    if (segments.length === 0) {
      options.onEnd?.();
      return;
    }

    const synth = window.speechSynthesis;
    const voices = synth.getVoices() || [];
    const resolved = resolveTurkishSystemVoice(
      voices,
      options.voiceURI,
      options.lang || 'tr-TR'
    );

    let finished = false;
    let startedNotified = false;
    const startTime = performance.now();

    const finish = (isErr = false, msg?: string) => {
      if (finished || this.playbackToken !== token) return;
      finished = true;
      this.isSpeakingInternal = false;
      this.activeUtterance = null;
      this.clearTimers();
      this.isPaused = false;
      options.onMouthLevel?.(0);
      if (isErr) {
        options.onError?.(msg || 'Sistem TTS konuşması kesintiye uğradı.');
      } else {
        options.onEnd?.();
      }
    };

    const ensureEstimatedLipSync = () => {
      if (!startedNotified) {
        startedNotified = true;
        options.onStart?.();
      }
      if (this.activeTimer === null) {
        this.activeTimer = window.setInterval(() => {
          if (this.playbackToken !== token || finished) return;
          if (this.isPaused || !this.isSpeakingInternal) {
            options.onMouthLevel?.(0);
            return;
          }
          const t = (performance.now() - startTime) / 1000;
          this.pulseBoost = Math.max(0, this.pulseBoost * 0.78);
          const syllableWave =
            0.22 +
            0.4 * Math.abs(Math.sin(t * 7.6 * options.rate)) +
            0.14 * Math.sin(t * 13.5);
          const level = Math.max(0.05, Math.min(1, syllableWave + this.pulseBoost * 0.32));
          options.onMouthLevel?.(level);
        }, 45);
      }
    };

    // Generous safety timeout so slow Android TTS voices never get cut off prematurely,
    // while preventing queue deadlock if an engine never fires onend.
    const maxDurationMs = Math.max(
      25000,
      Math.min(90000, (text.length / Math.max(0.55, options.rate)) * 260)
    );
    this.safetyTimeout = window.setTimeout(() => {
      if (!finished && this.playbackToken === token) {
        try {
          synth.cancel();
        } catch {
          // ignore
        }
        finish(
          true,
          'Sistem TTS motoru zaman aşımına uğradı (onend olayı alınamadı).'
        );
      }
    }, maxDurationMs);

    const speakSegmentAt = (index: number) => {
      if (finished || this.playbackToken !== token) return;
      if (index >= segments.length) {
        finish(false);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(segments[index]);
      // Keep reference on instance so Chrome/Android GC cannot drop the utterance and lose `onend`
      this.activeUtterance = utterance;
      utterance.lang = options.lang || 'tr-TR';
      utterance.rate = Math.min(1.4, Math.max(0.55, options.rate));
      utterance.pitch = Math.min(1.4, Math.max(0.6, options.pitch));
      utterance.volume = Math.min(1, Math.max(0, options.volume));

      if (resolved.voice) {
        utterance.voice = resolved.voice;
      }

      utterance.onstart = () => {
        if (finished || this.playbackToken !== token) return;
        this.isSpeakingInternal = true;
        ensureEstimatedLipSync();
      };

      utterance.onboundary = () => {
        this.pulseBoost = 0.8;
      };

      utterance.onend = () => {
        if (finished || this.playbackToken !== token) return;
        if (index + 1 < segments.length) {
          // Chain synchronously inside onend so Android WebView preserves active session
          speakSegmentAt(index + 1);
          return;
        }
        finish(false);
      };

      utterance.onerror = (ev) => {
        if (this.playbackToken !== token) return;
        if (ev.error === 'interrupted' || ev.error === 'canceled') {
          finish(false);
          return;
        }
        if (ev.error === 'not-allowed') {
          finish(
            true,
            'Tarayıcı kullanıcı etkileşimi olmadan ses çalmayı engelledi (not-allowed). Ekrana dokunduktan sonra tekrar deneyin.'
          );
          return;
        }
        finish(true, `Sistem TTS hatası: ${ev.error}`);
      };

      try {
        if (synth.paused) synth.resume();
        this.isSpeakingInternal = true;
        synth.speak(utterance);
      } catch (err) {
        finish(
          true,
          err instanceof Error ? err.message : 'Sistem konuşma sentezi başlatılamadı.'
        );
      }
    };

    if (hadActiveSpeech) {
      // Short yield after synth.cancel() avoids Android Chrome dropping the subsequent speak() call
      this.startDelayTimer = window.setTimeout(() => {
        this.startDelayTimer = null;
        speakSegmentAt(0);
      }, 45);
    } else {
      speakSegmentAt(0);
    }
  }

  pause(): void {
    this.isPaused = true;
    if (this.isSupported()) {
      try {
        window.speechSynthesis.pause();
      } catch {
        // ignore on WebViews without pause support
      }
    }
  }

  resume(): void {
    this.isPaused = false;
    if (this.isSupported()) {
      try {
        window.speechSynthesis.resume();
      } catch {
        // ignore
      }
    }
  }

  stop(): void {
    this.playbackToken++;
    const shouldCancel =
      this.isSpeakingInternal ||
      (this.isSupported() &&
        (window.speechSynthesis.speaking || window.speechSynthesis.pending));
    this.isSpeakingInternal = false;
    this.activeUtterance = null;
    this.clearTimers();
    this.isPaused = false;
    if (shouldCancel && this.isSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }
}

export async function fetchServerTTSStatus(): Promise<ServerTTSStatusResponse> {
  const res = await fetch('/api/tts/status', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch server TTS status (${res.status})`);
  }
  return (await res.json()) as ServerTTSStatusResponse;
}

/**
 * Optional Server-backed Neural TTS provider implementing ITTSProvider.
 * Not required for normal operation; streams synthesized audio from `/api/tts/synthesize`
 * and drives 3D scholar lip-sync via Web Audio API AnalyserNode RMS amplitude measurement.
 */
export class ServerNeuralTTSProvider implements ITTSProvider {
  readonly id: TTSProviderType = 'external_studio_adapter';
  readonly label = 'İsteğe Bağlı Sunucu Neural TTS Adaptörü';
  readonly isStudioGrade = true;

  private abortController: AbortController | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId: number | null = null;
  private fallbackEnvelopeTimer: number | null = null;
  private isPaused = false;
  private playbackToken = 0;

  isSupported(): boolean {
    return typeof window !== 'undefined' && typeof fetch === 'function' && typeof Audio !== 'undefined';
  }

  private cleanupAudio(resetMouth?: (level: number) => void) {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.fallbackEnvelopeTimer !== null) {
      window.clearInterval(this.fallbackEnvelopeTimer);
      this.fallbackEnvelopeTimer = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // ignore
      }
      this.sourceNode = null;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        // ignore
      }
      this.analyser = null;
    }
    if (this.audioEl) {
      try {
        this.audioEl.pause();
        this.audioEl.removeAttribute('src');
        this.audioEl.load();
      } catch {
        // ignore
      }
      this.audioEl = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.isPaused = false;
    resetMouth?.(0);
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new Ctx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {
        // Handled gracefully
      });
    }
    return this.audioCtx;
  }

  speak(text: string, options: TTSSpeakOptions): void {
    this.stop();
    const token = ++this.playbackToken;

    if (!this.isSupported()) {
      options.onError?.('Tarayıcı sunucu ses çalmayı desteklemiyor.');
      return;
    }

    const controller = new AbortController();
    this.abortController = controller;

    const run = async () => {
      try {
        const res = await fetch('/api/tts/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text,
            provider: options.neuralProviderId || 'azure_neural',
            voiceId: options.neuralVoiceId,
            rate: options.rate,
            pitch: options.pitch,
            tone: options.tone || 'calm_elderly',
          }),
        });

        if (this.playbackToken !== token) return;

        if (!res.ok) {
          let errMessage = `Neural TTS request failed (HTTP ${res.status})`;
          try {
            const payload = (await res.json()) as { error?: string };
            if (payload?.error) errMessage = payload.error;
          } catch {
            // ignore non-JSON error
          }
          options.onError?.(errMessage);
          return;
        }

        const audioBlob = await res.blob();
        if (this.playbackToken !== token) return;
        if (!audioBlob || audioBlob.size === 0) {
          options.onError?.('Sunucu boş ses akışı döndürdü.');
          return;
        }

        const objectUrl = URL.createObjectURL(audioBlob);
        this.objectUrl = objectUrl;

        const audio = new Audio(objectUrl);
        audio.volume = Math.min(1, Math.max(0, options.volume));
        audio.playbackRate = 1.0;
        this.audioEl = audio;

        let finished = false;
        const complete = (isErr = false, msg?: string) => {
          if (finished || this.playbackToken !== token) return;
          finished = true;
          this.cleanupAudio(options.onMouthLevel);
          if (isErr) {
            options.onError?.(msg || 'Sunucu ses oynatımı başarısız oldu.');
          } else {
            options.onEnd?.();
          }
        };

        let analyserReady = false;
        try {
          const ctx = this.ensureAudioContext();
          if (ctx) {
            const source = ctx.createMediaElementSource(audio);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.65;
            source.connect(analyser);
            analyser.connect(ctx.destination);
            this.sourceNode = source;
            this.analyser = analyser;
            analyserReady = true;
          }
        } catch {
          analyserReady = false;
        }

        const dataBuffer = analyserReady && this.analyser
          ? new Uint8Array(this.analyser.fftSize)
          : null;
        let smoothedLevel = 0;

        const tickAnalyser = () => {
          if (finished || this.playbackToken !== token) return;
          if (this.isPaused || audio.paused) {
            options.onMouthLevel?.(0);
          } else if (this.analyser && dataBuffer) {
            this.analyser.getByteTimeDomainData(dataBuffer);
            let sumSquares = 0;
            for (let i = 0; i < dataBuffer.length; i++) {
              const normalized = (dataBuffer[i] - 128) / 128;
              sumSquares += normalized * normalized;
            }
            const rms = Math.sqrt(sumSquares / dataBuffer.length);
            const rawLevel = Math.min(1, Math.max(0, (rms - 0.012) * 5.2));
            smoothedLevel = smoothedLevel * 0.45 + rawLevel * 0.55;
            options.onMouthLevel?.(smoothedLevel);
          }
          this.rafId = window.requestAnimationFrame(tickAnalyser);
        };

        audio.onplay = () => {
          if (finished || this.playbackToken !== token) return;
          options.onStart?.();
          if (analyserReady) {
            if (this.rafId === null) {
              this.rafId = window.requestAnimationFrame(tickAnalyser);
            }
          } else if (this.fallbackEnvelopeTimer === null) {
            const startTs = performance.now();
            this.fallbackEnvelopeTimer = window.setInterval(() => {
              if (finished || this.playbackToken !== token || this.isPaused || audio.paused) {
                options.onMouthLevel?.(0);
                return;
              }
              const t = (performance.now() - startTs) / 1000;
              const level = Math.max(0.08, Math.min(0.85, 0.34 + 0.36 * Math.abs(Math.sin(t * 7.5))));
              options.onMouthLevel?.(level);
            }, 45);
          }
        };

        audio.onended = () => complete(false);
        audio.onerror = () => complete(true, 'Tarayıcı sentezlenen ses dosyasını çözemedi.');

        await audio.play();
      } catch (err) {
        if (controller.signal.aborted || this.playbackToken !== token) return;
        options.onError?.(
          err instanceof Error ? err.message : 'Sunucu neural TTS uç noktasına ulaşılamadı.'
        );
      }
    };

    void run();
  }

  pause(): void {
    this.isPaused = true;
    if (this.audioEl && !this.audioEl.paused) {
      this.audioEl.pause();
    }
  }

  resume(): void {
    this.isPaused = false;
    if (this.audioEl && this.audioEl.paused) {
      this.audioEl.play().catch(() => {
        // ignore
      });
    }
  }

  stop(): void {
    this.playbackToken++;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.cleanupAudio();
  }
}

/**
 * Native Android TextToSpeech provider implementing ITTSProvider via Capacitor bridge.
 * Connects to Android's `android.speech.tts.TextToSpeech` default engine (e.g. Antalia-2 Mini
 * when chosen in Android settings), enforces strict utteranceId matching so cancelled prayers
 * never skip the queue, and boosts lip-sync on API 26+ `onRangeStart` events.
 */
export class NativeAndroidTTSProvider implements ITTSProvider {
  readonly id: TTSProviderType = 'browser_speech_synthesis';
  readonly label = 'Android Yerel TextToSpeech Motoru (Capacitor)';
  readonly isStudioGrade = false;

  private activeUtteranceId: string | null = null;
  private playbackToken = 0;
  private utteranceCounter = 0;
  private isPaused = false;
  private isSpeakingInternal = false;
  private pulseBoost = 0;
  private activeTimer: number | null = null;
  private safetyTimeout: number | null = null;
  private unsubListeners: (() => void) | null = null;

  isSupported(): boolean {
    return isNativeTtsPluginAvailable();
  }

  private clearTimers() {
    if (this.activeTimer !== null) {
      window.clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
    if (this.safetyTimeout !== null) {
      window.clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }
  }

  private detachListeners() {
    if (this.unsubListeners) {
      this.unsubListeners();
      this.unsubListeners = null;
    }
  }

  speak(text: string, options: TTSSpeakOptions): void {
    this.stop();
    const token = ++this.playbackToken;

    if (!this.isSupported()) {
      options.onError?.('Yerel Android TTS eklentisi bu tarayıcı ortamında kullanılamıyor.');
      return;
    }

    const cleanText = text.replace(/\s+/g, ' ').trim();
    if (!cleanText) {
      options.onEnd?.();
      return;
    }

    const utteranceId = `nuri_${Date.now()}_${++this.utteranceCounter}`;
    this.activeUtteranceId = utteranceId;

    let finished = false;
    let startedNotified = false;
    const startTime = performance.now();

    const finish = (isErr = false, msg?: string) => {
      if (finished || this.playbackToken !== token) return;
      finished = true;
      this.isSpeakingInternal = false;
      this.activeUtteranceId = null;
      this.isPaused = false;
      this.clearTimers();
      this.detachListeners();
      options.onMouthLevel?.(0);
      if (isErr) {
        options.onError?.(msg || 'Android yerel TTS konuşması kesintiye uğradı.');
      } else {
        options.onEnd?.();
      }
    };

    const ensureLipSyncLoop = () => {
      if (!startedNotified) {
        startedNotified = true;
        options.onStart?.();
      }
      if (this.activeTimer === null) {
        this.activeTimer = window.setInterval(() => {
          if (this.playbackToken !== token || finished) return;
          if (this.isPaused || !this.isSpeakingInternal) {
            options.onMouthLevel?.(0);
            return;
          }
          const t = (performance.now() - startTime) / 1000;
          this.pulseBoost = Math.max(0, this.pulseBoost * 0.76);
          const syllableWave =
            0.22 +
            0.38 * Math.abs(Math.sin(t * 7.6 * options.rate)) +
            0.14 * Math.sin(t * 13.5);
          const level = Math.max(0.05, Math.min(1, syllableWave + this.pulseBoost * 0.36));
          options.onMouthLevel?.(level);
        }, 45);
      }
    };

    const maxDurationMs = Math.max(
      30000,
      Math.min(110000, (cleanText.length / Math.max(0.55, options.rate)) * 280)
    );
    this.safetyTimeout = window.setTimeout(() => {
      if (!finished && this.playbackToken === token) {
        void stopNativeAndroid();
        finish(true, 'Android yerel TTS zaman aşımına uğradı (onDone olayı alınamadı).');
      }
    }, maxDurationMs);

    const run = async () => {
      try {
        const unsub = await subscribeNativeAndroidTtsEvents({
          onStart: (ev) => {
            if (finished || this.playbackToken !== token) return;
            if (ev.utteranceId !== this.activeUtteranceId) return;
            this.isSpeakingInternal = true;
            ensureLipSyncLoop();
          },
          onRange: (ev) => {
            if (finished || this.playbackToken !== token) return;
            if (ev.utteranceId !== this.activeUtteranceId) return;
            this.pulseBoost = 0.92;
          },
          onDone: (ev) => {
            if (finished || this.playbackToken !== token) return;
            // Guard: only complete when the currently active utterance finishes
            if (ev.utteranceId !== this.activeUtteranceId) return;
            finish(false);
          },
          onError: (ev) => {
            if (finished || this.playbackToken !== token) return;
            if (ev.utteranceId && ev.utteranceId !== this.activeUtteranceId) return;
            finish(true, ev.message || 'Android TextToSpeech oynatma hatası.');
          },
        });

        if (finished || this.playbackToken !== token) {
          unsub();
          return;
        }
        this.unsubListeners = unsub;

        const res = await speakNativeAndroid({
          text: cleanText,
          lang: options.lang || 'tr-TR',
          rate: options.rate,
          pitch: options.pitch,
          volume: options.volume,
          voiceName: options.voiceURI || undefined,
          utteranceId,
        });

        if (finished || this.playbackToken !== token) return;
        if (!res.ok) {
          finish(true, res.error || 'Android TextToSpeech başlatılamadı.');
        }
      } catch (err) {
        finish(
          true,
          err instanceof Error ? err.message : 'Android yerel TTS köprü hatası.'
        );
      }
    };

    void run();
  }

  pause(): void {
    this.isPaused = true;
    this.isSpeakingInternal = false;
    void pauseNativeAndroid();
  }

  resume(): void {
    this.isPaused = false;
    void resumeNativeAndroid().then((res) => {
      if (res.ok && res.utteranceId) {
        this.activeUtteranceId = res.utteranceId;
        this.isSpeakingInternal = true;
      }
    });
  }

  stop(): void {
    this.playbackToken++;
    this.activeUtteranceId = null;
    this.isSpeakingInternal = false;
    this.isPaused = false;
    this.clearTimers();
    this.detachListeners();
    void stopNativeAndroid();
  }
}

/**
 * Unified TTS router:
 * - In Capacitor Android native builds, automatically uses NativeAndroidTTSProvider
 *   (`android.speech.tts.TextToSpeech`, respecting the system default engine such as Antalia-2 Mini).
 * - In Chrome Preview / standard web browsers, transparently uses BrowserSpeechSynthesisProvider.
 * - Supports optional ServerNeuralTTSProvider with automatic fallback.
 */
export class StudioTTSRouter implements ITTSProvider {
  readonly id: TTSProviderType = 'browser_speech_synthesis';
  readonly label = 'NUR-I DUA Studio TTS Router';
  readonly isStudioGrade = false;

  private activeEngine: 'browser' | 'native_android' | 'neural' = 'browser';

  constructor(
    private readonly browserProvider: BrowserSpeechSynthesisProvider,
    private readonly nativeAndroidProvider: NativeAndroidTTSProvider,
    private readonly neuralProvider: ServerNeuralTTSProvider
  ) {}

  isSupported(): boolean {
    return (
      this.nativeAndroidProvider.isSupported() ||
      this.browserProvider.isSupported() ||
      this.neuralProvider.isSupported()
    );
  }

  getActiveEngine(): 'browser' | 'native_android' | 'neural' {
    return this.activeEngine;
  }

  private speakWithLocalOrNative(text: string, options: TTSSpeakOptions): void {
    if (this.nativeAndroidProvider.isSupported()) {
      this.activeEngine = 'native_android';
      this.nativeAndroidProvider.speak(text, options);
      return;
    }
    this.activeEngine = 'browser';
    this.browserProvider.speak(text, options);
  }

  speak(text: string, options: TTSSpeakOptions): void {
    this.stop();

    if (options.preferredEngine === 'external_studio_adapter') {
      this.activeEngine = 'neural';
      this.neuralProvider.speak(text, {
        ...options,
        onError: (reason) => {
          if (options.fallbackToBrowser !== false) {
            options.onFallbackNotice?.(
              `Sunucu TTS kullanılamıyor (${reason}). Cihaz sistem TTS motoruna geçiliyor.`
            );
            this.speakWithLocalOrNative(text, options);
            return;
          }
          options.onError?.(reason);
        },
      });
      return;
    }

    this.speakWithLocalOrNative(text, options);
  }

  pause(): void {
    if (this.activeEngine === 'neural') {
      this.neuralProvider.pause();
    } else if (this.activeEngine === 'native_android') {
      this.nativeAndroidProvider.pause();
    } else {
      this.browserProvider.pause();
    }
  }

  resume(): void {
    if (this.activeEngine === 'neural') {
      this.neuralProvider.resume();
    } else if (this.activeEngine === 'native_android') {
      this.nativeAndroidProvider.resume();
    } else {
      this.browserProvider.resume();
    }
  }

  stop(): void {
    this.neuralProvider.stop();
    this.nativeAndroidProvider.stop();
    this.browserProvider.stop();
  }
}

export const browserTTSProvider = new BrowserSpeechSynthesisProvider();
export const nativeAndroidTTSProvider = new NativeAndroidTTSProvider();
export const serverNeuralTTSProvider = new ServerNeuralTTSProvider();
export const studioTTSRouter = new StudioTTSRouter(
  browserTTSProvider,
  nativeAndroidTTSProvider,
  serverNeuralTTSProvider
);
