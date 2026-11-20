import {
  HighTierDuaEntry,
  PrayerCategoryId,
  PrayerTemplate,
  QueueEvent,
  ScholarId,
  TTSSpeakOptions,
} from '../types/nuridua';
import { renderPersonalizedPrayer, sanitizeUsername } from '../utils/sanitize';
import { containsArabicScript, stripArabicScriptForTurkishTts } from './ttsService';

export function normalizeFollowSessionKey(input: { userId?: string; username?: string }): string {
  const cleanUserId = input.userId !== undefined && input.userId !== null ? String(input.userId).trim() : '';
  if (cleanUserId) {
    return `uid:${cleanUserId}`;
  }
  const cleanUser = sanitizeUsername(input.username || 'Misafir');
  return `uname:${cleanUser.toLowerCase()}`;
}

export function pickNonConsecutiveFromPool<T extends { id: string }>(
  pool: T[],
  lastPickedId: string | null,
  rng: () => number = Math.random
): T | null {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  const candidates = lastPickedId ? pool.filter((item) => item.id !== lastPickedId) : pool;
  const effectivePool = candidates.length > 0 ? candidates : pool;
  const idx = Math.min(effectivePool.length - 1, Math.max(0, Math.floor(rng() * effectivePool.length)));
  return effectivePool[idx];
}

export function pickNonConsecutiveMidPrayer(
  prayers: PrayerTemplate[],
  lastPrayerId: string | null,
  rng: () => number = Math.random
): PrayerTemplate | null {
  const activeMidPool = prayers.filter((p) => p.isActive && p.category === 'mid_opening');
  if (activeMidPool.length > 0) {
    return pickNonConsecutiveFromPool(activeMidPool, lastPrayerId, rng);
  }
  const activeFallback = prayers.filter((p) => p.isActive);
  return pickNonConsecutiveFromPool(activeFallback, lastPrayerId, rng);
}

export function pickNonConsecutivePrayerByCategory(
  prayers: PrayerTemplate[],
  category: PrayerCategoryId,
  lastPrayerId: string | null,
  rng: () => number = Math.random
): PrayerTemplate | null {
  const allActive = prayers.filter((p) => p.isActive);
  if (allActive.length === 0) return null;
  const catPool = allActive.filter((p) => p.category === category);
  return pickNonConsecutiveFromPool(catPool.length > 0 ? catPool : allActive, lastPrayerId, rng);
}

export function pickNonConsecutiveHighDua(
  duas: HighTierDuaEntry[],
  lastDuaId: string | null,
  rng: () => number = Math.random
): HighTierDuaEntry | null {
  const active = duas.filter((d) => d.isActive);
  return pickNonConsecutiveFromPool(active, lastDuaId, rng);
}

/**
 * Combines the Turkish meaning of the verified Arabic dua and the personalized
 * Turkish supplication for the sender, their parents, family, and relatives.
 * Strictly strips any Arabic script characters so Arabic text never reaches Turkish TTS.
 */
export function buildHighTierTurkishSpeech(dua: HighTierDuaEntry, username: string): string {
  const meaning = stripArabicScriptForTurkishTts(dua.turkishMeaning || '');
  const personalized = stripArabicScriptForTurkishTts(
    renderPersonalizedPrayer(dua.personalPrayerTemplate || '', username)
  );
  const combined = [meaning, personalized].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return combined;
}

