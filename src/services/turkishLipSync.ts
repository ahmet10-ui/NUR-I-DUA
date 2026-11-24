import {
  LipSyncFrame,
  LipSyncSyncMode,
  LipSyncVisemeId,
  QueueEvent,
  ScholarAnimationSnapshot,
  ScholarId,
} from '../types/nuridua';

export interface StagePlaybackState {
  activeScholar: ScholarId;
  isSpeaking: boolean;
  mouthLevel: number;
  lipSync?: LipSyncFrame;
  playbackPhase?: QueueEvent['playbackPhase'];
  scholarAnimation?: Partial<Record<ScholarId, ScholarAnimationSnapshot>>;
}

export interface ScholarArticulationTargets {
  isSpeakerPosture: boolean;
  isListenerPosture: boolean;
  isMouthArticulating: boolean;
  jawOpen: number;
  lipRound: number;
  lipClose: number;
  lipSpread: number;
  lowerLipTuck: number;
}

export interface VisemeTargetWeights {
  level: number;
  jawOpen: number;
  lipRound: number;
  lipClose: number;
  lipSpread: number;
  lowerLipTuck: number;
}

export interface TurkishVisemeCue {
  viseme: LipSyncVisemeId;
  startMs: number;
  endMs: number;
  durationMs: number;
  charStart: number;
  charEnd: number;
  isPause: boolean;
  weights: VisemeTargetWeights;
}

export interface TurkishWordAnchor {
  charStart: number;
  charEnd: number;
  cueIndex: number;
  startMs: number;
  endMs: number;
}

export interface TurkishVisemeTimeline {
  text: string;
  rate: number;
  totalMs: number;
  cues: TurkishVisemeCue[];
  words: TurkishWordAnchor[];
}

export interface SpectralLipSyncCue {
  /** Low/F1 formant energy normalized 0..1 (open vowels A/E) */
  lowRatio?: number;
  /** Mid/F2 energy normalized 0..1 (front vowels İ/E) */
  midRatio?: number;
  /** High-frequency energy ratio normalized 0..1 (F/V/S/Ş fricatives) */
  highRatio?: number;
}

export const REST_WEIGHTS: VisemeTargetWeights = Object.freeze({
  level: 0,
  jawOpen: 0,
  lipRound: 0,
  lipClose: 0,
  lipSpread: 0,
  lowerLipTuck: 0,
});

export const VISEME_SHAPES: Record<LipSyncVisemeId, VisemeTargetWeights> = {
  rest: {
    level: 0,
    jawOpen: 0,
    lipRound: 0,
    lipClose: 0,
    lipSpread: 0,
    lowerLipTuck: 0,
  },
  closed_mbp: {
    level: 0.04,
    jawOpen: 0,
    lipRound: 0.04,
    lipClose: 0.94,
    lipSpread: 0,
    lowerLipTuck: 0,
  },
  labiodental_fv: {
    level: 0.14,
    jawOpen: 0.09,
    lipRound: 0,
    lipClose: 0.14,
    lipSpread: 0.14,
    lowerLipTuck: 0.9,
  },
  open_a: {
    level: 0.8,
    jawOpen: 0.78,
    lipRound: 0,
    lipClose: 0,
    lipSpread: 0.08,
    lowerLipTuck: 0,
  },
  open_e: {
    level: 0.56,
    jawOpen: 0.48,
    lipRound: 0,
    lipClose: 0,
    lipSpread: 0.34,
    lowerLipTuck: 0,
  },
  round_o: {
    level: 0.52,
    jawOpen: 0.36,
    lipRound: 0.86,
    lipClose: 0,
    lipSpread: 0,
    lowerLipTuck: 0,
  },
  round_u: {
    level: 0.34,
    jawOpen: 0.18,
    lipRound: 0.98,
    lipClose: 0,
    lipSpread: 0,
    lowerLipTuck: 0,
  },
  spread_i: {
    level: 0.3,
    jawOpen: 0.18,
    lipRound: 0,
    lipClose: 0,
    lipSpread: 0.74,
    lowerLipTuck: 0,
  },
  neutral_c: {
    level: 0.12,
    jawOpen: 0.08,
    lipRound: 0.05,
    lipClose: 0.08,
    lipSpread: 0.09,
    lowerLipTuck: 0,
  },
};

