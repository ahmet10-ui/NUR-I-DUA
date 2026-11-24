import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  DUA_ANIMATION_DURATIONS_MS,
  ScholarAnimationDirector,
  evaluateScholarPoseAt,
  isSupplicationEvent,
  prepareDuaSpeechPlan,
  resolveLiveScholarSnapshotAt,
} from '../src/services/scholarAnimationController.ts';
import {
  computeScholarArmGeometry,
  SCHOLAR_LANDMARKS,
} from '../src/scene/ScholarArmHandRenderer.ts';
import {
  VISEME_SHAPES,
  TurkishLipSyncController,
  createRestingLipSyncFrame,
  resolveStageScholarArticulation,
} from '../src/services/turkishLipSync.ts';

test('DuaAnim 1: Supplication classifier & speech planner avoid double Âmin while preserving Yâsîn closing verbatim', () => {
  // Pure greeting stays speech-only (no post-dua hands/face wipe ritual)
  assert.equal(
    isSupplicationEvent({
      tier: 'follower',
      eventType: 'follow',
      renderedPrayer: 'Selâmün aleyküm, Ali! Yayınımıza hoş geldiniz.',
      playbackPhase: 'turkish_speech',
    }),
    false
  );
  assert.equal(
    isSupplicationEvent({
      tier: 'small_gift',
      eventType: 'gift',
      renderedPrayer: 'Hayırlar diliyoruz, hoş geldiniz!',
      playbackPhase: 'turkish_speech',
    }),
    false
  );

  // Mid/high/Yâsîn closing OR explicit prayer words trigger post-dua ritual
  assert.equal(
    isSupplicationEvent({
      tier: 'mid_gift',
      eventType: 'gift',
      renderedPrayer: 'Allah işlerini rast getirsin.',
      playbackPhase: 'turkish_speech',
    }),
    true
  );
  assert.equal(
    isSupplicationEvent({
      tier: 'small_gift',
      eventType: 'gift',
      renderedPrayer: 'Rabbim bereket versin. Âmin.',
      playbackPhase: 'turkish_speech',
    }),
    true
  );

  // Never trigger during yasin_intro or arabic_audio
  assert.equal(
    isSupplicationEvent({
      tier: 'yasin_300',
      eventType: 'gift',
      renderedPrayer: 'Bismillah, Yasin-i Şerif başlıyor. Rabbim kabul etsin.',
      playbackPhase: 'yasin_intro',
    }),
    false
  );
  assert.equal(
    isSupplicationEvent({
      tier: 'yasin_300',
      eventType: 'gift',
      renderedPrayer: 'Rabbim kabul etsin.',
      playbackPhase: 'arabic_audio',
    }),
    false
  );

  // Standard supplication strips standalone trailing "Âmin." so it is spoken ONCE in AMEEN pose
  const midPlan = prepareDuaSpeechPlan('Allah rızkını bereketlendirsin, sıhhat versin. Âmin.', {
    isSupplication: true,
    isYasinClosing: false,
  });
  assert.equal(midPlan.hasDuaClosingGesture, true);
  assert.equal(midPlan.bodyText, 'Allah rızkını bereketlendirsin, sıhhat versin.');
  assert.equal(midPlan.ameenText, 'Âmin.');

  // Yâsîn closing preserves verbatim benediction completely intact
  const yasinClosing =
    'Sübhâne rabbike rabbil-izzeti ammâ yesifûn, ve selâmün alel-mürselîn, velhamdülillâhi rabbil-âlemîn.';
  const yasinPlan = prepareDuaSpeechPlan(yasinClosing, {
    isSupplication: true,
    isYasinClosing: true,
  });
  assert.equal(yasinPlan.hasDuaClosingGesture, true);
  assert.equal(yasinPlan.bodyText, yasinClosing);
  assert.equal(yasinPlan.ameenText, 'Âmin.');

  // Follower non-supplication returns hasDuaClosingGesture: false
  const greetPlan = prepareDuaSpeechPlan('Selâmün aleyküm, Fatma Hanım!', {
    isSupplication: false,
  });
  assert.equal(greetPlan.hasDuaClosingGesture, false);
  assert.equal(greetPlan.ameenText, '');
});