export interface ArabicClipAdapter {
  play(
    url: string,
    opts: {
      volume: number;
      onStart?: () => void;
      onMouthLevel?: (level: number) => void;
      onEnd?: () => void;
      onError?: (reason: string) => void;
    }
  ): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface TurkishTtsAdapter {
  speak(text: string, options: TTSSpeakOptions): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface Stage2PlaybackHandle {
  pause(): void;
  resume(): void;
  cancel(): void;
  isLocked(): boolean;
  getPhase(): 'arabic_audio' | 'turkish_speech' | 'done';
}

export interface Stage2PlaybackParams {
  event: QueueEvent;
  arabicPlayer: ArabicClipAdapter;
  turkishTts: TurkishTtsAdapter;
  ttsOptions: Omit<TTSSpeakOptions, 'onStart' | 'onMouthLevel' | 'onEnd' | 'onError'>;
  onPhaseChange?: (phase: 'arabic_audio' | 'turkish_speech') => void;
  onStart?: () => void;
  onMouthLevel?: (level: number) => void;
  onFallbackNotice?: (reason: string) => void;
  onComplete: () => void;
  onError: (reason: string) => void;
}

/**
 * Orchestrates Stage 2 event playback with strict audio-isolation lock:
 * - For `high_gift`: plays verified CC0/reuse-permitted Arabic Qari audio FIRST (when verified_ready),
 *   then routes ONLY the Turkish meaning + personalized family/parents/relatives dua to the
 *   scholar's isolated TTS engine (`scholar_1` -> Seslen-TTS Hasan, `scholar_2` -> Antalia-2 Mini).
 * - Never sends Arabic script to Turkish TTS.
 * - Never permits concurrent interruption while active unless `cancel()` is explicitly called.
 */
export function executeStage2PlaybackSequence(params: Stage2PlaybackParams): Stage2PlaybackHandle {
  const {
    event,
    arabicPlayer,
    turkishTts,
    ttsOptions,
    onPhaseChange,
    onStart,
    onMouthLevel,
    onFallbackNotice,
    onComplete,
    onError,
  } = params;

  let cancelled = false;
  let completed = false;
  let locked = true;
  let phase: 'arabic_audio' | 'turkish_speech' | 'done' = 'turkish_speech';
  let startNotified = false;

  const notifyStartOnce = () => {
    if (!startNotified && !cancelled && !completed) {
      startNotified = true;
      onStart?.();
    }
  };

  const finishSuccess = () => {
    if (cancelled || completed) return;
    completed = true;
    locked = false;
    phase = 'done';
    onMouthLevel?.(0);
    onComplete();
  };

  const finishError = (reason: string) => {
    if (cancelled || completed) return;
    completed = true;
    locked = false;
    phase = 'done';
    onMouthLevel?.(0);
    onError(reason);
  };

  const startTurkishPhase = () => {
    if (cancelled || completed) return;
    phase = 'turkish_speech';
    onPhaseChange?.('turkish_speech');

    const safeTurkishText = containsArabicScript(event.renderedPrayer)
      ? stripArabicScriptForTurkishTts(event.renderedPrayer)
      : event.renderedPrayer.trim();

    if (!safeTurkishText) {
      finishError('Seslendirilecek Türkçe dua/selamlama metni boş.');
      return;
    }

    turkishTts.speak(safeTurkishText, {
      ...ttsOptions,
      scholarId: (ttsOptions.scholarId || event.scholarId) as ScholarId,
      onStart: () => {
        notifyStartOnce();
      },
      onMouthLevel: (lvl) => {
        if (!cancelled && !completed) onMouthLevel?.(lvl);
      },
      onFallbackNotice: (reason) => {
        if (!cancelled && !completed) onFallbackNotice?.(reason);
      },
      onEnd: () => {
        finishSuccess();
      },
      onError: (reason) => {
        finishError(reason);
      },
    });
  };

  const shouldPlayArabicFirst =
    event.tier === 'high_gift' &&
    Boolean(event.arabicHarekeli);

  if (shouldPlayArabicFirst) {
    if (event.arabicAudioStatus === 'verified_ready' && event.arabicAudioUrl?.trim()) {
      phase = 'arabic_audio';
      onPhaseChange?.('arabic_audio');
      arabicPlayer.play(event.arabicAudioUrl.trim(), {
        volume: ttsOptions.volume,
        onStart: () => {
          notifyStartOnce();
        },
        onMouthLevel: (lvl) => {
          if (!cancelled && !completed) onMouthLevel?.(lvl);
        },
        onEnd: () => {
          if (!cancelled && !completed) {
            onMouthLevel?.(0);
            startTurkishPhase();
          }
        },
        onError: (reason) => {
          if (cancelled || completed) return;
          onFallbackNotice?.(
            `Doğrulanmış Arapça ses dosyası çalınamadı (${reason}); Türkçe meal ve dua okunuyor.`
          );
          onMouthLevel?.(0);
          startTurkishPhase();
        },
      });
    } else {
      onFallbackNotice?.(
        'Yüksek seviye dua için doğrulanmış Arapça ses kaydı henüz hazır değil; Arapça metin Türkçe TTS ile okunmadı, yalnızca Türkçe meal ve dua okunuyor.'
      );
      startTurkishPhase();
    }
  } else {
    startTurkishPhase();
  }

  return {
    pause() {
      if (cancelled || completed) return;
      if (phase === 'arabic_audio') {
        arabicPlayer.pause();
      } else if (phase === 'turkish_speech') {
        turkishTts.pause();
      }
    },
    resume() {
      if (cancelled || completed) return;
      if (phase === 'arabic_audio') {
        arabicPlayer.resume();
      } else if (phase === 'turkish_speech') {
        turkishTts.resume();
      }
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      locked = false;
      phase = 'done';
      arabicPlayer.stop();
      turkishTts.stop();
      onMouthLevel?.(0);
    },
    isLocked() {
      return locked && !cancelled && !completed;
    },
    getPhase() {
      return phase;
    },
  };
}