export function createRestingLipSyncFrame(
  scholarId?: ScholarId,
  syncMode: LipSyncSyncMode = 'resting',
  isPause = false
): LipSyncFrame {
  return {
    level: 0,
    viseme: 'rest',
    jawOpen: 0,
    lipRound: 0,
    lipClose: 0,
    lipSpread: 0,
    lowerLipTuck: 0,
    active: false,
    isPause,
    scholarId,
    syncMode,
  };
}

export function scalarLevelToLipSyncFrame(
  level: number,
  scholarId?: ScholarId,
  syncMode: LipSyncSyncMode = 'pcm_envelope_viseme'
): LipSyncFrame {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  if (clamped <= 0.025) {
    return createRestingLipSyncFrame(scholarId, syncMode);
  }
  return {
    level: clamped,
    viseme: clamped > 0.62 ? 'open_a' : clamped > 0.32 ? 'open_e' : 'neutral_c',
    jawOpen: Math.min(0.86, clamped * 0.85),
    lipRound: 0,
    lipClose: 0,
    lipSpread: clamped > 0.3 ? 0.18 : 0.08,
    lowerLipTuck: 0,
    active: true,
    scholarId,
    syncMode,
  };
}

/**
 * Pure per-scholar articulation resolver used by both the live WebGL loop and automated tests.
 * Enforces strict single-speaker mouth isolation and zero fake lip-sync during Arabic Qari MP3 playback.
 */