test('DuaAnim 2: Anatomical arm/hand geometry keeps 🤲🏻 chest clear of beard, flips dorsal for WIPING_FACE without C0 jump, and cleanly hides resting lap hands', () => {
  for (const idx of [0, 1]) {
    const lm = SCHOLAR_LANDMARKS[idx];

    // 1. IDLE: overlay disabled, lap trouser replacement 0 (original photo untouched)
    const idleSnap = evaluateScholarPoseAt(idx === 0 ? 'scholar_1' : 'scholar_2', 'IDLE', 0);
    const idleGeom = computeScholarArmGeometry(idx, idleSnap, 0);
    assert.equal(idleGeom.shouldRender, false);
    assert.equal(idleGeom.opacity, 0);
    assert.equal(idleGeom.handHideFactor, 0);

    // 2. AMEEN: open palms lifted symmetrically well below beard/mouth
    const ameenSnap = evaluateScholarPoseAt(idx === 0 ? 'scholar_1' : 'scholar_2', 'AMEEN', 0.5);
    const ameenGeom = computeScholarArmGeometry(idx, ameenSnap, 0);
    assert.equal(ameenGeom.shouldRender, true);
    assert.equal(ameenGeom.opacity, 1);
    assert.equal(ameenGeom.handHideFactor, 1);
    assert.ok(ameenGeom.left.palmFacingSign > 0.9, 'AMEEN left palm must face up');
    assert.ok(ameenGeom.right.palmFacingSign > 0.9, 'AMEEN right palm must face up');
    assert.ok(
      ameenGeom.left.palmCenter.y >= lm.mouthY + 0.06,
      'Palms must sit at chest height below chin/beard'
    );
    assert.ok(
      Math.abs((ameenGeom.left.palmCenter.x + ameenGeom.right.palmCenter.x) * 0.5 - lm.cx) < 0.005,
      '🤲🏻 chest posture must be horizontally centered over scholar'
    );

    // 3. C0 continuity check across AMEEN -> WIPING_FACE boundary
    const wipeStartSnap = evaluateScholarPoseAt(
      idx === 0 ? 'scholar_1' : 'scholar_2',
      'WIPING_FACE',
      0.001
    );
    const wipeStartGeom = computeScholarArmGeometry(idx, wipeStartSnap, 0);
    assert.ok(
      Math.hypot(
        wipeStartGeom.left.wrist.x - ameenGeom.left.wrist.x,
        wipeStartGeom.left.wrist.y - ameenGeom.left.wrist.y
      ) < 0.005,
      'Wrist must not snap/jump at WIPING_FACE entry'
    );

    // 4. Mid-WIPING_FACE: dorsal hands face scholar cleanly along cheeks without colliding across center eyes/nose
    const wipeMidSnap = evaluateScholarPoseAt(
      idx === 0 ? 'scholar_1' : 'scholar_2',
      'WIPING_FACE',
      0.55
    );
    const wipeMidGeom = computeScholarArmGeometry(idx, wipeMidSnap, 0);
    assert.ok(wipeMidGeom.left.palmFacingSign < -0.5, 'WIPING_FACE should show dorsal view');
    assert.ok(wipeMidGeom.left.palmCenter.y < ameenGeom.left.palmCenter.y, 'Hands rise past chin/cheeks');
    assert.ok(
      Math.abs(wipeMidGeom.left.palmCenter.x - lm.cx) >= 0.032 &&
        Math.abs(wipeMidGeom.right.palmCenter.x - lm.cx) >= 0.032,
      'Wiping hands keep safe clearance from central eyes/nose'
    );

    // 5. RETURNING_TO_IDLE end -> settles back cleanly
    const retEndSnap = evaluateScholarPoseAt(
      idx === 0 ? 'scholar_1' : 'scholar_2',
      'RETURNING_TO_IDLE',
      1.0
    );
    const retEndGeom = computeScholarArmGeometry(idx, retEndSnap, 0);
    assert.equal(retEndGeom.shouldRender, false);
    assert.equal(retEndGeom.handHideFactor, 0);
  }

  // Remote OBS resolver cleanly interpolates live elapsed time on timed phases
  const startMs = 1_000_000;
  const raisingStart = evaluateScholarPoseAt('scholar_1', 'RAISING_HANDS', 0, {
    phaseDurationMs: 1000,
    phaseStartedAtMs: startMs,
    nowMs: startMs,
  });
  const liveMid = resolveLiveScholarSnapshotAt(raisingStart, startMs + 500);
  assert.ok(liveMid.handLiftProgress > 0.3 && liveMid.handLiftProgress < 0.7);
});

