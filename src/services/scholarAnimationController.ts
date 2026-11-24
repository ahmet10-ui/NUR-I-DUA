import {
  LipSyncFrame,
  QueueEvent,
  ScholarAnimationPhase,
  ScholarAnimationSnapshot,
  ScholarId,
} from '../types/nuridua';

export const DUA_ANIMATION_DURATIONS_MS = {
  RAISING_HANDS: 920,
  AMEEN_MIN_HOLD: 650,
  AMEEN_MAX_TIMEOUT: 4200,
  AMEEN_POST_BEAT: 220,
  WIPING_FACE: 1580,
  RETURNING_TO_IDLE: 920,
} as const;

export interface DuaSpeechPlan {
  bodyText: string;
  ameenText: string;
  hasDuaClosingGesture: boolean;
}

export function createIdleScholarAnimationSnapshot(
  scholarId: ScholarId,
  nowMs = Date.now()
): ScholarAnimationSnapshot {
  return {
    scholarId,
    phase: 'IDLE',
    handLiftProgress: 0,
    palmOrientation: 0,
    wipeProgress: 0,
    fingerCurl: 0,
    calmEyeSoftness: 0,
    gestureHeadNod: 0,
    mouthAllowed: false,
    phaseDurationMs: 0,
    phaseStartedAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function createDefaultScholarAnimations(
  nowMs = Date.now()
): Record<ScholarId, ScholarAnimationSnapshot> {
  return {
    scholar_1: createIdleScholarAnimationSnapshot('scholar_1', nowMs),
    scholar_2: createIdleScholarAnimationSnapshot('scholar_2', nowMs),
  };
}

/**
 * Determines whether a spoken Turkish event should perform the traditional
 * post-dua gesture (hands raised 🤲🏻 -> real TTS "Âmin" -> wipe face -> return to lap).
 * - Never triggers during `yasin_intro` or `arabic_audio`.
 * - Triggers for mid_gift, high_gift, yasin_300 closing prayer, or any text containing dua/supplication markers.
 * - Keeps pure greeting events ("Selâmün aleyküm, {isim}!") cleanly seated with lip-sync only.
 */
export function isSupplicationEvent(
  event: Pick<QueueEvent, 'tier' | 'eventType' | 'renderedPrayer' | 'playbackPhase'> | null | undefined,
  spokenText?: string
): boolean {
  if (!event) return false;
  if (event.playbackPhase === 'yasin_intro' || event.playbackPhase === 'arabic_audio') {
    return false;
  }
  if (event.tier === 'mid_gift' || event.tier === 'high_gift' || event.tier === 'yasin_300') {
    return true;
  }
  const text = (spokenText || event.renderedPrayer || '').trim();
  if (!text) return false;
  return /\b([ÂAâa]min|Allah['’]?ım|Rabbim|Rabbimiz|dua|ihsan eyle|nasip eyle|muhafaza eyle|kabul eyle)\b/iu.test(
    text
  );
}

/**
 * Splits a trailing standalone "Âmin." from standard prayers so "Âmin" is spoken ONCE
 * while the scholar's hands are raised in open 🤲🏻 dua posture — never doubled.
 * Preserves Yâsîn closing benediction ("... Âmin, ve selâmün alel-mürselîn, velhamdülâhi rabbil-âlemîn.")
 * verbatim without shortening, then follows it with the calm closing "Âmin." gesture.
 */
export function prepareDuaSpeechPlan(
  renderedPrayer: string,
  options: { isSupplication: boolean; isYasinClosing?: boolean }
): DuaSpeechPlan {
  const clean = (renderedPrayer || '').replace(/\s+/g, ' ').trim();
  if (!options.isSupplication || !clean) {
    return {
      bodyText: clean,
      ameenText: '',
      hasDuaClosingGesture: false,
    };
  }

  if (options.isYasinClosing) {
    return {
      bodyText: clean,
      ameenText: 'Âmin.',
      hasDuaClosingGesture: true,
    };
  }

  // Strip standalone trailing "Âmin." / "Amin." / "Âmin!" so it is spoken once inside AMEEN phase
  const trailingAmeenMatch = clean.match(/^(.*?)(?:\s*[.,;!?]*\s+)([ÂAâa]min[.!]?)$/u);
  if (trailingAmeenMatch && trailingAmeenMatch[1]?.trim().length >= 8) {
    let body = trailingAmeenMatch[1].trim();
    if (!/[.!?…]$/.test(body)) {
      body = `${body}.`;
    }
    return {
      bodyText: body,
      ameenText: 'Âmin.',
      hasDuaClosingGesture: true,
    };
  }

  return {
    bodyText: clean,
    ameenText: 'Âmin.',
    hasDuaClosingGesture: true,
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function easeInOutQuint(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2;
}

function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(1e-5, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Computes exact anatomical pose parameters for a scholar animation phase & normalized progress [0..1].
 */
export function evaluateScholarPoseAt(
  scholarId: ScholarId,
  phase: ScholarAnimationPhase,
  rawProgress: number,
  options?: { phaseDurationMs?: number; phaseStartedAtMs?: number; nowMs?: number }
): ScholarAnimationSnapshot {
  const p = clamp01(rawProgress);
  const nowMs = options?.nowMs ?? Date.now();
  const phaseDurationMs = options?.phaseDurationMs ?? 0;
  const phaseStartedAtMs = options?.phaseStartedAtMs ?? nowMs;

  let handLiftProgress = 0;
  let palmOrientation = 0; // 0: lap down, +1: chest palms up 🤲🏻, -1: facing self for face wipe
  let wipeProgress = 0;
  let fingerCurl = 0;
  let calmEyeSoftness = 0;
  let gestureHeadNod = 0;
  let mouthAllowed = false;

  switch (phase) {
    case 'IDLE': {
      break;
    }
    case 'SPEAKING': {
      mouthAllowed = true;
      break;
    }
    case 'SPEECH_PAUSE': {
      mouthAllowed = false;
      break;
    }
    case 'RAISING_HANDS': {
      const e = easeInOutQuint(p);
      handLiftProgress = e;
      // Rotate wrists into open upward-cupped palms smoothly as forearms rise past thighs
      palmOrientation = smoothstep(0.15, 0.92, e);
      fingerCurl = 0.36 * smoothstep(0.25, 0.95, e);
      calmEyeSoftness = 0.25 * smoothstep(0.5, 1.0, e);
      gestureHeadNod = 0.14 * smoothstep(0.4, 1.0, e);
      mouthAllowed = false;
      break;
    }
    case 'AMEEN': {
      handLiftProgress = 1;
      palmOrientation = 1;
      wipeProgress = 0;
      fingerCurl = 0.38;
      calmEyeSoftness = 0.38;
      gestureHeadNod = 0.18 + Math.sin(p * Math.PI) * 0.08;
      mouthAllowed = true;
      break;
    }
    case 'WIPING_FACE': {
      handLiftProgress = 1;
      wipeProgress = p;
      // Smoothly lift palms from chest (0 -> 0.34), glide calmly down forehead/cheeks/beard (0.34 -> 0.80), release slightly (0.80 -> 1.0)
      const rotateToFace = smoothstep(0.0, 0.32, p);
      const relaxFromChin = smoothstep(0.82, 1.0, p);
      palmOrientation = 1 - 2.0 * rotateToFace + 0.55 * relaxFromChin; // +1 -> -1 -> ~ -0.45
      fingerCurl = 0.38 - 0.18 * smoothstep(0.15, 0.45, p);
      // Reverent softly closed eyes as palms pass gently across temples/cheeks
      calmEyeSoftness =
        0.38 +
        0.54 * smoothstep(0.12, 0.36, p) -
        0.65 * smoothstep(0.76, 1.0, p);
      gestureHeadNod = 0.18 + 0.22 * Math.sin(clamp01((p - 0.1) / 0.8) * Math.PI);
      mouthAllowed = false;
      break;
    }
    case 'RETURNING_TO_IDLE': {
      const e = easeInOutCubic(p);
      handLiftProgress = 1 - e;
      // Pronate smoothly back onto knees (palmOrientation: -0.45 -> 0)
      palmOrientation = -0.45 * (1 - smoothstep(0.0, 0.72, e));
      wipeProgress = (1 - smoothstep(0.0, 0.45, e)) * 0.92;
      fingerCurl = 0.2 * (1 - smoothstep(0.0, 0.7, e));
      calmEyeSoftness = 0.25 * (1 - smoothstep(0.0, 0.5, e));
      gestureHeadNod = 0.14 * (1 - e);
      mouthAllowed = false;
      break;
    }
  }

  return {
    scholarId,
    phase,
    handLiftProgress: clamp01(handLiftProgress),
    palmOrientation: Math.max(-1, Math.min(1, palmOrientation)),
    wipeProgress: clamp01(wipeProgress),
    fingerCurl: clamp01(fingerCurl),
    calmEyeSoftness: clamp01(calmEyeSoftness),
    gestureHeadNod: Math.max(-1, Math.min(1, gestureHeadNod)),
    mouthAllowed,
    phaseDurationMs,
    phaseStartedAtMs,
    updatedAtMs: nowMs,
  };
}

/**
 * Safely derives a real-time 60 FPS pose from a synced phase snapshot (used by OBS Clean View & remote tabs).
 */
export function resolveLiveScholarSnapshotAt(
  snapshot: ScholarAnimationSnapshot,
  nowMs = Date.now()
): ScholarAnimationSnapshot {
  if (
    snapshot.phase === 'IDLE' ||
    snapshot.phase === 'SPEAKING' ||
    snapshot.phase === 'SPEECH_PAUSE' ||
    snapshot.phaseDurationMs <= 0
  ) {
    return snapshot;
  }
  const elapsed = Math.max(0, nowMs - snapshot.phaseStartedAtMs);
  const progress = clamp01(elapsed / snapshot.phaseDurationMs);
  return evaluateScholarPoseAt(snapshot.scholarId, snapshot.phase, progress, {
    phaseDurationMs: snapshot.phaseDurationMs,
    phaseStartedAtMs: snapshot.phaseStartedAtMs,
    nowMs,
  });
}

export type ScholarAnimationListener = (
  states: Record<ScholarId, ScholarAnimationSnapshot>
) => void;

export interface DuaClosingSequenceParams {
  scholarId: ScholarId;
  ameenText?: string;
  speakAmeen: (
    text: string,
    callbacks: {
      onStart: () => void;
      onLipSyncFrame: (frame: LipSyncFrame) => void;
      onEnd: () => void;
      onError: (reason?: string) => void;
    }
  ) => void;
  stopAmeenSpeech?: () => void;
  onLipSyncFrame?: (frame: LipSyncFrame) => void;
  onComplete: () => void;
  onPhaseTransition?: (snapshot: ScholarAnimationSnapshot) => void;
}

/**
 * Centralized sequential state-machine director controlling both scholars independently:
 * IDLE -> SPEAKING <-> SPEECH_PAUSE -> RAISING_HANDS -> AMEEN -> WIPING_FACE -> RETURNING_TO_IDLE -> IDLE.
 */
export class ScholarAnimationDirector {
  private states: Record<ScholarId, ScholarAnimationSnapshot> = createDefaultScholarAnimations();
  private listeners = new Set<ScholarAnimationListener>();
  private activeToken = 0;
  private rafOrTimer: ReturnType<typeof setInterval> | null = null;
  private paused = false;
  private pausedAtMs = 0;
  private currentStopAmeen: (() => void) | null = null;

  subscribe(fn: ScholarAnimationListener): () => void {
    this.listeners.add(fn);
    fn(this.getSnapshots());
    return () => {
      this.listeners.delete(fn);
    };
  }

  getSnapshots(): Record<ScholarId, ScholarAnimationSnapshot> {
    return {
      scholar_1: { ...this.states.scholar_1 },
      scholar_2: { ...this.states.scholar_2 },
    };
  }

  private emit(): void {
    const snap = this.getSnapshots();
    this.listeners.forEach((fn) => fn(snap));
  }

  private clearActiveTimer(): void {
    if (this.rafOrTimer !== null) {
      clearInterval(this.rafOrTimer);
      this.rafOrTimer = null;
    }
  }

  private resetOtherScholarToIdle(activeScholar: ScholarId, nowMs = Date.now()): void {
    const other: ScholarId = activeScholar === 'scholar_1' ? 'scholar_2' : 'scholar_1';
    if (this.states[other].phase !== 'IDLE' || this.states[other].handLiftProgress > 0) {
      this.states[other] = createIdleScholarAnimationSnapshot(other, nowMs);
    }
  }

  /**
   * Transitions a scholar between IDLE / SPEAKING / SPEECH_PAUSE while guaranteeing
   * the sibling scholar remains strictly IDLE.
   */
  setSpeechPhase(
    scholarId: ScholarId,
    phase: 'IDLE' | 'SPEAKING' | 'SPEECH_PAUSE',
    nowMs = Date.now()
  ): ScholarAnimationSnapshot {
    // Do not stomp an active post-dua hand ritual unless explicitly returning to IDLE
    const curr = this.states[scholarId];
    if (
      phase !== 'IDLE' &&
      (curr.phase === 'RAISING_HANDS' ||
        curr.phase === 'AMEEN' ||
        curr.phase === 'WIPING_FACE' ||
        curr.phase === 'RETURNING_TO_IDLE')
    ) {
      return curr;
    }
    this.resetOtherScholarToIdle(scholarId, nowMs);
    const next = evaluateScholarPoseAt(scholarId, phase, 0, { nowMs });
    this.states[scholarId] = next;
    this.emit();
    return next;
  }

  /**
   * Immediately updates speaking / speech_pause based on live LipSyncFrame pause state.
   */
  syncFromLipSyncFrame(scholarId: ScholarId, frame: LipSyncFrame, isSpeechActive: boolean): void {
    const curr = this.states[scholarId];
    if (
      curr.phase === 'RAISING_HANDS' ||
      curr.phase === 'AMEEN' ||
      curr.phase === 'WIPING_FACE' ||
      curr.phase === 'RETURNING_TO_IDLE'
    ) {
      return;
    }
    if (!isSpeechActive) {
      if (curr.phase !== 'IDLE') {
        this.setSpeechPhase(scholarId, 'IDLE');
      }
      return;
    }
    const targetPhase: 'SPEAKING' | 'SPEECH_PAUSE' =
      !frame.active || frame.viseme === 'rest' || frame.isPause ? 'SPEECH_PAUSE' : 'SPEAKING';
    if (curr.phase !== targetPhase) {
      this.setSpeechPhase(scholarId, targetPhase);
    }
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.pausedAtMs = Date.now();
  }

  resume(): void {
    if (!this.paused) return;
    const pauseDelta = Math.max(0, Date.now() - this.pausedAtMs);
    this.paused = false;
    (['scholar_1', 'scholar_2'] as ScholarId[]).forEach((sid) => {
      this.states[sid] = {
        ...this.states[sid],
        phaseStartedAtMs: this.states[sid].phaseStartedAtMs + pauseDelta,
      };
    });
  }

  /**
   * Force-resets or smoothly unwinds any lifted arms safely back to IDLE on error/stop.
   */
  safeUnwindToIdle(scholarId?: ScholarId): () => void {
    const token = ++this.activeToken;
    this.clearActiveTimer();
    this.paused = false;
    if (this.currentStopAmeen) {
      try {
        this.currentStopAmeen();
      } catch {
        // ignore
      }
      this.currentStopAmeen = null;
    }

    const targets: ScholarId[] = scholarId ? [scholarId] : ['scholar_1', 'scholar_2'];
    let needsReturnRamp = false;
    for (const sid of targets) {
      if (this.states[sid].handLiftProgress > 0.04) {
        needsReturnRamp = true;
      } else {
        this.states[sid] = createIdleScholarAnimationSnapshot(sid);
      }
    }
    this.emit();

    if (!needsReturnRamp) {
      return () => {};
    }

    const activeUnwindScholar =
      targets.find((sid) => this.states[sid].handLiftProgress > 0.04) || 'scholar_1';
    const durationMs = 520;
    const startedAt = Date.now();

    this.states[activeUnwindScholar] = evaluateScholarPoseAt(
      activeUnwindScholar,
      'RETURNING_TO_IDLE',
      0,
      { phaseDurationMs: durationMs, phaseStartedAtMs: startedAt, nowMs: startedAt }
    );
    this.emit();

    this.rafOrTimer = setInterval(() => {
      if (this.activeToken !== token) return;
      const now = Date.now();
      const progress = clamp01((now - startedAt) / durationMs);
      this.states[activeUnwindScholar] = evaluateScholarPoseAt(
        activeUnwindScholar,
        progress >= 1 ? 'IDLE' : 'RETURNING_TO_IDLE',
        progress,
        { phaseDurationMs: durationMs, phaseStartedAtMs: startedAt, nowMs: now }
      );
      this.emit();
      if (progress >= 1) {
        this.clearActiveTimer();
      }
    }, 33);

    return () => {
      if (this.activeToken === token) {
        this.activeToken++;
        this.clearActiveTimer();
        this.states[activeUnwindScholar] = createIdleScholarAnimationSnapshot(activeUnwindScholar);
        this.emit();
      }
    };
  }

  /**
   * Executes the full sequential post-dua ritual on the active scholar ONLY:
   * RAISING_HANDS -> AMEEN (with real TTS "Âmin.") -> WIPING_FACE -> RETURNING_TO_IDLE -> IDLE.
   * Returns a cancellation handle that cleanly lowers arms if cancelled mid-gesture.
   */
  runDuaClosingSequence(params: DuaClosingSequenceParams): { cancel: () => void } {
    const token = ++this.activeToken;
    this.clearActiveTimer();
    this.paused = false;
    this.currentStopAmeen = params.stopAmeenSpeech || null;

    const scholarId = params.scholarId;
    this.resetOtherScholarToIdle(scholarId);

    const runTimedPhase = (
      phase: 'RAISING_HANDS' | 'WIPING_FACE' | 'RETURNING_TO_IDLE',
      durationMs: number,
      onDone: () => void
    ) => {
      if (this.activeToken !== token) return;
      this.clearActiveTimer();
      let startedAt = Date.now();
      let lastTick = startedAt;
      const initial = evaluateScholarPoseAt(scholarId, phase, 0, {
        phaseDurationMs: durationMs,
        phaseStartedAtMs: startedAt,
        nowMs: startedAt,
      });
      this.states[scholarId] = initial;
      params.onPhaseTransition?.(initial);
      this.emit();

      // Re-check token in case a listener called cancel() / safeUnwindToIdle() synchronously
      if (this.activeToken !== token) return;

      this.rafOrTimer = setInterval(() => {
        if (this.activeToken !== token) {
          this.clearActiveTimer();
          return;
        }
        const now = Date.now();
        if (this.paused) {
          startedAt += Math.max(0, now - lastTick);
          lastTick = now;
          return;
        }
        lastTick = now;
        const progress = clamp01((now - startedAt) / durationMs);
        const snap = evaluateScholarPoseAt(scholarId, phase, progress, {
          phaseDurationMs: durationMs,
          phaseStartedAtMs: startedAt,
          nowMs: now,
        });
        this.states[scholarId] = snap;
        this.emit();

        if (this.activeToken !== token) return;

        if (progress >= 1) {
          this.clearActiveTimer();
          onDone();
        }
      }, 33);
    };

    const startReturning = () => {
      runTimedPhase('RETURNING_TO_IDLE', DUA_ANIMATION_DURATIONS_MS.RETURNING_TO_IDLE, () => {
        if (this.activeToken !== token) return;
        const idle = createIdleScholarAnimationSnapshot(scholarId);
        this.states[scholarId] = idle;
        this.currentStopAmeen = null;
        params.onPhaseTransition?.(idle);
        this.emit();
        params.onComplete();
      });
    };

    const startWiping = () => {
      runTimedPhase('WIPING_FACE', DUA_ANIMATION_DURATIONS_MS.WIPING_FACE, startReturning);
    };

    const startAmeen = () => {
      if (this.activeToken !== token) return;
      this.clearActiveTimer();
      const startedAt = Date.now();
      const ameenSnap = evaluateScholarPoseAt(scholarId, 'AMEEN', 0, {
        phaseDurationMs: DUA_ANIMATION_DURATIONS_MS.AMEEN_MIN_HOLD,
        phaseStartedAtMs: startedAt,
        nowMs: startedAt,
      });
      this.states[scholarId] = ameenSnap;
      params.onPhaseTransition?.(ameenSnap);
      this.emit();

      if (this.activeToken !== token) return;

      let speechSettled = false;
      let ameenFinished = false;
      let postBeatTimer: ReturnType<typeof setTimeout> | null = null;

      const advanceFromAmeen = () => {
        if (ameenFinished || this.activeToken !== token) return;
        ameenFinished = true;
        this.clearActiveTimer();
        if (postBeatTimer) {
          clearTimeout(postBeatTimer);
          postBeatTimer = null;
        }
        clearTimeout(watchdog);
        params.onLipSyncFrame?.({
          level: 0,
          viseme: 'rest',
          jawOpen: 0,
          lipRound: 0,
          lipClose: 0,
          lipSpread: 0,
          lowerLipTuck: 0,
          active: false,
          scholarId,
          syncMode: 'resting',
        });
        startWiping();
      };

      const finishSpeech = () => {
        if (speechSettled || this.activeToken !== token) return;
        speechSettled = true;
        const elapsed = Date.now() - startedAt;
        const remainingMinHold = Math.max(0, DUA_ANIMATION_DURATIONS_MS.AMEEN_MIN_HOLD - elapsed);
        postBeatTimer = setTimeout(
          advanceFromAmeen,
          remainingMinHold + DUA_ANIMATION_DURATIONS_MS.AMEEN_POST_BEAT
        );
      };

      const watchdog = setTimeout(() => {
        if (this.activeToken !== token) return;
        if (!speechSettled) {
          try {
            params.stopAmeenSpeech?.();
          } catch {
            // ignore
          }
          finishSpeech();
        }
      }, DUA_ANIMATION_DURATIONS_MS.AMEEN_MAX_TIMEOUT);

      // Gentle breathing tick during AMEEN pose
      this.rafOrTimer = setInterval(() => {
        if (this.activeToken !== token || ameenFinished) {
          this.clearActiveTimer();
          return;
        }
        if (this.paused) return;
        const now = Date.now();
        const prog = clamp01((now - startedAt) / 1100);
        this.states[scholarId] = evaluateScholarPoseAt(scholarId, 'AMEEN', prog, {
          phaseDurationMs: 1100,
          phaseStartedAtMs: startedAt,
          nowMs: now,
        });
        this.emit();
      }, 45);

      const textToSpeak = (params.ameenText || 'Âmin.').trim() || 'Âmin.';
      try {
        params.speakAmeen(textToSpeak, {
          onStart: () => {
            // Real speech started while palms are open 🤲🏻
          },
          onLipSyncFrame: (frame) => {
            if (this.activeToken !== token || ameenFinished) return;
            params.onLipSyncFrame?.(frame);
          },
          onEnd: () => {
            finishSpeech();
          },
          onError: () => {
            // Do not hang hands up in air if TTS engine fails
            finishSpeech();
          },
        });
      } catch {
        finishSpeech();
      }
    };

    runTimedPhase('RAISING_HANDS', DUA_ANIMATION_DURATIONS_MS.RAISING_HANDS, startAmeen);

    return {
      cancel: () => {
        if (this.activeToken === token) {
          this.safeUnwindToIdle(scholarId);
        }
      },
    };
  }
}