export function resolveStageScholarArticulation(
  playback: StagePlaybackState,
  scholarIndex: 0 | 1
): ScholarArticulationTargets {
  const scholarId: ScholarId = scholarIndex === 1 ? 'scholar_2' : 'scholar_1';
  const activeIdx = playback.activeScholar === 'scholar_2' ? 1 : 0;
  const animSnap = playback.scholarAnimation?.[scholarId];
  const isAmeenSpeaking =
    Boolean(animSnap?.phase === 'AMEEN' && animSnap.mouthAllowed) && activeIdx === scholarIndex;
  const isSpeakerPosture = (playback.isSpeaking || isAmeenSpeaking) && activeIdx === scholarIndex;
  const isListenerPosture = playback.isSpeaking && activeIdx !== scholarIndex;

  const animationBlocksMouth = animSnap ? !animSnap.mouthAllowed : false;

  if (!isSpeakerPosture || playback.playbackPhase === 'arabic_audio' || animationBlocksMouth) {
    return {
      isSpeakerPosture,
      isListenerPosture,
      isMouthArticulating: false,
      jawOpen: 0,
      lipRound: 0,
      lipClose: 0,
      lipSpread: 0,
      lowerLipTuck: 0,
    };
  }

  const frame =
    playback.lipSync ??
    scalarLevelToLipSyncFrame(playback.mouthLevel, playback.activeScholar);

  if (!frame.active || frame.viseme === 'rest') {
    return {
      isSpeakerPosture,
      isListenerPosture,
      isMouthArticulating: false,
      jawOpen: 0,
      lipRound: 0,
      lipClose: 0,
      lipSpread: 0,
      lowerLipTuck: 0,
    };
  }

  return {
    isSpeakerPosture,
    isListenerPosture,
    isMouthArticulating: true,
    jawOpen: Math.max(0, Math.min(0.84, frame.jawOpen)),
    lipRound: Math.max(0, Math.min(1.0, frame.lipRound)),
    lipClose: Math.max(0, Math.min(1.0, frame.lipClose)),
    lipSpread: Math.max(0, Math.min(1.0, frame.lipSpread)),
    lowerLipTuck: Math.max(0, Math.min(1.0, frame.lowerLipTuck)),
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function cloneWeights(w: VisemeTargetWeights): VisemeTargetWeights {
  return {
    level: w.level,
    jawOpen: w.jawOpen,
    lipRound: w.lipRound,
    lipClose: w.lipClose,
    lipSpread: w.lipSpread,
    lowerLipTuck: w.lowerLipTuck,
  };
}

function normalizeTurkishLowerChar(ch: string): string {
  // Handle Turkish dotted/dotless I explicitly regardless of host JS locale
  if (ch === 'İ' || ch === 'i' || ch === 'î' || ch === 'Î') return 'i';
  if (ch === 'I' || ch === 'ı') return 'ı';
  if (ch === 'Â' || ch === 'â') return 'a';
  if (ch === 'Û' || ch === 'û') return 'u';
  if (ch === 'Ş' || ch === 'ş') return 'ş';
  if (ch === 'Ç' || ch === 'ç') return 'ç';
  if (ch === 'Ğ' || ch === 'ğ') return 'ğ';
  if (ch === 'Ö' || ch === 'ö') return 'ö';
  if (ch === 'Ü' || ch === 'ü') return 'ü';
  return ch.toLocaleLowerCase('tr-TR');
}

function isVowelChar(ch: string): boolean {
  return ch === 'a' || ch === 'e' || ch === 'ı' || ch === 'i' || ch === 'o' || ch === 'ö' || ch === 'u' || ch === 'ü';
}

function isMajorPunctuation(ch: string): boolean {
  return ch === '.' || ch === '!' || ch === '?' || ch === '…' || ch === '\n';
}

function isMinorPunctuation(ch: string): boolean {
  return ch === ',' || ch === ';' || ch === ':' || ch === '–' || ch === '—' || ch === '-' || ch === ')' || ch === '(';
}

export function characterToTurkishViseme(rawChar: string): {
  viseme: LipSyncVisemeId;
  baseDurationMs: number;
  weights: VisemeTargetWeights;
  isSilentOrPause?: boolean;
  isLengthener?: boolean;
} {
  const ch = normalizeTurkishLowerChar(rawChar);

  if (isMajorPunctuation(ch)) {
    return { viseme: 'rest', baseDurationMs: 320, weights: cloneWeights(VISEME_SHAPES.rest), isSilentOrPause: true };
  }
  if (isMinorPunctuation(ch)) {
    return { viseme: 'rest', baseDurationMs: 175, weights: cloneWeights(VISEME_SHAPES.rest), isSilentOrPause: true };
  }
  if (/\s/.test(ch)) {
    return { viseme: 'rest', baseDurationMs: 36, weights: cloneWeights(VISEME_SHAPES.rest), isSilentOrPause: true };
  }

  // Soft g lengthens the preceding vowel cleanly rather than opening/flapping on a consonant
  if (ch === 'ğ') {
    return {
      viseme: 'neutral_c',
      baseDurationMs: 70,
      weights: cloneWeights(VISEME_SHAPES.neutral_c),
      isLengthener: true,
    };
  }

  switch (ch) {
    case 'a':
      return { viseme: 'open_a', baseDurationMs: 108, weights: cloneWeights(VISEME_SHAPES.open_a) };
    case 'e':
      return { viseme: 'open_e', baseDurationMs: 96, weights: cloneWeights(VISEME_SHAPES.open_e) };
    case 'o':
      return { viseme: 'round_o', baseDurationMs: 104, weights: cloneWeights(VISEME_SHAPES.round_o) };
    case 'ö':
      return {
        viseme: 'round_o',
        baseDurationMs: 98,
        weights: { ...VISEME_SHAPES.round_o, jawOpen: 0.36, lipRound: 0.9 },
      };
    case 'u':
      return { viseme: 'round_u', baseDurationMs: 102, weights: cloneWeights(VISEME_SHAPES.round_u) };
    case 'ü':
      return {
        viseme: 'round_u',
        baseDurationMs: 96,
        weights: { ...VISEME_SHAPES.round_u, jawOpen: 0.2, lipRound: 1.0 },
      };
    case 'i':
      return { viseme: 'spread_i', baseDurationMs: 88, weights: cloneWeights(VISEME_SHAPES.spread_i) };
    case 'ı':
      return {
        viseme: 'spread_i',
        baseDurationMs: 88,
        weights: { ...VISEME_SHAPES.spread_i, jawOpen: 0.24, lipSpread: 0.56 },
      };
    case 'm':
    case 'b':
    case 'p':
      return { viseme: 'closed_mbp', baseDurationMs: 76, weights: cloneWeights(VISEME_SHAPES.closed_mbp) };
    case 'f':
    case 'v':
      return { viseme: 'labiodental_fv', baseDurationMs: 76, weights: cloneWeights(VISEME_SHAPES.labiodental_fv) };
    case 'ç':
    case 'c':
    case 'ş':
    case 'j':
      return {
        viseme: 'neutral_c',
        baseDurationMs: 60,
        weights: { level: 0.16, jawOpen: 0.11, lipRound: 0.28, lipClose: 0.04, lipSpread: 0.06, lowerLipTuck: 0 },
      };
    case 's':
    case 'z':
      return {
        viseme: 'neutral_c',
        baseDurationMs: 58,
        weights: { level: 0.12, jawOpen: 0.07, lipRound: 0, lipClose: 0.08, lipSpread: 0.24, lowerLipTuck: 0 },
      };
    case 't':
    case 'd':
    case 'n':
    case 'l':
    case 'r':
    case 'k':
    case 'g':
    case 'h':
    case 'y':
      return {
        viseme: 'neutral_c',
        baseDurationMs: 50,
        weights: { level: 0.1, jawOpen: 0.08, lipRound: 0.03, lipClose: 0.07, lipSpread: 0.09, lowerLipTuck: 0 },
      };
    default:
      return { viseme: 'rest', baseDurationMs: 40, weights: cloneWeights(VISEME_SHAPES.rest), isSilentOrPause: true };
  }
}

/**
 * Builds a phoneme-accurate Turkish viseme timeline with preserved character offsets
 * so boundary callbacks (`SpeechSynthesisEvent.charIndex`, Android `onRangeStart`)
 * and audio duration progress lock cleanly onto the exact spoken word/phoneme.
 */
export function buildTurkishVisemeTimeline(text: string, rate = 0.94): TurkishVisemeTimeline {
  const safeRate = Math.max(0.55, Math.min(1.65, Number.isFinite(rate) ? rate : 0.94));
  const rateScale = 1 / safeRate;
  const cleanText = text || '';

  const rawCues: Array<Omit<TurkishVisemeCue, 'startMs' | 'endMs'>> = [];
  const words: TurkishWordAnchor[] = [];

  let inWord = false;
  let currentWordStart = 0;
  let currentWordCueStart = 0;

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    const norm = normalizeTurkishLowerChar(ch);
    const isWordChar = /[a-zçğıöşüâîû0-9]/i.test(norm);

    if (isWordChar && !inWord) {
      inWord = true;
      currentWordStart = i;
      currentWordCueStart = rawCues.length;
    } else if (!isWordChar && inWord) {
      inWord = false;
      words.push({
        charStart: currentWordStart,
        charEnd: i,
        cueIndex: currentWordCueStart,
        startMs: 0,
        endMs: 0,
      });
    }

    // Collapse consecutive whitespace or repeated punctuation cleanly
    if (/\s/.test(ch)) {
      const prev = rawCues[rawCues.length - 1];
      if (!prev) continue;
      if (prev.isPause) {
        prev.charEnd = i + 1;
        continue;
      }
      rawCues.push({
        viseme: 'rest',
        durationMs: Math.round(36 * rateScale),
        charStart: i,
        charEnd: i + 1,
        isPause: true,
        weights: cloneWeights(VISEME_SHAPES.rest),
      });
      continue;
    }

    const mapped = characterToTurkishViseme(ch);

    if (mapped.isLengthener) {
      // 'ğ' extends the previous vowel smoothly instead of flapping a consonant
      const prev = rawCues[rawCues.length - 1];
      if (prev && !prev.isPause) {
        prev.durationMs += Math.round(68 * rateScale);
        prev.charEnd = i + 1;
      }
      continue;
    }

    if (mapped.isSilentOrPause) {
      const prev = rawCues[rawCues.length - 1];
      if (prev && prev.isPause) {
        prev.durationMs = Math.max(prev.durationMs, Math.round(mapped.baseDurationMs * rateScale));
        prev.charEnd = i + 1;
        continue;
      }
      rawCues.push({
        viseme: 'rest',
        durationMs: Math.round(mapped.baseDurationMs * rateScale),
        charStart: i,
        charEnd: i + 1,
        isPause: true,
        weights: cloneWeights(VISEME_SHAPES.rest),
      });
      continue;
    }

    // Slight phrase-final vowel lengthening before punctuation/end
    const nextChar = i + 1 < cleanText.length ? cleanText[i + 1] : '';
    const isPhraseFinalVowel =
      isVowelChar(norm) && (!nextChar || isMajorPunctuation(nextChar) || isMinorPunctuation(nextChar));
    const dur = Math.round(mapped.baseDurationMs * (isPhraseFinalVowel ? 1.25 : 1.0) * rateScale);

    // Ensure M/B/P bilabials never drop below a perceptible closure floor
    const finalDur = mapped.viseme === 'closed_mbp' ? Math.max(64, dur) : dur;

    rawCues.push({
      viseme: mapped.viseme,
      durationMs: finalDur,
      charStart: i,
      charEnd: i + 1,
      isPause: false,
      weights: mapped.weights,
    });
  }

  if (inWord) {
    words.push({
      charStart: currentWordStart,
      charEnd: cleanText.length,
      cueIndex: currentWordCueStart,
      startMs: 0,
      endMs: 0,
    });
  }

  // Forward/backward coarticulation pass:
  // Pre-round neutral consonants adjacent to O/Ö/U/Ü without eroding M/B/P closures or F/V tucks.
  for (let i = 0; i < rawCues.length; i++) {
    const cue = rawCues[i];
    if (cue.viseme !== 'neutral_c') continue;
    const prev = i > 0 ? rawCues[i - 1] : null;
    const next = i + 1 < rawCues.length ? rawCues[i + 1] : null;
    const neighborRound = Math.max(
      prev && !prev.isPause && prev.viseme !== 'closed_mbp' ? prev.weights.lipRound : 0,
      next && !next.isPause && next.viseme !== 'closed_mbp' ? next.weights.lipRound : 0
    );
    const neighborSpread = Math.max(
      prev && !prev.isPause ? prev.weights.lipSpread : 0,
      next && !next.isPause ? next.weights.lipSpread : 0
    );
    if (neighborRound > 0.3) {
      cue.weights.lipRound = Math.max(cue.weights.lipRound, neighborRound * 0.48);
    }
    if (neighborSpread > 0.3 && neighborRound < 0.2) {
      cue.weights.lipSpread = Math.max(cue.weights.lipSpread, neighborSpread * 0.35);
    }
  }

  // Compute cumulative timeline timestamps
  let cursorMs = 0;
  const cues: TurkishVisemeCue[] = rawCues.map((c) => {
    const startMs = cursorMs;
    const endMs = startMs + c.durationMs;
    cursorMs = endMs;
    return {
      ...c,
      startMs,
      endMs,
    };
  });

  // Populate word timestamps
  for (let w = 0; w < words.length; w++) {
    const word = words[w];
    const startCue = cues[Math.min(cues.length - 1, Math.max(0, word.cueIndex))];
    if (!startCue) continue;
    word.startMs = startCue.startMs;
    let endMs = startCue.endMs;
    for (let c = word.cueIndex; c < cues.length; c++) {
      if (cues[c].charStart >= word.charEnd) break;
      endMs = cues[c].endMs;
    }
    word.endMs = endMs;
  }

  return {
    text: cleanText,
    rate: safeRate,
    totalMs: cursorMs,
    cues,
    words,
  };
}

export function sampleCueAtTimelineMs(
  timeline: TurkishVisemeTimeline,
  timelineMs: number
): TurkishVisemeCue | null {
  if (!timeline.cues.length) return null;
  if (timelineMs < 0) return null;
  if (timelineMs >= timeline.totalMs) return null;

  // Binary search cue containing timelineMs
  let lo = 0;
  let hi = timeline.cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = timeline.cues[mid];
    if (timelineMs < cue.startMs) {
      hi = mid - 1;
    } else if (timelineMs >= cue.endMs) {
      lo = mid + 1;
    } else {
      return cue;
    }
  }
  return timeline.cues[Math.min(timeline.cues.length - 1, Math.max(0, lo))] || null;
}

