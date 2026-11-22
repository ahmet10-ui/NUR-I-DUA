import {
  ITTSProvider,
  NeuralTTSProviderId,
  ScholarId,
  TTSProviderType,
  TTSSpeakOptions,
  VoiceSettingsConfig,
} from '../types/nuridua';
import {
  isNativeAndroidEnvironment,
  isNativeTtsPluginAvailable,
  pauseNativeAndroid,
  resumeNativeAndroid,
  speakNativeAndroid,
  stopNativeAndroid,
  subscribeNativeAndroidTtsEvents,
} from './nativeAndroidTtsBridge';
import {
  isSeslenLocalPluginAvailable,
  pauseSeslenQueue,
  resumeSeslenQueue,
  speakSeslenQueue,
  stopSeslenQueue,
  subscribeSeslenEvents,
} from './nativeSeslenTtsBridge';
import {
  isNativeArabicAudioPluginAvailable,
  pauseNativeArabicAudio,
  playNativeArabicAudio,
  resumeNativeArabicAudio,
  stopNativeArabicAudio,
  subscribeNativeArabicAudioEvents,
} from './nativeArabicAudioBridge';
import {
  isEmaLightningPluginAvailable,
  pauseEmaQueue,
  resumeEmaQueue,
  speakEmaQueue,
  stopEmaQueue,
  subscribeEmaEvents,
} from './nativeEmaTtsBridge';
import {
  isZerrePluginAvailable,
  pauseZerreQueue,
  resumeZerreQueue,
  speakZerreQueue,
  stopZerreQueue,
  subscribeZerreEvents,
} from './nativeZerreTtsBridge';
import { normalizeTurkishForZerre } from './zerreTextFrontend';

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
 * Resolves the effective voiceURI for each scholar.
 * Hacı Mehmet Efendi (scholar_2) keeps his exact existing resolution (`scholar2VoiceURI || selectedVoiceURI`).
 * Hacı Ahmet Efendi (scholar_1) can optionally use his own independent `scholar1VoiceURI`.
 */
export function resolveScholarVoiceURI(
  voiceCfg: Pick<
    VoiceSettingsConfig,
    'selectedVoiceURI' | 'scholar2VoiceURI' | 'scholar1IndependentEnabled' | 'scholar1VoiceURI'
  >,
  scholarId: ScholarId
): string {
  if (scholarId === 'scholar_2') {
    return voiceCfg.scholar2VoiceURI || voiceCfg.selectedVoiceURI;
  }
  if (voiceCfg.scholar1IndependentEnabled !== false && voiceCfg.scholar1VoiceURI) {
    return voiceCfg.scholar1VoiceURI;
  }
  return voiceCfg.selectedVoiceURI;
}

/**
 * Computes effective rate and pitch per scholar so Hacı Ahmet Efendi (scholar_1)
 * uses his own deeper, slower, solemn elderly profile while Hacı Mehmet Efendi (scholar_2)
 * preserves his exact existing rate and pitch untouched.
 */
export function getScholarProsody(
  baseRate: number,
  basePitch: number,
  scholarId: ScholarId,
  scholar1Profile?: {
    enabled?: boolean;
    rate?: number;
    pitch?: number;
  }
): { rate: number; pitch: number } {
  const clampRate = (v: number) => Math.min(1.4, Math.max(0.5, Number(v.toFixed(2))));
  const clampPitch = (v: number) => Math.min(1.4, Math.max(0.5, Number(v.toFixed(2))));

  if (scholarId === 'scholar_2') {
    return {
      rate: clampRate(baseRate + 0.03),
      pitch: clampPitch(basePitch - 0.05),
    };
  }

  if (scholarId === 'scholar_1' && scholar1Profile?.enabled !== false) {
    return {
      rate: clampRate(scholar1Profile?.rate ?? 0.76),
      pitch: clampPitch(scholar1Profile?.pitch ?? 0.68),
    };
  }

  return {
    rate: clampRate(baseRate),
    pitch: clampPitch(basePitch),
  };
}

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF۝]+/g;

export function containsArabicScript(text: string): boolean {
  ARABIC_SCRIPT_RE.lastIndex = 0;
  return ARABIC_SCRIPT_RE.test(text);
}

export function stripArabicScriptForTurkishTts(text: string): string {
  return text
    .replace(ARABIC_SCRIPT_RE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;!?])/g, '$1')
    .trim();
}

export function sanitizeTurkishTtsPayload(text: string, forbiddenMealText?: string): string {
  let clean = containsArabicScript(text || '')
    ? stripArabicScriptForTurkishTts(text || '')
    : (text || '').trim();
  if (!clean) return '';

  if (forbiddenMealText && forbiddenMealText.trim()) {
    const cleanMeal = stripArabicScriptForTurkishTts(forbiddenMealText);
    const normalizeWs = (s: string) => s.replace(/\s+/g, ' ').trim();
    const normClean = normalizeWs(clean);
    const normMeal = normalizeWs(cleanMeal);
    if (normMeal) {
      const idx = normClean.indexOf(normMeal);
      if (idx !== -1) {
        clean = normalizeWs(normClean.slice(0, idx) + ' ' + normClean.slice(idx + normMeal.length));
      } else if (normClean.includes(forbiddenMealText.trim())) {
        clean = normalizeWs(normClean.split(forbiddenMealText.trim()).join(' '));
      }
    }
  }
  return clean;
}

/**
 * Splits long Turkish texts at sentence (or clause/word) boundaries so Android TTS and Web Speech
 * stay responsive on long High-Tier prayers while keeping normal prayers uninterrupted.
 */
