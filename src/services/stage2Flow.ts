import {
  GiftRule,
  HighTierDuaEntry,
  PrayerCategoryId,
  PrayerTemplate,
  QueueEvent,
  ScholarId,
  TTSSpeakOptions,
  YasinRecitationConfig,
} from '../types/nuridua';
import { renderPersonalizedPrayer, sanitizeUsername } from '../utils/sanitize';
import { containsArabicScript, sanitizeTurkishTtsPayload, stripArabicScriptForTurkishTts } from './ttsService';

export const YASIN_ACCEPTED_AUDIO_FORMATS = ['.mp3', '.m4a', '.ogg', '.wav'] as const;

export function isSupportedYasinAudioFormat(url: string): boolean {
  const clean = (url || '').trim().split('?')[0].split('#')[0].toLowerCase();
  if (!clean) return false;
  return YASIN_ACCEPTED_AUDIO_FORMATS.some((ext) => clean.endsWith(ext));
}

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

export function stripTurkishMeaningFromSpeech(text: string, turkishMeaning?: string): string {
  return sanitizeTurkishTtsPayload(text, turkishMeaning);
}

/**
 * Builds ONLY the personalized Turkish supplication for the sender, their parents,
 * family, and relatives.
 * - Strictly excludes `turkishMeaning` (meal) from TTS output (`turkishMeaning` is display-only).
 * - Strictly strips any Arabic script characters so Arabic text never reaches Turkish TTS.
 */
export function buildHighTierTurkishSpeech(dua: HighTierDuaEntry, username: string): string {
  const personalized = stripArabicScriptForTurkishTts(
    renderPersonalizedPrayer(dua.personalPrayerTemplate || '', username)
  );
  return stripTurkishMeaningFromSpeech(personalized, dua.turkishMeaning);
}

/**
 * Builds Hacı Ahmet Efendi's (scholar_1) verbatim Yâsîn-i Şerîf takdim / başlangıç konuşması.
 * Preserves full template wording without shortening or summarizing.
 */
export function buildYasinIntroSpeech(yasin: YasinRecitationConfig, username: string): string {
  const personalized = stripArabicScriptForTurkishTts(
    renderPersonalizedPrayer(yasin.introSpeechTemplate || '', username)
  );
  return stripTurkishMeaningFromSpeech(personalized, yasin.turkishMealNotice);
}

/**
 * Builds Hacı Ahmet Efendi's (scholar_1) verbatim Yâsîn-i Şerîf closing thank-you & ithaf prayer
 * for the sender, their parents, family, relatives, and deceased relatives.
 * Preserves full template wording without shortening or summarizing.
 */
export function buildYasinClosingSpeech(yasin: YasinRecitationConfig, username: string): string {
  const personalized = stripArabicScriptForTurkishTts(
    renderPersonalizedPrayer(yasin.closingPrayerTemplate || '', username)
  );
  return stripTurkishMeaningFromSpeech(personalized, yasin.turkishMealNotice);
}

export function buildMissingYasinAudioMessage(
  yasinOrEvent?: Partial<YasinRecitationConfig> | Partial<QueueEvent>
): string {
  const audioUrl =
    (yasinOrEvent && 'audioUrl' in yasinOrEvent ? yasinOrEvent.audioUrl : undefined) ||
    (yasinOrEvent && 'arabicAudioUrl' in yasinOrEvent ? yasinOrEvent.arabicAudioUrl : undefined) ||
    '/audio/duas/yasin_i_serif_verified.mp3';
  const formats = YASIN_ACCEPTED_AUDIO_FORMATS.join(', ');
  return `Yâsîn-i Şerîf tam kârî ses dosyası henüz doğrulanmadı veya eksik (${audioUrl}). Gerçek kârî ses kaydı olmadan Yâsîn okunuyor gibi gösterilmez; lisanslı ve eksiksiz ses dosyasını (${formats}) projenin public${audioUrl.startsWith('/') ? audioUrl : '/' + audioUrl} konumuna ekleyip audioStatus değerini verified_ready yapın.`;
}

/**
 * Inserts a new queued event strictly preserving any currently speaking event at the front
 * while ordering pending events by GiftPriority (urgent > high > normal).
 */