export interface TurkishLipSyncControllerOptions {
  text: string;
  rate?: number;
  scholarId?: ScholarId;
  syncMode: LipSyncSyncMode;
  requireEnvelopeForAudioGate?: boolean;
}

/**
 * Stateful real-time synchronizer combining:
 * 1) TTS boundary/range character anchors (`onBoundary(charStart, charLength)`)
 * 2) Exact audio progress when duration is known (`onProgress(posMs, durMs)`)
 * 3) Real-time acoustic envelope & spectral cues (`onAudioEnvelope(rms, spectral)`)
 * 4) Asymmetric physical lip inertia (fast M/B/P bilabial seal, smooth decay on pauses)
 */
export class TurkishLipSyncController {
  private readonly timeline: TurkishVisemeTimeline;
  private readonly scholarId?: ScholarId;
  private readonly syncMode: LipSyncSyncMode;
  private readonly requireEnvelopeForAudioGate: boolean;

  private started = false;
  private paused = false;
  private stopped = false;

  private anchorTimelineMs = 0;
  private anchorWallMs = 0;
  private lastBoundaryTimelineMs = 0;
  private lastBoundaryWallMs = 0;
  private effectiveTempo = 1.0;
  private receivedBoundaryEvent = false;

  private lastProgressUpdateWallMs = 0;
  private lastKnownPositionMs = 0;
  private lastKnownDurationMs = 0;