export function splitLongTextIfNeeded(
  rawText: string,
  threshold = 900,
  maxChunk = 750
): string[] {
  const normalized = rawText
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;!?])/g, '$1')
    .trim();

  if (!normalized) return [];
  if (normalized.length <= threshold) return [normalized];

  const rawSentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // If any single sentence still exceeds maxChunk, further split on commas/semicolons or word spaces.
  const atomicPieces: string[] = [];
  for (const sentence of rawSentences) {
    if (sentence.length <= maxChunk) {
      atomicPieces.push(sentence);
      continue;
    }
    const clauses = sentence
      .split(/(?<=[,;:])\s+/)
      .map((c) => c.trim())
      .filter(Boolean);
    for (const clause of clauses) {
      if (clause.length <= maxChunk) {
        atomicPieces.push(clause);
        continue;
      }
      const words = clause.split(/\s+/);
      let piece = '';
      for (const word of words) {
        if (piece && piece.length + word.length + 1 > maxChunk) {
          atomicPieces.push(piece);
          piece = word;
        } else {
          piece = piece ? `${piece} ${word}` : word;
        }
      }
      if (piece) atomicPieces.push(piece);
    }
  }

  const groups: string[] = [];
  let current = '';
  for (const s of atomicPieces) {
    if (current && current.length + s.length + 1 > maxChunk) {
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

    const armSegmentTimeout = (segmentText: string) => {
      if (this.safetyTimeout !== null) {
        window.clearTimeout(this.safetyTimeout);
      }
      const maxDurationMs = Math.max(
        25000,
        Math.min(90000, (segmentText.length / Math.max(0.55, options.rate)) * 260)
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
    };

    const speakSegmentAt = (index: number) => {
      if (finished || this.playbackToken !== token) return;
      if (index >= segments.length) {
        finish(false);
        return;
      }

      armSegmentTimeout(segments[index]);
      const utterance = new SpeechSynthesisUtterance(segments[index]);
      // Keep reference on instance so Chrome/Android GC cannot drop the utterance and lose `onend`
      this.activeUtterance = utterance;
      utterance.lang = options.lang || 'tr-TR';
      utterance.rate = Math.min(1.4, Math.max(0.5, options.rate));
      utterance.pitch = Math.min(1.4, Math.max(0.5, options.pitch));
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
          finish(
            true,
            `Sistem TTS konuşması kesintiye uğradı (${ev.error}).`
          );
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

    const segments = splitLongTextIfNeeded(text, 750, 600);
    if (segments.length === 0) {
      options.onEnd?.();
      return;
    }

    let currentSegmentIndex = 0;
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

    const armSegmentTimeout = (segmentText: string) => {
      if (this.safetyTimeout !== null) {
        window.clearTimeout(this.safetyTimeout);
      }
      const maxDurationMs = Math.max(
        30000,
        Math.min(110000, (segmentText.length / Math.max(0.55, options.rate)) * 280)
      );
      this.safetyTimeout = window.setTimeout(() => {
        if (!finished && this.playbackToken === token) {
          void stopNativeAndroid();
          finish(true, 'Android yerel TTS zaman aşımına uğradı (onDone olayı alınamadı).');
        }
      }, maxDurationMs);
    };

    const speakSegmentAt = async (index: number) => {
      if (finished || this.playbackToken !== token) return;
      if (index >= segments.length) {
        finish(false);
        return;
      }
      currentSegmentIndex = index;
      const segmentText = segments[index];
      const utteranceId = `nuri_${Date.now()}_${++this.utteranceCounter}`;
      this.activeUtteranceId = utteranceId;
      armSegmentTimeout(segmentText);

      const res = await speakNativeAndroid({
        text: segmentText,
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
    };

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
            // Guard: only advance when the currently active utterance finishes
            if (ev.utteranceId !== this.activeUtteranceId) return;
            const nextIndex = currentSegmentIndex + 1;
            if (nextIndex < segments.length) {
              void speakSegmentAt(nextIndex);
              return;
            }
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

        await speakSegmentAt(0);
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
 * On-device Seslen-TTS ("hasan" elderly Turkish male voice) provider for Hacı Ahmet Efendi (scholar_1).
 * Uses Chaquopy + ONNX Runtime (metin.onnx + ses.onnx) and AudioTrack 24 kHz mono PCM playback.
 * Never delegates or falls back to Android TextToSpeech / Antalia-2 Mini on error.
 */
export class SeslenLocalTTSProvider implements ITTSProvider {
  readonly id: TTSProviderType = 'browser_speech_synthesis';
  readonly label = 'Seslen-TTS Hasan (Yerel ONNX Runtime)';
  readonly isStudioGrade = true;

  private activeUtteranceId: string | null = null;
  private playbackToken = 0;
  private utteranceCounter = 0;
  private isPaused = false;
  private safetyTimeout: number | null = null;
  private unsubListeners: (() => void) | null = null;

  isSupported(): boolean {
    return isSeslenLocalPluginAvailable();
  }

  private clearSafetyTimeout() {
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

    const cleanText = text.replace(/\s+/g, ' ').trim();
    if (!cleanText) {
      options.onEnd?.();
      return;
    }

    if (!this.isSupported()) {
      options.onError?.(
        'Seslen-TTS Hasan eklentisi Android üzerinde kullanılabilir değil. Hacı Ahmet Efendi için Antalia-2 Mini sesine geçilmedi.'
      );
      return;
    }

    const utteranceId = `seslen_${Date.now()}_${++this.utteranceCounter}`;
    this.activeUtteranceId = utteranceId;
    this.isPaused = false;

    let finished = false;
    let startedNotified = false;

    const finish = (isErr = false, msg?: string) => {
      if (finished || this.playbackToken !== token) return;
      finished = true;
      this.activeUtteranceId = null;
      this.isPaused = false;
      this.clearSafetyTimeout();
      this.detachListeners();
      options.onMouthLevel?.(0);
      if (isErr) {
        options.onError?.(msg || 'Seslen-TTS Hasan sentezi/oynatımı başarısız oldu.');
      } else {
        options.onEnd?.();
      }
    };

    const armSafetyTimeout = (timeoutMs = 75000) => {
      this.clearSafetyTimeout();
      this.safetyTimeout = window.setTimeout(() => {
        if (!finished && this.playbackToken === token && !this.isPaused) {
          void stopSeslenQueue();
          finish(true, 'Seslen-TTS Hasan oynatma zaman aşımına uğradı.');
        }
      }, timeoutMs);
    };

    const initialMaxMs = Math.max(
      60000,
      Math.min(180000, (cleanText.length / Math.max(0.65, options.rate || 0.94)) * 380)
    );
    armSafetyTimeout(initialMaxMs);
    let lastWatchdogRefreshAt = performance.now();

    const run = async () => {
      try {
        const unsub = await subscribeSeslenEvents({
          onStart: (ev) => {
            if (finished || this.playbackToken !== token) return;
            if (ev.utteranceId && ev.utteranceId !== this.activeUtteranceId) return;
            armSafetyTimeout(75000);
            if (!startedNotified) {
              startedNotified = true;
              options.onStart?.();
            }
          },
          onMouth: (ev) => {
            if (finished || this.playbackToken !== token || this.isPaused) return;
            if (ev.utteranceId && ev.utteranceId !== this.activeUtteranceId) return;
            const now = performance.now();
            if (now - lastWatchdogRefreshAt > 2000) {
              lastWatchdogRefreshAt = now;
              armSafetyTimeout(75000);
            }
            options.onMouthLevel?.(ev.level);
          },
          onDone: (ev) => {
            if (finished || this.playbackToken !== token) return;
            if (ev.utteranceId !== this.activeUtteranceId) return;
            finish(false);
          },
          onError: (ev) => {
            if (finished || this.playbackToken !== token) return;
            if (ev.utteranceId && ev.utteranceId !== this.activeUtteranceId) return;
            finish(true, ev.message || 'Seslen-TTS Hasan oynatma hatası.');
          },
        });

        if (finished || this.playbackToken !== token) {
          unsub();
          return;
        }
        this.unsubListeners = unsub;

        const res = await speakSeslenQueue({
          text: cleanText,
          utteranceId,
          rate: options.rate,
          volume: options.volume,
        });

        if (finished || this.playbackToken !== token) return;
        if (!res.ok) {
          finish(true, res.error || 'Seslen-TTS Hasan konuşması başlatılamadı.');
        }
      } catch (err) {
        finish(
          true,
          err instanceof Error ? err.message : 'Seslen-TTS Hasan yerel köprü hatası.'
        );
      }
    };

    void run();
  }

  pause(): void {
    this.isPaused = true;
    this.clearSafetyTimeout();
    void pauseSeslenQueue();
  }

  resume(): void {
    this.isPaused = false;
    void resumeSeslenQueue();
  }

  stop(): void {
    this.playbackToken++;
    this.activeUtteranceId = null;
    this.isPaused = false;
    this.clearSafetyTimeout();
    this.detachListeners();
    void stopSeslenQueue();
  }
}

/**
 * On-device EMA Lightning (8.6M params, 48 kHz mono, Turkish, Apache-2.0) candidate provider
 * for Hacı Ahmet Efendi (scholar_1). Never delegates to Antalia-2 Mini.
 */
export class EmaLightningLocalTTSProvider implements ITTSProvider {
  readonly id: TTSProviderType = 'browser_speech_synthesis';
  readonly label = 'EMA Lightning (Yerel ONNX Runtime · 48 kHz)';
  readonly isStudioGrade = true;

  private activeUtteranceId: string | null = null;
  private playbackToken = 0;
  private utteranceCounter = 0;
  private isPaused = false;
  private safetyTimeout: number | null = null;
  private unsubListeners: (() => void) | null = null;

  isSupported(): boolean {
    return isEmaLightningPluginAvailable();
  }

  private clearSafetyTimeout() {
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

    const cleanText = text.replace(/\s+/g, ' ').trim();
    if (!cleanText) {
      options.onEnd?.();
      return;
    }

    if (!this.isSupported()) {
      options.onError?.(
        'EMA Lightning eklentisi Android üzerinde kullanılabilir değil.'
      );
      return;
    }

    const utteranceId = `ema_${Date.now()}_${++this.utteranceCounter}`;
    this.activeUtteranceId = utteranceId;
    this.isPaused = false;

    let finished = false;
    let startedNotified = false;

    const finish = (isErr = false, msg?: string) => {
      if (finished || this.playbackToken !== token) return;
      finished = true;
      this.activeUtteranceId = null;
      this.isPaused = false;
      this.clearSafetyTimeout();
      this.detachListeners();
      options.onMouthLevel?.(0);
      if (isErr) {
        options.onError?.(msg || 'EMA Lightning sentezi/oynatımı başarısız oldu.');
      } else {
        options.onEnd?.();
      }
    };

    const armSafetyTimeout = (timeoutMs = 75000) => {
      this.clearSafetyTimeout();
      this.safetyTimeout = window.setTimeout(() => {
        if (!finished && this.playbackToken === token && !this.isPaused) {
          void stopEmaQueue();
          finish(true, 'EMA Lightning oynatma zaman aşımına uğradı.');
        }
      }, timeoutMs);
    };

    const initialMaxMs = Math.max(
      45000,
      Math.min(180000, (cleanText.length / Math.max(0.65, options.rate || 1.0)) * 320)
    );
    armSafetyTimeout(initialMaxMs);
    let lastWatchdogRefreshAt = performance.now();

    const run = async () => {
      try {
        const unsub = await subscribeEmaEvents({
          onStart: (ev) => {
            if (finished || this.playbackToken !== token) return;
            if (ev.utteranceId && ev.utteranceId !== this.activeUtteranceId) return;
            armSafetyTimeout(75000);
            if (!startedNotified) {
              startedNotified = true;
              options.onStart?.();
            }
          },
          onMouth: (ev) => {
            if (finished || this.playbackToken !== token || this.isPaused) return;
            if (ev.utteranceId && ev.utteranceId !== this.activeUtteranceId) return;
            const now = performance.now();
            if (now - lastWatchdogRefreshAt > 2000) {
              lastWatchdogRefreshAt = now;
              armSafetyTimeout(75000);
            }
            options.onMouthLevel?.(ev.level);
          },
          onDone: (ev) => {
            if (finished || this.playbackToken !== token) return;
            if (ev.utteranceId !== this.activeUtteranceId) return;
            finish(false);
          },
          onError: (ev) => {
            if (finished || this.playbackToken !== token) return;
            if (ev.utteranceId && ev.utteranceId !== this.activeUtteranceId) return;
            finish(true, ev.message || 'EMA Lightning oynatma hatası.');
          },
        });

        if (finished || this.playbackToken !== token) {
          unsub();
          return;
        }
        this.unsubListeners = unsub;

        const res = await speakEmaQueue({
          text: cleanText,
          utteranceId,
          rate: options.rate,
          seed: 0,
          volume: options.volume,
        });

        if (finished || this.playbackToken !== token) return;
        if (!res.ok) {
          finish(true, res.error || 'EMA Lightning konuşması başlatılamadı.');
        }
      } catch (err) {
        finish(
          true,
          err instanceof Error ? err.message : 'EMA Lightning yerel köprü hatası.'
        );
      }
    };

    void run();
  }

  pause(): void {
    this.isPaused = true;
    this.clearSafetyTimeout();
    void pauseEmaQueue();
  }

  resume(): void {
    this.isPaused = false;
    void resumeEmaQueue();
  }

  stop(): void {
    this.playbackToken++;
    this.activeUtteranceId = null;
    this.isPaused = false;
    this.clearSafetyTimeout();
    this.detachListeners();
    void stopEmaQueue();
  }
}

/**
 * Native Android local ONNX TTS provider using `ZerreTts` (`Zerre-TTS SES-A / MK`, male voice=0).
 * Strictly isolated from Antalia-2 Mini / Google TTS; keeps Seslen-TTS Hasan as opt-out baseline.
 */
export class ZerreLocalTTSProvider implements ITTSProvider {
  readonly id: TTSProviderType = 'browser_speech_synthesis';
  readonly label = 'Zerre-TTS SES-A (MK Yerel ONNX)';
  readonly isStudioGrade = true;

  private playbackToken = 0;
  private activeUtteranceId: string | null = null;
  private isPaused = false;
  private safetyTimeout: number | null = null;
  private unsubListeners: (() => void) | null = null;
  private utteranceCounter = 0;

  isSupported(): boolean {
    return isZerrePluginAvailable();
  }

  private clearSafetyTimeout() {
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

    const cleanText = normalizeTurkishForZerre(text);
    if (!cleanText) {
      options.onEnd?.();
      return;
    }

    if (!this.isSupported()) {
      options.onError?.(
        'Zerre SES-A (MK) eklentisi Android üzerinde kullanılabilir değil.'
      );
      return;
    }

    const utteranceId = `zerre_${Date.now()}_${++this.utteranceCounter}`;
    this.activeUtteranceId = utteranceId;
    this.isPaused = false;

    let finished = false;
    let startedNotified = false;

    const finish = (isErr = false, msg?: string) => {
      if (finished || this.playbackToken !== token) return;
      finished = true;
      this.activeUtteranceId = null;
      this.isPaused = false;
      this.clearSafetyTimeout();
      this.detachListeners();
      options.onMouthLevel?.(0);
      if (isErr) {
        options.onError?.(msg || 'Zerre SES-A (MK) sentezi/oynatımı başarısız oldu.');
      } else {
        options.onEnd?.();
      }
    };

    const armSafetyTimeout = (timeoutMs = 75000) => {
      this.clearSafetyTimeout();
      this.safetyTimeout = window.setTimeout(() => {
        if (!finished && this.playbackToken === token && !this.isPaused) {
          void stopZerreQueue();
          finish(true, 'Zerre SES-A oynatma zaman aşımına uğradı.');
        }
      }, timeoutMs);
    };

    const initialMaxMs = Math.max(
      45000,
      Math.min(180000, (cleanText.length / Math.max(0.65, options.rate || 0.94)) * 340)
    );
    armSafetyTimeout(initialMaxMs);
    let lastWatchdogRefreshAt = performance.now();

    const run = async () => {
      try {
        const unsub = await subscribeZerreEvents({
          onStart: (ev) => {
            if (finished || this.playbackToken !== token) return;
            if (ev.utteranceId && ev.utteranceId !== this.activeUtteranceId) return;
            armSafetyTimeout(75000);
            if (!startedNotified) {
              startedNotified = true;
              options.onStart?.();
            }
          },
          onMouth: (ev) => {
            if (finished || this.playbackToken !== token || this.isPaused) return;
            if (ev.utteranceId && ev.utteranceId !== this.activeUtteranceId) return;
            const now = performance.now();
            if (now - lastWatchdogRefreshAt > 2000) {
              lastWatchdogRefreshAt = now;
              armSafetyTimeout(75000);
            }
            options.onMouthLevel?.(ev.level);
          },
          onDone: (ev) => {
            if (finished || this.playbackToken !== token) return;
            if (ev.utteranceId !== this.activeUtteranceId) return;
            finish(false);
          },
          onError: (ev) => {
            if (finished || this.playbackToken !== token) return;
            if (ev.utteranceId && ev.utteranceId !== this.activeUtteranceId) return;
            finish(true, ev.message || 'Zerre SES-A (MK) oynatma hatası.');
          },
        });

        if (finished || this.playbackToken !== token) {
          unsub();
          return;
        }
        this.unsubListeners = unsub;

        const res = await speakZerreQueue({
          text: cleanText,
          utteranceId,
          rate: options.rate,
          volume: options.volume,
        });

        if (finished || this.playbackToken !== token) return;
        if (!res.ok) {
          finish(true, res.error || 'Zerre SES-A (MK) konuşması başlatılamadı.');
        }
      } catch (err) {
        finish(
          true,
          err instanceof Error ? err.message : 'Zerre SES-A yerel köprü hatası.'
        );
      }
    };

    void run();
  }

  pause(): void {
    this.isPaused = true;
    this.clearSafetyTimeout();
    void pauseZerreQueue();
  }

  resume(): void {
    this.isPaused = false;
    void resumeZerreQueue();
  }

  stop(): void {
    this.playbackToken++;
    this.activeUtteranceId = null;
    this.isPaused = false;
    this.clearSafetyTimeout();
    this.detachListeners();
    void stopZerreQueue();
  }
}

/**
 * Unified per-scholar TTS router:
 * - On native Android APK builds:
 *   - Hacı Ahmet Efendi (`scholar_1`) defaults strictly to local `SeslenLocalTTSProvider` ("hasan" ONNX),
 *     or optional `EmaLightningLocalTTSProvider` / `ZerreLocalTTSProvider` when explicitly chosen,
 *     with pre-start-only controlled fallback to Hasan (never double-speaking, NEVER Antalia-2 Mini).
 *   - Hacı Mehmet Efendi (`scholar_2`) keeps `NativeAndroidTTSProvider` (Antalia-2 Mini) untouched.
 * - In Chrome Preview / standard web browsers (`!isNativeAndroidEnvironment()`), falls back to
 *   BrowserSpeechSynthesisProvider or optional ServerNeuralTTSProvider for desktop previewing.
 */
export class StudioTTSRouter implements ITTSProvider {
  readonly id: TTSProviderType = 'browser_speech_synthesis';
  readonly label = 'NUR-I DUA Studio TTS Router';
  readonly isStudioGrade = false;

  private activeEngine:
    | 'browser'
    | 'native_android'
    | 'seslen_hasan'
    | 'ema_lightning'
    | 'zerre_ses_a'
    | 'neural' = 'browser';

  constructor(
    private readonly browserProvider: BrowserSpeechSynthesisProvider,
    private readonly nativeAndroidProvider: NativeAndroidTTSProvider,
    private readonly neuralProvider: ServerNeuralTTSProvider,
    private readonly seslenLocalProvider: SeslenLocalTTSProvider,
    private readonly emaLocalProvider?: ITTSProvider,
    private readonly zerreLocalProvider?: ITTSProvider
  ) {}

  isSupported(): boolean {
    return (
      Boolean(this.zerreLocalProvider?.isSupported()) ||
      Boolean(this.emaLocalProvider?.isSupported()) ||
      this.seslenLocalProvider.isSupported() ||
      this.nativeAndroidProvider.isSupported() ||
      this.browserProvider.isSupported() ||
      this.neuralProvider.isSupported()
    );
  }

  getActiveEngine():
    | 'browser'
    | 'native_android'
    | 'seslen_hasan'
    | 'ema_lightning'
    | 'zerre_ses_a'
    | 'neural' {
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

    // Hard safety guard: Arabic script and display-only Turkish meal text must NEVER reach any Turkish TTS engine.
    const safeTurkishText = sanitizeTurkishTtsPayload(text, options.forbiddenMealText);
    if (!safeTurkishText.trim()) {
      options.onError?.(
        'Arapça metin veya yalnızca ekranda gösterilen Türkçe meal metni TTS motorlarına (Seslen-TTS / Zerre SES-A / EMA Lightning / Antalia-2 Mini) gönderilemez.'
      );
      return;
    }

    // Strict per-scholar isolation on Android:
    // Hacı Ahmet Efendi (scholar_1) uses Seslen-TTS Hasan by default, or opt-in Zerre SES-A / EMA Lightning.
    // Never falls back to Antalia-2 Mini on error.
    const shouldCheckAndroidScholar1 =
      options.scholarId === 'scholar_1' &&
      !options.forceStandardSystemTts &&
      (isNativeAndroidEnvironment() ||
        options.scholar1Engine === 'ema_lightning' ||
        options.scholar1Engine === 'zerre_ses_a');

    if (shouldCheckAndroidScholar1 && options.scholar1Engine === 'zerre_ses_a') {
      if (this.zerreLocalProvider?.isSupported()) {
        let zerreHasStartedAudio = false;
        let fellBackToHasan = false;
        this.activeEngine = 'zerre_ses_a';
        this.zerreLocalProvider.speak(safeTurkishText, {
          ...options,
          onStart: () => {
            zerreHasStartedAudio = true;
            options.onStart?.();
          },
          onError: (zerreErr) => {
            if (
              !zerreHasStartedAudio &&
              !fellBackToHasan &&
              options.zerreFallbackToHasan !== false &&
              this.seslenLocalProvider.isSupported()
            ) {
              fellBackToHasan = true;
              options.onFallbackNotice?.(
                `Zerre SES-A ses başlatılamadı (${zerreErr}); Seslen-TTS Hasan motoruna kontrollü geçiş yapılıyor.`
              );
              this.activeEngine = 'seslen_hasan';
              this.seslenLocalProvider.speak(safeTurkishText, options);
              return;
            }
            options.onError?.(zerreErr);
          },
        });
        return;
      }

      if (options.zerreFallbackToHasan !== false && this.seslenLocalProvider.isSupported()) {
        options.onFallbackNotice?.(
          'Zerre SES-A bu ortamda desteklenmiyor; Seslen-TTS Hasan motoruna geçiliyor.'
        );
        this.activeEngine = 'seslen_hasan';
        this.seslenLocalProvider.speak(safeTurkishText, options);
        return;
      }

      if (isNativeAndroidEnvironment()) {
        options.onError?.(
          'Zerre SES-A (MK) eklentisi Android üzerinde aktif değil ve Hasan fallback kullanılamıyor.'
        );
        return;
      }
    }

    if (shouldCheckAndroidScholar1 && options.scholar1Engine === 'ema_lightning') {
      if (this.emaLocalProvider?.isSupported()) {
        let emaHasStartedAudio = false;
        let fellBackToHasan = false;
        this.activeEngine = 'ema_lightning';
        this.emaLocalProvider.speak(safeTurkishText, {
          ...options,
          onStart: () => {
            emaHasStartedAudio = true;
            options.onStart?.();
          },
          onError: (emaErr) => {
            if (
              !emaHasStartedAudio &&
              !fellBackToHasan &&
              options.emaFallbackToHasan !== false &&
              this.seslenLocalProvider.isSupported()
            ) {
              fellBackToHasan = true;
              options.onFallbackNotice?.(
                `EMA Lightning ses başlatılamadı (${emaErr}); Seslen-TTS Hasan motoruna kontrollü geçiş yapılıyor.`
              );
              this.activeEngine = 'seslen_hasan';
              this.seslenLocalProvider.speak(safeTurkishText, options);
              return;
            }
            options.onError?.(emaErr);
          },
        });
        return;
      }

      if (options.emaFallbackToHasan !== false && this.seslenLocalProvider.isSupported()) {
        options.onFallbackNotice?.(
          'EMA Lightning bu ortamda desteklenmiyor; Seslen-TTS Hasan motoruna geçiliyor.'
        );
        this.activeEngine = 'seslen_hasan';
        this.seslenLocalProvider.speak(safeTurkishText, options);
        return;
      }

      if (isNativeAndroidEnvironment()) {
        options.onError?.(
          'EMA Lightning eklentisi Android üzerinde aktif değil ve Hasan fallback kullanılamıyor.'
        );
        return;
      }
    }

    if (
      options.scholarId === 'scholar_1' &&
      !options.forceStandardSystemTts &&
      isNativeAndroidEnvironment()
    ) {
      this.activeEngine = 'seslen_hasan';
      if (!this.seslenLocalProvider.isSupported()) {
        options.onError?.(
          'Seslen-TTS Hasan eklentisi Android üzerinde aktif değil. Hacı Ahmet Efendi için Antalia-2 Mini sesine geçiş yapılmadı.'
        );
        return;
      }
      this.seslenLocalProvider.speak(safeTurkishText, options);
      return;
    }

    if (options.preferredEngine === 'external_studio_adapter' && !options.forceStandardSystemTts) {
      this.activeEngine = 'neural';
      this.neuralProvider.speak(safeTurkishText, {
        ...options,
        onError: (reason) => {
          if (options.fallbackToBrowser !== false) {
            options.onFallbackNotice?.(
              `Sunucu TTS kullanılamıyor (${reason}). Cihaz sistem TTS motoruna geçiliyor.`
            );
            this.speakWithLocalOrNative(safeTurkishText, options);
            return;
          }
          options.onError?.(reason);
        },
      });
      return;
    }

    this.speakWithLocalOrNative(safeTurkishText, options);
  }

  pause(): void {
    if (this.activeEngine === 'zerre_ses_a') {
      this.zerreLocalProvider?.pause();
    } else if (this.activeEngine === 'ema_lightning') {
      this.emaLocalProvider?.pause();
    } else if (this.activeEngine === 'seslen_hasan') {
      this.seslenLocalProvider.pause();
    } else if (this.activeEngine === 'neural') {
      this.neuralProvider.pause();
    } else if (this.activeEngine === 'native_android') {
      this.nativeAndroidProvider.pause();
    } else {
      this.browserProvider.pause();
    }
  }

  resume(): void {
    if (this.activeEngine === 'zerre_ses_a') {
      this.zerreLocalProvider?.resume();
    } else if (this.activeEngine === 'ema_lightning') {
      this.emaLocalProvider?.resume();
    } else if (this.activeEngine === 'seslen_hasan') {
      this.seslenLocalProvider.resume();
    } else if (this.activeEngine === 'neural') {
      this.neuralProvider.resume();
    } else if (this.activeEngine === 'native_android') {
      this.nativeAndroidProvider.resume();
    } else {
      this.browserProvider.resume();
    }
  }

  stop(): void {
    this.zerreLocalProvider?.stop();
    this.emaLocalProvider?.stop();
    this.seslenLocalProvider.stop();
    this.neuralProvider.stop();
    this.nativeAndroidProvider.stop();
    this.browserProvider.stop();
  }
}

export interface AudioClipPlayOptions {
  volume: number;
  expectedSha256?: string;
  startTimeoutMs?: number;
  onStart?: (info?: { durationMs?: number }) => void;
  onMouthLevel?: (level: number) => void;
  onProgress?: (info: { positionMs: number; durationMs: number }) => void;
  onEnd?: () => void;
  onError?: (reason: string) => void;
}

export interface AudioSha256VerificationResult {
  ok: boolean;
  actualSha256?: string;
  byteLength?: number;
  blob?: Blob;
  error?: string;
}

export async function verifyAudioUrlSha256(
  url: string,
  expectedSha256: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<AudioSha256VerificationResult> {
  const expected = (expectedSha256 || '').trim().toLowerCase();
  if (!expected) {
    return { ok: false, error: 'Beklenen SHA-256 doğrulama özeti boş.' };
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    return { ok: false, error: 'Web Crypto SHA-256 motoru bu ortamda kullanılamıyor.' };
  }

  let res: Response;
  try {
    res = await fetchImpl(url, { cache: 'no-store', signal });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Ses dosyası indirilemedi veya okunamadı (${url}): ${err.message}`
          : `Ses dosyası indirilemedi (${url}).`,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `Ses dosyası bulunamadı veya erişilemedi (${url}, HTTP ${res.status}).`,
    };
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await res.arrayBuffer();
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Ses dosyası içeriği okunamadı (${url}): ${err.message}`
          : `Ses dosyası içeriği okunamadı (${url}).`,
    };
  }

  if (!buffer || buffer.byteLength <= 0) {
    return { ok: false, error: `Ses dosyası boş (0 bayt): ${url}.` };
  }

  const digest = await subtle.digest('SHA-256', buffer);
  const actualSha256 = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (actualSha256 !== expected) {
    return {
      ok: false,
      actualSha256,
      byteLength: buffer.byteLength,
      error: `Ses dosyası SHA-256 doğrulaması başarısız (beklenen: ${expected.slice(0, 12)}…, okunan: ${actualSha256.slice(0, 12)}…).`,
    };
  }

  const contentType = res.headers?.get?.('content-type') || 'audio/mpeg';
  return {
    ok: true,
    actualSha256,
    byteLength: buffer.byteLength,
    blob: new Blob([buffer], { type: contentType }),
  };
}

/**
 * Plays verified, reuse-licensed human/Qari Arabic audio clips (e.g. CC0 MP3 bundled under `/audio/duas/`).
 * On Android APK builds, delegates to native `NurIDuaAudio` (MediaPlayer + PARTIAL_WAKE_LOCK + AudioFocus)
 * with native AssetManager SHA-256 verification before preparing MediaPlayer.
 * On Web/Browser builds, verifies expectedSha256 via Web Crypto before playing when crypto.subtle is available.
 * Enforces playback-start verification + start timeout watchdog so an unstarted clip never pretends to complete.
 */
export class VerifiedAudioClipPlayer {
  private audioEl: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private webAbortController: AbortController | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId: number | null = null;
  private fallbackTimer: number | null = null;
  private startWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private nativeUnsubListeners: (() => void) | null = null;
  private activeNativePlaybackId: string | null = null;
  private playbackMode: 'web' | 'native' | null = null;
  private playbackCounter = 0;
  private isPaused = false;
  private isPlayingInternal = false;
  private playbackToken = 0;

  isSupported(): boolean {
    if (isNativeArabicAudioPluginAvailable()) return true;
    return typeof window !== 'undefined' && typeof Audio !== 'undefined';
  }

  isPlaying(): boolean {
    return this.isPlayingInternal;
  }

  private clearStartWatchdog() {
    if (this.startWatchdogTimer !== null) {
      clearTimeout(this.startWatchdogTimer);
      this.startWatchdogTimer = null;
    }
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
        // ignore
      });
    }
    return this.audioCtx;
  }

  private detachNativeListeners() {
    if (this.nativeUnsubListeners) {
      this.nativeUnsubListeners();
      this.nativeUnsubListeners = null;
    }
  }

  private cleanupAudio(resetMouth?: (level: number) => void) {
    this.clearStartWatchdog();
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.fallbackTimer !== null) {
      window.clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.webAbortController) {
      try {
        this.webAbortController.abort();
      } catch {
        // ignore
      }
      this.webAbortController = null;
    }
    this.detachNativeListeners();
    this.activeNativePlaybackId = null;
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
      try {
        URL.revokeObjectURL(this.objectUrl);
      } catch {
        // ignore
      }
      this.objectUrl = null;
    }
    this.playbackMode = null;
    this.isPaused = false;
    this.isPlayingInternal = false;
    resetMouth?.(0);
  }

  private startWebAudioElement(
    playbackSrc: string,
    displayUrl: string,
    options: AudioClipPlayOptions,
    token: number,
    finish: (isErr?: boolean, msg?: string) => void
  ): void {
    if (this.playbackToken !== token) return;
    const audio = new Audio(playbackSrc);
    audio.preload = 'auto';
    audio.volume = Math.min(1, Math.max(0, options.volume));
    this.audioEl = audio;

    let hasStarted = false;
    const startTimeoutMs = options.startTimeoutMs ?? 15000;
    if (startTimeoutMs > 0) {
      this.clearStartWatchdog();
      this.startWatchdogTimer = setTimeout(() => {
        if (!hasStarted && this.playbackToken === token) {
          finish(true, `Ses oynatma beklenen sürede başlatılamadı (${displayUrl}).`);
        }
      }, startTimeoutMs);
    }

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

    const dataBuffer =
      analyserReady && this.analyser ? new Uint8Array(this.analyser.fftSize) : null;
    let smoothedLevel = 0;

    const tickAnalyser = () => {
      if (this.playbackToken !== token) return;
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

    audio.ontimeupdate = () => {
      if (this.playbackToken !== token) return;
      const durationMs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
      const positionMs = Math.round((audio.currentTime || 0) * 1000);
      options.onProgress?.({ positionMs, durationMs });
    };

    audio.onplay = () => {
      if (this.playbackToken !== token) return;
      hasStarted = true;
      this.clearStartWatchdog();
      const durationMs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined;
      options.onStart?.({ durationMs });
      if (analyserReady) {
        if (this.rafId === null) {
          this.rafId = window.requestAnimationFrame(tickAnalyser);
        }
      } else if (this.fallbackTimer === null) {
        const startTs = performance.now();
        this.fallbackTimer = window.setInterval(() => {
          if (this.playbackToken !== token || this.isPaused || audio.paused) {
            options.onMouthLevel?.(0);
            return;
          }
          const t = (performance.now() - startTs) / 1000;
          const level = Math.max(0.08, Math.min(0.85, 0.3 + 0.36 * Math.abs(Math.sin(t * 6.8))));
          options.onMouthLevel?.(level);
        }, 45);
      }
    };

    audio.onended = () => {
      if (this.playbackToken !== token) return;
      if (!hasStarted || (!Number.isFinite(audio.duration) && audio.currentTime <= 0)) {
        finish(true, `Ses dosyası başlamadan sonlandı (${displayUrl}).`);
        return;
      }
      finish(false);
    };
    audio.onerror = () => finish(true, `Ses dosyası yüklenemedi veya çözülemedi (${displayUrl}).`);

    void audio.play().catch((err) => {
      finish(
        true,
        err instanceof Error ? `Arapça ses oynatma başlatılamadı: ${err.message}` : 'Arapça ses başlatılamadı.'
      );
    });
  }

  play(url: string, options: AudioClipPlayOptions): void {
    this.stop();
    const token = ++this.playbackToken;

    if (!this.isSupported()) {
      options.onError?.('Tarayıcı doğrulanmış ses dosyası oynatmayı desteklemiyor.');
      return;
    }

    const cleanUrl = url.trim();
    if (!cleanUrl) {
      options.onError?.('Arapça ses dosyası adresi boş.');
      return;
    }

    // Native Android path: NurIDuaAudio (MediaPlayer + AudioFocus + PARTIAL_WAKE_LOCK)
    if (isNativeArabicAudioPluginAvailable()) {
      this.playbackMode = 'native';
      this.isPlayingInternal = true;
      this.isPaused = false;
      const playbackId = `qari_${Date.now()}_${++this.playbackCounter}`;
      this.activeNativePlaybackId = playbackId;

      let finished = false;
      let hasStartedNative = false;
      const finishNative = (isErr = false, msg?: string) => {
        if (finished || this.playbackToken !== token) return;
        finished = true;
        this.cleanupAudio(options.onMouthLevel);
        if (isErr) {
          options.onError?.(msg || 'Android Arapça ses kaydı oynatılamadı.');
        } else {
          options.onEnd?.();
        }
      };

      const startTimeoutMs = options.startTimeoutMs ?? 15000;
      if (startTimeoutMs > 0) {
        this.clearStartWatchdog();
        this.startWatchdogTimer = setTimeout(() => {
          if (!finished && !hasStartedNative && this.playbackToken === token) {
            void stopNativeArabicAudio();
            finishNative(true, 'Android MediaPlayer ses başlatma zaman aşımına uğradı.');
          }
        }, startTimeoutMs);
      }

      const runNative = async () => {
        try {
          const unsub = await subscribeNativeArabicAudioEvents({
            onStart: (ev) => {
              if (finished || this.playbackToken !== token) return;
              if (ev.playbackId !== this.activeNativePlaybackId) return;
              hasStartedNative = true;
              this.clearStartWatchdog();
              options.onStart?.({ durationMs: ev.durationMs });
            },
            onProgress: (ev) => {
              if (finished || this.playbackToken !== token || this.isPaused) return;
              if (ev.playbackId !== this.activeNativePlaybackId) return;
              options.onMouthLevel?.(ev.level);
              options.onProgress?.({ positionMs: ev.positionMs, durationMs: ev.durationMs });
            },
            onDone: (ev) => {
              if (finished || this.playbackToken !== token) return;
              if (ev.playbackId !== this.activeNativePlaybackId) return;
              if (!hasStartedNative) {
                finishNative(
                  true,
                  'Android MediaPlayer ses başlamadan erken tamamlandı (audioStart alınamadı).'
                );
                return;
              }
              if (
                ev.durationMs >= 30000 &&
                typeof ev.positionMs === 'number' &&
                ev.positionMs < Math.round(ev.durationMs * 0.8)
              ) {
                finishNative(
                  true,
                  `Android MediaPlayer ses erken kesildi (${ev.positionMs} ms / ${ev.durationMs} ms); tamamlandı sayılmadı.`
                );
                return;
              }
              finishNative(false);
            },
            onError: (ev) => {
              if (finished || this.playbackToken !== token) return;
              if (ev.playbackId && ev.playbackId !== this.activeNativePlaybackId) return;
              finishNative(true, ev.message || 'Android Arapça ses dosyası çalma hatası.');
            },
          });

          if (finished || this.playbackToken !== token) {
            unsub();
            return;
          }
          this.nativeUnsubListeners = unsub;

          const res = await playNativeArabicAudio({
            url: cleanUrl,
            playbackId,
            volume: Math.min(1, Math.max(0, options.volume)),
            expectedSha256: options.expectedSha256,
          });

          if (finished || this.playbackToken !== token) return;
          if (!res.ok) {
            finishNative(true, res.error || `Arapça ses dosyası yüklenemedi (${cleanUrl}).`);
          }
        } catch (err) {
          finishNative(
            true,
            err instanceof Error ? err.message : 'Android NurIDuaAudio oynatma başlatılamadı.'
          );
        }
      };

      void runNative();
      return;
    }

    // Web / Browser path: verify expectedSha256 when Web Crypto is available, then play via HTMLAudioElement
    this.playbackMode = 'web';
    this.isPlayingInternal = true;
    this.isPaused = false;

    let finished = false;
    const finish = (isErr = false, msg?: string) => {
      if (finished || this.playbackToken !== token) return;
      finished = true;
      this.cleanupAudio(options.onMouthLevel);
      if (isErr) {
        options.onError?.(msg || 'Doğrulanmış Arapça ses dosyası oynatılamadı.');
      } else {
        options.onEnd?.();
      }
    };

    const expectedSha = (options.expectedSha256 || '').trim().toLowerCase();
    const canVerifyWebSha =
      Boolean(expectedSha) &&
      typeof fetch === 'function' &&
      Boolean(globalThis.crypto?.subtle?.digest) &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function';

    if (canVerifyWebSha) {
      const controller = new AbortController();
      this.webAbortController = controller;
      void (async () => {
        const result = await verifyAudioUrlSha256(cleanUrl, expectedSha, fetch, controller.signal);
        if (controller.signal.aborted || finished || this.playbackToken !== token) return;
        this.webAbortController = null;
        if (!result.ok || !result.blob) {
          finish(true, result.error || `Ses dosyası SHA-256 doğrulamasından geçemedi (${cleanUrl}).`);
          return;
        }
        const blobUrl = URL.createObjectURL(result.blob);
        this.objectUrl = blobUrl;
        this.startWebAudioElement(blobUrl, cleanUrl, options, token, finish);
      })();
      return;
    }

    this.startWebAudioElement(cleanUrl, cleanUrl, options, token, finish);
  }

  pause(): void {
    this.isPaused = true;
    if (this.playbackMode === 'native') {
      void pauseNativeArabicAudio();
      return;
    }
    if (this.audioEl && !this.audioEl.paused) {
      this.audioEl.pause();
    }
  }

  resume(): void {
    this.isPaused = false;
    if (this.playbackMode === 'native') {
      void resumeNativeArabicAudio();
      return;
    }
    if (this.audioEl && this.audioEl.paused) {
      this.audioEl.play().catch(() => {
        // ignore
      });
    }
  }

  stop(): void {
    this.playbackToken++;
    if (this.playbackMode === 'native') {
      void stopNativeArabicAudio();
    }
    this.cleanupAudio();
  }
}

export const verifiedArabicAudioPlayer = new VerifiedAudioClipPlayer();
export const browserTTSProvider = new BrowserSpeechSynthesisProvider();
export const nativeAndroidTTSProvider = new NativeAndroidTTSProvider();
export const serverNeuralTTSProvider = new ServerNeuralTTSProvider();
export const seslenLocalTTSProvider = new SeslenLocalTTSProvider();
export const emaLocalTTSProvider = new EmaLightningLocalTTSProvider();
export const zerreLocalTTSProvider = new ZerreLocalTTSProvider();
export const studioTTSRouter = new StudioTTSRouter(
  browserTTSProvider,
  nativeAndroidTTSProvider,
  serverNeuralTTSProvider,
  seslenLocalTTSProvider,
  emaLocalTTSProvider,
  zerreLocalTTSProvider
);