export function insertQueueEventPreservingActive(
  queue: QueueEvent[],
  queuedEvent: QueueEvent
): QueueEvent[] {
  const priorityRank: Record<GiftRule['priority'], number> = {
    urgent: 3,
    high: 2,
    normal: 1,
  };
  const seen = new Set<string>();
  const unique: QueueEvent[] = [];
  for (const ev of [...queue, queuedEvent]) {
    if (!ev || !ev.id || seen.has(ev.id)) continue;
    seen.add(ev.id);
    unique.push(ev);
  }
  return unique.sort((a, b) => {
    if (a.status === 'speaking' && b.status !== 'speaking') return -1;
    if (b.status === 'speaking' && a.status !== 'speaking') return 1;
    return priorityRank[b.priority] - priorityRank[a.priority];
  });
}

export interface ArabicClipAdapter {
  play(
    url: string,
    opts: {
      volume: number;
      expectedSha256?: string;
      onStart?: (info?: { durationMs?: number }) => void;
      onMouthLevel?: (level: number) => void;
      onProgress?: (info: { positionMs: number; durationMs: number }) => void;
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

export type PlaybackSequencePhase = 'yasin_intro' | 'arabic_audio' | 'turkish_speech' | 'done';

export interface Stage2PlaybackHandle {
  pause(): void;
  resume(): void;
  cancel(): void;
  isLocked(): boolean;
  getPhase(): PlaybackSequencePhase;
}

export interface Stage2PlaybackParams {
  event: QueueEvent;
  arabicPlayer: ArabicClipAdapter;
  turkishTts: TurkishTtsAdapter;
  ttsOptions: Omit<TTSSpeakOptions, 'onStart' | 'onMouthLevel' | 'onEnd' | 'onError'>;
  onPhaseChange?: (phase: 'yasin_intro' | 'arabic_audio' | 'turkish_speech') => void;
  onStart?: () => void;
  onMouthLevel?: (level: number) => void;
  onFallbackNotice?: (reason: string) => void;
  onComplete: () => void;
  onError: (reason: string) => void;
}

/**
 * Orchestrates Stage 2 & Stage 3 event playback with strict audio-isolation lock:
 * - For `yasin_300` (300+ coins): runs an atomic 3-phase sequence on Hacı Ahmet Efendi (`scholar_1`):
 *   1) `yasin_intro`: Hacı Ahmet Efendi opening takdim speech
 *   2) `arabic_audio`: Full verified Yâsîn-i Şerîf Qari audio recording
 *   3) `turkish_speech`: Hacı Ahmet Efendi long closing thank-you & ithaf prayer
 *   If Yâsîn audio is missing, unverified, or corrupt, fails cleanly without pretending Yâsîn played and releases lock.
 * - For `high_gift` (150-299 coins): plays verified Arabic Qari audio FIRST (when verified_ready),
 *   then routes ONLY the personalized family/parents/relatives dua (NEVER Arabic, NEVER Turkish meal)
 *   to the scholar's isolated TTS engine.
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
  let phase: PlaybackSequencePhase =
    event.tier === 'yasin_300' ? 'yasin_intro' : 'turkish_speech';
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

  const buildSafeTurkish = (rawText: string) => {
    let safe = containsArabicScript(rawText)
      ? stripArabicScriptForTurkishTts(rawText)
      : (rawText || '').trim();
    if (event.tier === 'high_gift' || event.tier === 'yasin_300' || event.turkishMeaning) {
      safe = stripTurkishMeaningFromSpeech(safe, event.turkishMeaning);
    }
    return safe;
  };

  const startTurkishPhase = (forcedScholarId?: ScholarId) => {
    if (cancelled || completed) return;
    phase = 'turkish_speech';
    onPhaseChange?.('turkish_speech');

    const safeTurkishText = buildSafeTurkish(event.renderedPrayer);
    if (!safeTurkishText) {
      finishError('Seslendirilecek Türkçe dua/selamlama metni boş.');
      return;
    }

    const effectiveScholar = (forcedScholarId || ttsOptions.scholarId || event.scholarId) as ScholarId;
    turkishTts.speak(safeTurkishText, {
      ...ttsOptions,
      scholarId: effectiveScholar,
      forbiddenMealText: event.turkishMeaning,
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

  if (event.tier === 'yasin_300') {
    // Yâsîn-i Şerîf strictly requires a verified real Qari audio recording; never pretend it plays if missing/unverified.
    const audioUrl = (event.arabicAudioUrl || '').trim();
    if (
      event.arabicAudioStatus !== 'verified_ready' ||
      !audioUrl ||
      !isSupportedYasinAudioFormat(audioUrl)
    ) {
      finishError(buildMissingYasinAudioMessage(event));
      return {
        pause() {},
        resume() {},
        cancel() {
          cancelled = true;
          locked = false;
          phase = 'done';
        },
        isLocked() {
          return false;
        },
        getPhase() {
          return 'done';
        },
      };
    }

    const safeIntro = buildSafeTurkish(event.yasinIntroSpeech || '');
    const startYasinAudioPhase = () => {
      if (cancelled || completed) return;
      phase = 'arabic_audio';
      onPhaseChange?.('arabic_audio');
      arabicPlayer.play(audioUrl, {
        volume: ttsOptions.volume,
        expectedSha256: event.yasinAudioSha256,
        onStart: () => {
          notifyStartOnce();
        },
        onMouthLevel: (lvl) => {
          if (!cancelled && !completed) onMouthLevel?.(lvl);
        },
        onEnd: () => {
          if (cancelled || completed) return;
          onMouthLevel?.(0);
          // Phase 3: Hacı Ahmet Efendi long closing thank-you & ithaf prayer
          startTurkishPhase('scholar_1');
        },
        onError: (reason) => {
          if (cancelled || completed) return;
          finishError(
            `Yâsîn-i Şerîf kârî ses dosyası çalınamadı (${reason}). Desteklenen biçimler: ${YASIN_ACCEPTED_AUDIO_FORMATS.join(', ')}.`
          );
        },
      });
    };

    if (safeIntro) {
      // Phase 1: Hacı Ahmet Efendi (scholar_1 -> Seslen-TTS Hasan) Yâsîn takdim konuşması
      phase = 'yasin_intro';
      onPhaseChange?.('yasin_intro');
      turkishTts.speak(safeIntro, {
        ...ttsOptions,
        scholarId: 'scholar_1',
        forbiddenMealText: event.turkishMeaning,
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
          if (cancelled || completed) return;
          onMouthLevel?.(0);
          startYasinAudioPhase();
        },
        onError: (reason) => {
          finishError(`Yâsîn takdim konuşması hatası: ${reason}`);
        },
      });
    } else {
      startYasinAudioPhase();
    }
  } else {
    const shouldPlayArabicFirst =
      event.tier === 'high_gift' &&
      Boolean(event.arabicHarekeli);

    if (shouldPlayArabicFirst) {
      if (event.arabicAudioStatus === 'verified_ready' && event.arabicAudioUrl?.trim()) {
        phase = 'arabic_audio';
        onPhaseChange?.('arabic_audio');
        arabicPlayer.play(event.arabicAudioUrl.trim(), {
          volume: ttsOptions.volume,
          expectedSha256: event.yasinAudioSha256,
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
              `Doğrulanmış Arapça ses dosyası çalınamadı (${reason}); yalnızca Türkçe dua okunuyor.`
            );
            onMouthLevel?.(0);
            startTurkishPhase();
          },
        });
      } else {
        onFallbackNotice?.(
          'Yüksek seviye dua için doğrulanmış Arapça ses kaydı henüz hazır değil; Arapça metin Türkçe TTS ile okunmadı, yalnızca Türkçe dua okunuyor.'
        );
        startTurkishPhase();
      }
    } else {
      startTurkishPhase();
    }
  }

  return {
    pause() {
      if (cancelled || completed) return;
      if (phase === 'arabic_audio') {
        arabicPlayer.pause();
      } else if (phase === 'yasin_intro' || phase === 'turkish_speech') {
        turkishTts.pause();
      }
    },
    resume() {
      if (cancelled || completed) return;
      if (phase === 'arabic_audio') {
        arabicPlayer.resume();
      } else if (phase === 'yasin_intro' || phase === 'turkish_speech') {
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