  private acousticEnvelope = 1.0;
  private acousticSilenceStreakMs = 0;
  private lastEnvelopeWallMs = 0;
  private spectralHint: SpectralLipSyncCue | null = null;

  private smoothed: VisemeTargetWeights = cloneWeights(REST_WEIGHTS);
  private lastSampleWallMs = 0;

  constructor(options: TurkishLipSyncControllerOptions) {
    this.timeline = buildTurkishVisemeTimeline(options.text, options.rate ?? 0.94);
    this.scholarId = options.scholarId;
    this.syncMode = options.syncMode;
    this.requireEnvelopeForAudioGate = Boolean(options.requireEnvelopeForAudioGate);
    if (this.requireEnvelopeForAudioGate) {
      this.acousticEnvelope = 0;
    }
  }

  getTimeline(): TurkishVisemeTimeline {
    return this.timeline;
  }

  start(nowMs = performance.now()): void {
    this.started = true;
    this.paused = false;
    this.stopped = false;
    this.receivedBoundaryEvent = false;
    this.anchorTimelineMs = 0;
    this.anchorWallMs = nowMs;
    this.lastBoundaryTimelineMs = 0;
    this.lastBoundaryWallMs = nowMs;
    this.lastEnvelopeWallMs = nowMs;
    this.lastSampleWallMs = nowMs;
    this.acousticSilenceStreakMs = 0;
  }