test('DuaAnim 3: ScholarAnimationDirector executes all 7 phases in order, enforces single-speaker isolation, and settles safely to IDLE', async () => {
  const director = new ScholarAnimationDirector();
  const observedPhases = [];
  let otherEverNonIdle = false;

  const unsub = director.subscribe((snaps) => {
    const p1 = snaps.scholar_1.phase;
    if (observedPhases[observedPhases.length - 1] !== p1) {
      observedPhases.push(p1);
    }
    if (snaps.scholar_2.phase !== 'IDLE' || snaps.scholar_2.handLiftProgress > 0) {
      otherEverNonIdle = true;
    }
  });

  // 1. Speech & speech pause toggling
  director.setSpeechPhase('scholar_1', 'SPEAKING');
  director.syncFromLipSyncFrame(
    'scholar_1',
    { ...createRestingLipSyncFrame('scholar_1'), isPause: true },
    true
  );
  director.syncFromLipSyncFrame(
    'scholar_1',
    {
      ...createRestingLipSyncFrame('scholar_1'),
      active: true,
      level: 0.5,
      viseme: 'open_a',
      jawOpen: 0.65,
      isPause: false,
    },
    true
  );

  // 2. Full closing choreography with real TTS "Âmin." callback
  let ameenSpokenCount = 0;
  let completed = false;

  await new Promise((resolve) => {
    director.runDuaClosingSequence({
      scholarId: 'scholar_1',
      ameenText: 'Âmin.',
      speakAmeen: (text, cb) => {
        ameenSpokenCount++;
        assert.equal(text, 'Âmin.');
        assert.equal(director.getSnapshots().scholar_1.phase, 'AMEEN');
        assert.equal(director.getSnapshots().scholar_1.mouthAllowed, true);
        cb.onStart();
        cb.onLipSyncFrame({
          ...createRestingLipSyncFrame('scholar_1'),
          active: true,
          level: 0.62,
          viseme: 'open_a',
          jawOpen: 0.68,
        });
        setTimeout(() => cb.onEnd(), 160);
      },
      onComplete: () => {
        completed = true;
        resolve();
      },
    });
  });

  unsub();

  assert.equal(completed, true);
  assert.equal(ameenSpokenCount, 1);
  assert.equal(otherEverNonIdle, false, 'Sibling scholar must remain strictly IDLE throughout');
  assert.deepEqual(observedPhases, [
    'IDLE',
    'SPEAKING',
    'SPEECH_PAUSE',
    'SPEAKING',
    'RAISING_HANDS',
    'AMEEN',
    'WIPING_FACE',
    'RETURNING_TO_IDLE',
    'IDLE',
  ]);
  assert.equal(director.getSnapshots().scholar_1.phase, 'IDLE');
  assert.equal(director.getSnapshots().scholar_1.handLiftProgress, 0);
});

test('DuaAnim 4: Error or manual Stop mid-WIPING_FACE safely unwinds hands back to IDLE (never freezes lifted)', async () => {
  const director = new ScholarAnimationDirector();

  // Trigger sequence on scholar_2 while scholar_1 was briefly active -> tests isolation & unwind
  director.setSpeechPhase('scholar_1', 'SPEAKING');
  assert.equal(director.getSnapshots().scholar_1.phase, 'SPEAKING');

  let stopCalled = false;
  let cancelHandle = null;

  await new Promise((resolve) => {
    const unsub = director.subscribe((snaps) => {
      if (snaps.scholar_2.phase === 'WIPING_FACE' && cancelHandle) {
        // Immediately interrupt mid-wipe
        unsub();
        cancelHandle.cancel();
        resolve();
      }
    });

    cancelHandle = director.runDuaClosingSequence({
      scholarId: 'scholar_2',
      ameenText: 'Âmin.',
      speakAmeen: (_text, cb) => {
        cb.onStart();
        setTimeout(() => cb.onError('simulated tts fail'), 40);
      },
      stopAmeenSpeech: () => {
        stopCalled = true;
      },
      onComplete: () => {},
    });
  });

  // scholar_1 should have been reset to IDLE immediately when scholar_2 claimed the stage
  assert.equal(director.getSnapshots().scholar_1.phase, 'IDLE');
  assert.equal(stopCalled, true);

  // Wait for smooth safeUnwindToIdle ramp to settle at IDLE cleanly
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Unwind did not reach IDLE in time')), 1500);
    if (director.getSnapshots().scholar_2.phase === 'IDLE') {
      clearTimeout(t);
      resolve();
      return;
    }
    const unsubDone = director.subscribe((snaps) => {
      if (snaps.scholar_2.phase === 'IDLE') {
        clearTimeout(t);
        unsubDone();
        resolve();
      }
    });
  });
  assert.equal(director.getSnapshots().scholar_2.phase, 'IDLE');
  assert.equal(director.getSnapshots().scholar_2.handLiftProgress, 0);
});