  pause(): void {
    this.paused = true;
    this.smoothed = cloneWeights(REST_WEIGHTS);
  }

  resume(nowMs = performance.now()): void {
    if (this.stopped) return;
    this.paused = false;
    this.anchorWallMs = nowMs;
    this.lastSampleWallMs = nowMs;
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    this.paused = false;
    this.smoothed = cloneWeights(REST_WEIGHTS);
  }

  /**
   * Aligns timeline cursor directly to a real TTS word/character boundary event
   * (e.g. Web Speech `utterance.onboundary` `charIndex` or Android `onRangeStart`).
   */
  handleBoundary(charStart: number, charLengthOrEnd?: number, nowMs = performance.now()): void {
    if (!this.started) {
      this.start(nowMs);
    }
    if (this.stopped || this.paused || !this.timeline.cues.length) return;
    this.receivedBoundaryEvent = true;

    const safeChar = Math.max(0, Math.min(this.timeline.text.length, charStart));
    let targetCue = this.timeline.cues.find((c) => safeChar >= c.charStart && safeChar < c.charEnd);
    if (!targetCue) {
      targetCue = this.timeline.cues.find((c) => c.charStart >= safeChar) || this.timeline.cues[this.timeline.cues.length - 1];
    }
    if (!targetCue) return;

    const targetMs = targetCue.startMs;

    // Adapt speaking tempo smoothly using actual wall-time delta vs nominal timeline delta
    const wallDelta = nowMs - this.lastBoundaryWallMs;
    const timelineDelta = targetMs - this.lastBoundaryTimelineMs;
    if (wallDelta > 70 && wallDelta < 3500 && timelineDelta > 40) {
      const measuredTempo = Math.max(0.55, Math.min(1.85, timelineDelta / wallDelta));
      this.effectiveTempo = this.effectiveTempo * 0.65 + measuredTempo * 0.35;
    }

    // If boundary gives word length, refine anchor to matched word start
    if (typeof charLengthOrEnd === 'number' && charLengthOrEnd > 0) {
      const endChar =
        charLengthOrEnd > safeChar && charLengthOrEnd <= this.timeline.text.length + 1
          ? charLengthOrEnd
          : Math.min(this.timeline.text.length, safeChar + charLengthOrEnd);
      const wordMatch = this.timeline.words.find((w) => safeChar >= w.charStart && safeChar <= w.charEnd);
      if (wordMatch && endChar > safeChar) {
        this.anchorTimelineMs = Math.max(targetMs, wordMatch.startMs);
      } else {
        this.anchorTimelineMs = targetMs;
      }
    } else {
      this.anchorTimelineMs = targetMs;
    }

    this.anchorWallMs = nowMs;
    this.lastBoundaryTimelineMs = this.anchorTimelineMs;
    this.lastBoundaryWallMs = nowMs;
  }

  /**
   * Aligns timeline cursor directly to real audio playback position (`positionMs` / `durationMs`).
   */
  handleProgress(positionMs: number, durationMs?: number, nowMs = performance.now()): void {
    if (!this.started) {
      this.start(nowMs);
    }
    if (this.stopped || this.paused) return;

    const pos = Math.max(0, positionMs);
    this.lastKnownPositionMs = pos;
    this.lastProgressUpdateWallMs = nowMs;

    if (typeof durationMs === 'number' && durationMs > 0 && this.timeline.totalMs > 0) {
      this.lastKnownDurationMs = durationMs;
      const ratio = Math.max(0, Math.min(1, pos / durationMs));
      this.anchorTimelineMs = ratio * this.timeline.totalMs;
      this.effectiveTempo = Math.max(0.55, Math.min(1.85, this.timeline.totalMs / durationMs));
    } else {
      this.anchorTimelineMs = Math.min(this.timeline.totalMs, pos);
    }
    this.anchorWallMs = nowMs;
  }

  /**
   * Incorporates real acoustic waveform RMS (`level` 0..1) and optional spectral balance
   * (`lowRatio`, `midRatio`, `highRatio`) so pauses/silences close the mouth and fricatives/vowels stay accurate.
   */
  handleAudioEnvelope(
    level: number,
    spectral?: SpectralLipSyncCue,
    nowMs = performance.now()
  ): void {
    if (!this.started && level > 0.03) {
      this.start(nowMs);
    }
    const dt = this.lastEnvelopeWallMs > 0 ? Math.max(0, nowMs - this.lastEnvelopeWallMs) : 33;
    this.lastEnvelopeWallMs = nowMs;

    const clamped = clamp01(level);
    this.acousticEnvelope = clamped;
    if (clamped < 0.035) {
      this.acousticSilenceStreakMs += dt;
    } else {
      this.acousticSilenceStreakMs = 0;
    }

    if (spectral) {
      this.spectralHint = {
        lowRatio: spectral.lowRatio !== undefined ? clamp01(spectral.lowRatio) : undefined,
        midRatio: spectral.midRatio !== undefined ? clamp01(spectral.midRatio) : undefined,
        highRatio: spectral.highRatio !== undefined ? clamp01(spectral.highRatio) : undefined,
      };
    }
  }

  private getCurrentTimelineMs(nowMs: number): number {
    if (this.lastKnownDurationMs > 0 && this.lastProgressUpdateWallMs > 0) {
      const elapsedSinceProgress = Math.max(0, nowMs - this.lastProgressUpdateWallMs);
      const interpolatedPos = this.lastKnownPositionMs + elapsedSinceProgress;
      const ratio = Math.max(0, Math.min(1.02, interpolatedPos / this.lastKnownDurationMs));
      return ratio * this.timeline.totalMs;
    }
    const elapsedSinceAnchor = Math.max(0, nowMs - this.anchorWallMs);
    return this.anchorTimelineMs + elapsedSinceAnchor * this.effectiveTempo;
  }