test('DuaAnim 5: Calibrated Turkish lip-sync constrains jaw opening, avoids tail flapping, and honors scholarAnimation mouthAllowed gate', () => {
  // Restrained jaw targets so elderly faces never look over-stretched
  assert.ok(VISEME_SHAPES.open_a.jawOpen <= 0.78 && VISEME_SHAPES.open_a.jawOpen >= 0.65);
  assert.ok(VISEME_SHAPES.open_e.jawOpen <= 0.54);
  assert.ok(VISEME_SHAPES.neutral_c.jawOpen <= 0.12);

  // Past utterance timeline without active PCM ring settles cleanly to rest (no fake cycling)
  const ctrl = new TurkishLipSyncController({
    text: 'Âmin.',
    rate: 1.0,
    scholarId: 'scholar_1',
    syncMode: 'synthetic_viseme',
  });
  ctrl.start(0);
  const tailFrame = ctrl.sampleFrame(2500);
  assert.equal(tailFrame.active, false);
  assert.equal(tailFrame.viseme, 'rest');
  assert.equal(tailFrame.isPause, true);

  // Stage articulation blocks mouth whenever scholarAnimation.mouthAllowed is false (e.g. RAISING_HANDS / WIPING_FACE)
  const fakeSpeakingFrame = {
    ...createRestingLipSyncFrame('scholar_1'),
    active: true,
    level: 0.75,
    viseme: 'open_a',
    jawOpen: 0.72,
  };
  const duringWipe = resolveStageScholarArticulation(
    {
      activeScholar: 'scholar_1',
      isSpeaking: true,
      mouthLevel: 0.75,
      lipSync: fakeSpeakingFrame,
      playbackPhase: 'turkish_speech',
      scholarAnimation: {
        scholar_1: evaluateScholarPoseAt('scholar_1', 'WIPING_FACE', 0.4),
      },
    },
    0
  );
  assert.equal(duringWipe.isMouthArticulating, false);
  assert.equal(duringWipe.jawOpen, 0);

  // During AMEEN, even while holding post-body speechState='holding', mouthAllowed unlocks articulation
  const duringAmeen = resolveStageScholarArticulation(
    {
      activeScholar: 'scholar_1',
      isSpeaking: false,
      mouthLevel: 0.72,
      lipSync: fakeSpeakingFrame,
      playbackPhase: 'turkish_speech',
      scholarAnimation: {
        scholar_1: evaluateScholarPoseAt('scholar_1', 'AMEEN', 0.5),
      },
    },
    0
  );
  assert.equal(duringAmeen.isMouthArticulating, true);
  assert.ok(duringAmeen.jawOpen > 0.5);
});

test('DuaAnim 6: Structural integration check across Context, Viewport, Stage shader, Server SSE & Master artwork preservation', () => {
  const root = process.cwd();
  const contextSrc = fs.readFileSync(path.join(root, 'src/context/StudioContext.tsx'), 'utf8');
  const viewportSrc = fs.readFileSync(path.join(root, 'src/components/MosqueViewport.tsx'), 'utf8');
  const stageSrc = fs.readFileSync(path.join(root, 'src/scene/PhotorealisticMosqueStage.ts'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');

  assert.ok(contextSrc.includes('runDuaClosingSequence'));
  assert.ok(contextSrc.includes('subscribeScholarAnimation'));
  assert.ok(contextSrc.includes('safeUnwindToIdle'));
  assert.ok(viewportSrc.includes('subscribeScholarAnimation'));
  assert.ok(stageSrc.includes('uniform float uHandHide[2];'));
  assert.ok(stageSrc.includes('uniform float uCalmEye[2];'));
  assert.ok(stageSrc.includes('renderScholarArmsAndHands'));
  assert.ok(stageSrc.includes('mosque_scholars_broadcast_1795080562181.jpg'));
  assert.ok(serverSrc.includes('scholarAnimation'));
  assert.ok(DUA_ANIMATION_DURATIONS_MS.RAISING_HANDS >= 700);
});