  sampleFrame(nowMs = performance.now()): LipSyncFrame {
    if (this.stopped || !this.started || this.paused) {
      this.smoothed = cloneWeights(REST_WEIGHTS);
      return createRestingLipSyncFrame(this.scholarId, 'resting');
    }

    const dtSec =
      this.lastSampleWallMs > 0
        ? Math.min(0.08, Math.max(0.004, (nowMs - this.lastSampleWallMs) / 1000))
        : 0.033;
    this.lastSampleWallMs = nowMs;

    // Gate true acoustic silence immediately on PCM/Analyser engines (e.g. breathing pauses between phrases)
    const isAcousticSilence =
      this.requireEnvelopeForAudioGate &&
      (this.acousticEnvelope < 0.035 || this.acousticSilenceStreakMs >= 55);

    const timelineMs = this.getCurrentTimelineMs(nowMs);
    let cue = sampleCueAtTimelineMs(this.timeline, timelineMs);

    // If live audio still has strong voiced energy right after nominal timeline end, hold gently on the last voiced vowel
    // instead of looping fake syllables; otherwise settle cleanly into resting closure.
    if (!cue && this.requireEnvelopeForAudioGate && !isAcousticSilence && this.acousticEnvelope > 0.14) {
      const voicedCues = this.timeline.cues.filter((c) => !c.isPause && c.viseme !== 'closed_mbp');
      if (voicedCues.length > 0) {
        cue = voicedCues[voicedCues.length - 1];
      }
    }

    let viseme: LipSyncVisemeId = cue ? cue.viseme : 'rest';
    let target: VisemeTargetWeights = cue ? cloneWeights(cue.weights) : cloneWeights(REST_WEIGHTS);
    const isPauseMoment = Boolean(isAcousticSilence || !cue || cue.isPause || viseme === 'rest');

    if (isPauseMoment) {
      viseme = 'rest';
      target = cloneWeights(REST_WEIGHTS);
    } else {
      // Blend acoustic envelope & spectral formant cues when available
      const env = this.requireEnvelopeForAudioGate
        ? clamp01(0.28 + this.acousticEnvelope * 0.92)
        : 0.9;

      if (viseme !== 'closed_mbp') {
        target.jawOpen = clamp01(target.jawOpen * env);
        target.level = clamp01(target.level * env);
      }

      if (this.spectralHint) {
        const { highRatio = 0, lowRatio = 0 } = this.spectralHint;
        // Strong high-frequency fricative energy cues F/V/S/Ş narrowing & prevents silly open flapping
        if (highRatio > 0.44 && lowRatio < 0.35 && viseme !== 'closed_mbp') {
          target.jawOpen = Math.min(target.jawOpen, 0.15);
          if (viseme === 'neutral_c' || viseme === 'labiodental_fv') {
            target.lowerLipTuck = Math.max(target.lowerLipTuck, (highRatio - 0.35) * 0.9);
          }
        }
        // Strong low F1 vowel peak supports open jaw naturally without exaggeration
        if (lowRatio > 0.45 && (viseme === 'open_a' || viseme === 'open_e' || viseme === 'round_o')) {
          target.jawOpen = clamp01(Math.max(target.jawOpen, Math.min(0.82, lowRatio * 0.94)));
        }
      }
    }

    // Asymmetric inertial smoothing: fast attack on bilabial closures & vowels, calm decay on pauses
    const smoothChannel = (curr: number, tgt: number, attackRate: number, releaseRate: number) => {
      const rate = tgt > curr ? attackRate : releaseRate;
      const alpha = 1 - Math.exp(-rate * dtSec);
      return clamp01(curr + (tgt - curr) * alpha);
    };

    this.smoothed = {
      level: smoothChannel(this.smoothed.level, target.level, 38, 19),
      jawOpen: smoothChannel(this.smoothed.jawOpen, target.jawOpen, 42, 18),
      lipRound: smoothChannel(this.smoothed.lipRound, target.lipRound, 32, 15),
      lipClose: smoothChannel(this.smoothed.lipClose, target.lipClose, 44, 20),
      lipSpread: smoothChannel(this.smoothed.lipSpread, target.lipSpread, 30, 15),
      lowerLipTuck: smoothChannel(this.smoothed.lowerLipTuck, target.lowerLipTuck, 38, 18),
    };

    const isActive =
      viseme !== 'rest' ||
      this.smoothed.level > 0.02 ||
      this.smoothed.jawOpen > 0.02 ||
      this.smoothed.lipRound > 0.02 ||
      this.smoothed.lipClose > 0.02 ||
      this.smoothed.lowerLipTuck > 0.02;

    return {
      level: this.smoothed.level,
      viseme,
      jawOpen: this.smoothed.jawOpen,
      lipRound: this.smoothed.lipRound,
      lipClose: this.smoothed.lipClose,
      lipSpread: this.smoothed.lipSpread,
      lowerLipTuck: this.smoothed.lowerLipTuck,
      active: isActive,
      isPause: isPauseMoment && !isActive,
      scholarId: this.scholarId,
      syncMode: this.syncMode,
    };
  }
}
