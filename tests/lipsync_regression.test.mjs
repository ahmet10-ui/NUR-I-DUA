import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  VISEME_SHAPES,
  TurkishLipSyncController,
  buildTurkishVisemeTimeline,
  characterToTurkishViseme,
  createRestingLipSyncFrame,
  resolveStageScholarArticulation,
  sampleCueAtTimelineMs,
  scalarLevelToLipSyncFrame,
} from '../src/services/turkishLipSync.ts';
import { DEFAULT_YASIN_RECITATION } from '../src/data/defaults.ts';

// Bootstrap Capacitor Android native headers BEFORE @capacitor/core is ever imported
const activePluginMocks = new Map();
let mockCallbackCounter = 0;

if (!globalThis.window) {
  globalThis.window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  };
}
globalThis.androidBridge = globalThis.androidBridge || {};
globalThis.window.androidBridge = globalThis.androidBridge;

const MOCK_PLUGIN_NAMES = [
  'SeslenLocalTts',
  'EmaLightningTts',
  'ZerreTts',
  'NurIDuaTts',
  'NurIDuaArabicAudio',
];

globalThis.Capacitor = {
  PluginHeaders: MOCK_PLUGIN_NAMES.map((name) => ({
    name,
    methods: [
      { name: 'speak', rtype: 'promise' },
      { name: 'play', rtype: 'promise' },
      { name: 'stop', rtype: 'promise' },
      { name: 'pause', rtype: 'promise' },
      { name: 'resume', rtype: 'promise' },
      { name: 'getStatus', rtype: 'promise' },
      { name: 'getEngineInfo', rtype: 'promise' },
      { name: 'addListener' },
      { name: 'removeListener', rtype: 'promise' },
    ],
  })),
  nativePromise: async (pluginName, methodName, options) => {
    const impl = activePluginMocks.get(pluginName);
    if (!impl || typeof impl[methodName] !== 'function') {
      throw new Error(`Mock plugin ${pluginName}.${methodName} is not registered`);
    }
    return await impl[methodName](options);
  },
  nativeCallback: (pluginName, methodName, options, callback) => {
    const impl = activePluginMocks.get(pluginName);
    if (methodName === 'addListener' && impl && typeof impl.addListener === 'function') {
      void impl.addListener(options?.eventName, callback);
    }
    return `mock_cb_${++mockCallbackCounter}`;
  },
};

const { Capacitor } = await import('@capacitor/core');
const {
  buildYasinClosingSpeech,
  buildYasinIntroSpeech,
  executeStage2PlaybackSequence,
} = await import('../src/services/stage2Flow.ts');
const {
  BrowserSpeechSynthesisProvider,
  EmaLightningLocalTTSProvider,
  NativeAndroidTTSProvider,
  SeslenLocalTTSProvider,
  ZerreLocalTTSProvider,
} = await import('../src/services/ttsService.ts');

function setupMockCapacitorPlugin(pluginName, impl) {
  const prevWin = globalThis.window;
  const prevAndroidBridge = globalThis.androidBridge;

  globalThis.androidBridge = {};
  globalThis.window = {
    ...(prevWin || {}),
    androidBridge: globalThis.androidBridge,
    Capacitor,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  };
  activePluginMocks.set(pluginName, impl);

  return () => {
    activePluginMocks.delete(pluginName);
    globalThis.androidBridge = prevAndroidBridge;
    globalThis.window = prevWin;
  };
}

test('LipSync 1: Turkish G2P phoneme mapping covers A/E, O/Ö/U/Ü, M/B/P, F/V, İ/I, ğ, and punctuation', () => {
  const a = characterToTurkishViseme('A');
  const e = characterToTurkishViseme('e');
  const o = characterToTurkishViseme('O');
  const oe = characterToTurkishViseme('Ö');
  const u = characterToTurkishViseme('u');
  const ue = characterToTurkishViseme('Ü');
  const m = characterToTurkishViseme('m');
  const b = characterToTurkishViseme('B');
  const p = characterToTurkishViseme('p');
  const f = characterToTurkishViseme('f');
  const v = characterToTurkishViseme('V');
  const iDot = characterToTurkishViseme('İ');
  const iDotless = characterToTurkishViseme('I');
  const comma = characterToTurkishViseme(',');
  const period = characterToTurkishViseme('.');

  assert.equal(a.viseme, 'open_a');
  assert.ok(a.weights.jawOpen > e.weights.jawOpen && e.weights.jawOpen > 0.4);

  assert.equal(o.viseme, 'round_o');
  assert.equal(oe.viseme, 'round_o');
  assert.equal(u.viseme, 'round_u');
  assert.equal(ue.viseme, 'round_u');
  assert.ok(o.weights.lipRound >= 0.85 && u.weights.lipRound >= 0.95);
  assert.ok(u.weights.jawOpen < o.weights.jawOpen);

  for (const bilabial of [m, b, p]) {
    assert.equal(bilabial.viseme, 'closed_mbp');
    assert.equal(bilabial.weights.jawOpen, 0);
    assert.ok(bilabial.weights.lipClose >= 0.9);
  }

  for (const labio of [f, v]) {
    assert.equal(labio.viseme, 'labiodental_fv');
    assert.ok(labio.weights.lowerLipTuck >= 0.85);
    assert.ok(labio.weights.jawOpen < 0.2);
  }

  assert.equal(iDot.viseme, 'spread_i');
  assert.equal(iDotless.viseme, 'spread_i');
  assert.ok(iDot.weights.lipSpread > iDotless.weights.lipSpread);
  assert.equal(iDot.weights.lipRound, 0);

  assert.equal(comma.isSilentOrPause, true);
  assert.equal(comma.viseme, 'rest');
  assert.equal(period.isSilentOrPause, true);
  assert.ok(period.baseDurationMs > comma.baseDurationMs);

  // 'ğ' lengthens previous vowel instead of opening/flapping separately
  const withG = buildTurkishVisemeTimeline('Sağ ol', 1.0);
  const withoutG = buildTurkishVisemeTimeline('Sa ol', 1.0);
  assert.equal(withG.cues[1].viseme, 'open_a');
  assert.ok(withG.cues[1].durationMs > withoutG.cues[1].durationMs);
  assert.equal(
    withG.cues.filter((c) => !c.isPause).length,
    withoutG.cues.filter((c) => !c.isPause).length
  );

  // Bilabial M/B/P meets minimum perceptible closure duration floor
  const mbpTimeline = buildTurkishVisemeTimeline('Bismillah', 1.5);
  const bCue = mbpTimeline.cues.find((c) => c.viseme === 'closed_mbp');
  assert.ok(bCue && bCue.durationMs >= 64);

  // Adjacent consonant pre-rounds smoothly before U/Ü without losing M/B/P closure
  const coartTimeline = buildTurkishVisemeTimeline('Şükür', 1.0);
  assert.ok(coartTimeline.cues[0].weights.lipRound >= 0.3);
});

test('LipSync 2: Controller aligns cleanly to real engine charIndex/range boundaries and punctuation rests', () => {
  const text = 'Selam, mübarek olsun. Vakıf!';
  const ctrl = new TurkishLipSyncController({
    text,
    rate: 1.0,
    scholarId: 'scholar_1',
    syncMode: 'engine_boundary_viseme',
  });
  ctrl.start(1000);

  // Jump straight to "mübarek" ('m' at index 7)
  const mIdx = text.indexOf('mübarek');
  ctrl.handleBoundary(mIdx, 7, 1500);
  const frameM = ctrl.sampleFrame(1525);
  assert.equal(frameM.viseme, 'closed_mbp');
  assert.ok(frameM.lipClose > 0.35);
  assert.equal(frameM.scholarId, 'scholar_1');
  assert.equal(frameM.syncMode, 'engine_boundary_viseme');

  // Jump to "Vakıf" ('V' at index 22 -> labiodental_fv)
  const vIdx = text.indexOf('Vakıf');
  ctrl.handleBoundary(vIdx, 5, 2200);
  const frameV = ctrl.sampleFrame(2225);
  assert.equal(frameV.viseme, 'labiodental_fv');
  assert.ok(frameV.lowerLipTuck > 0.35);

  // Pause & stop decay strictly to resting closed pose
  ctrl.pause();
  const pausedFrame = ctrl.sampleFrame(2260);
  assert.equal(pausedFrame.active, false);
  assert.equal(pausedFrame.viseme, 'rest');
  assert.equal(pausedFrame.jawOpen, 0);

  ctrl.resume(2300);
  ctrl.stop();
  const stoppedFrame = ctrl.sampleFrame(2340);
  assert.equal(stoppedFrame.active, false);
  assert.equal(stoppedFrame.level, 0);
});

test('LipSync 3: Audio-gated controller closes mouth on PCM silence and responds to spectral HF/LF cues', () => {
  const text = 'Allah razı olsun.';
  const ctrl = new TurkishLipSyncController({
    text,
    rate: 0.94,
    scholarId: 'scholar_2',
    syncMode: 'spectral_audio_viseme',
    requireEnvelopeForAudioGate: true,
  });
  ctrl.start(0);

  // Silent envelope closes mouth immediately
  ctrl.handleAudioEnvelope(0.0, { lowRatio: 0, midRatio: 0, highRatio: 0 }, 20);
  const silent = ctrl.sampleFrame(40);
  assert.equal(silent.viseme, 'rest');
  assert.equal(silent.jawOpen, 0);

  // Loud open vowel + low-frequency F1 peak opens naturally
  ctrl.handleProgress(10, 1400, 50);
  ctrl.handleAudioEnvelope(0.82, { lowRatio: 0.85, midRatio: 0.25, highRatio: 0.1 }, 55);
  const loudVowel = ctrl.sampleFrame(75);
  assert.equal(loudVowel.viseme, 'open_a');
  assert.ok(loudVowel.jawOpen > 0.45);

  // High-frequency fricative spike constrains jaw opening & activates tuck hint
  ctrl.handleAudioEnvelope(0.55, { lowRatio: 0.1, midRatio: 0.2, highRatio: 0.88 }, 110);
  const fric = ctrl.sampleFrame(130);
  assert.ok(fric.jawOpen <= 0.45);

  // Sustained silence (> 60ms) returns smoothly to rest
  for (let t = 200; t <= 420; t += 40) {
    ctrl.handleAudioEnvelope(0.01, undefined, t);
    ctrl.sampleFrame(t);
  }
  const decayed = ctrl.sampleFrame(450);
  assert.equal(decayed.viseme, 'rest');
  assert.ok(decayed.jawOpen < 0.04);
});

test('LipSync 4: Strict single-speaker isolation & speaker switching between Hacı Ahmet and Hacı Mehmet', () => {
  const roundFrame = {
    level: 0.58,
    viseme: 'round_o',
    jawOpen: VISEME_SHAPES.round_o.jawOpen,
    lipRound: VISEME_SHAPES.round_o.lipRound,
    lipClose: 0,
    lipSpread: 0,
    lowerLipTuck: 0,
    active: true,
    scholarId: 'scholar_1',
    syncMode: 'pcm_envelope_viseme',
  };

  // Scholar 1 active -> ONLY scholar index 0 articulates
  const s1Speaker = resolveStageScholarArticulation(
    { activeScholar: 'scholar_1', isSpeaking: true, mouthLevel: 0.58, lipSync: roundFrame, playbackPhase: 'turkish_speech' },
    0
  );
  const s2Listener = resolveStageScholarArticulation(
    { activeScholar: 'scholar_1', isSpeaking: true, mouthLevel: 0.58, lipSync: roundFrame, playbackPhase: 'turkish_speech' },
    1
  );
  assert.equal(s1Speaker.isSpeakerPosture, true);
  assert.equal(s1Speaker.isMouthArticulating, true);
  assert.ok(s1Speaker.lipRound >= 0.85);

  assert.equal(s2Listener.isListenerPosture, true);
  assert.equal(s2Listener.isMouthArticulating, false);
  assert.equal(s2Listener.jawOpen, 0);
  assert.equal(s2Listener.lipRound, 0);
  assert.equal(s2Listener.lipClose, 0);
  assert.equal(s2Listener.lipSpread, 0);
  assert.equal(s2Listener.lowerLipTuck, 0);

  // Switch active speaker to scholar 2 -> ONLY scholar index 1 articulates
  const s1NowIdle = resolveStageScholarArticulation(
    { activeScholar: 'scholar_2', isSpeaking: true, mouthLevel: 0.58, lipSync: { ...roundFrame, scholarId: 'scholar_2' }, playbackPhase: 'turkish_speech' },
    0
  );
  const s2NowSpeaker = resolveStageScholarArticulation(
    { activeScholar: 'scholar_2', isSpeaking: true, mouthLevel: 0.58, lipSync: { ...roundFrame, scholarId: 'scholar_2' }, playbackPhase: 'turkish_speech' },
    1
  );
  assert.equal(s1NowIdle.isMouthArticulating, false);
  assert.equal(s1NowIdle.jawOpen, 0);
  assert.equal(s1NowIdle.lipRound, 0);
  assert.equal(s2NowSpeaker.isMouthArticulating, true);
  assert.ok(s2NowSpeaker.lipRound >= 0.85);
});

test('LipSync 5: Yâsîn-i Şerîf & High-Tier Qari Arabic MP3 phases keep scholar mouths strictly closed', () => {
  // 1) Pure resolver blocks mouth movement whenever playbackPhase === 'arabic_audio'
  const arabicAttempt = resolveStageScholarArticulation(
    {
      activeScholar: 'scholar_1',
      isSpeaking: true,
      mouthLevel: 0.92,
      lipSync: scalarLevelToLipSyncFrame(0.92, 'scholar_1'),
      playbackPhase: 'arabic_audio',
    },
    0
  );
  assert.equal(arabicAttempt.isMouthArticulating, false);
  assert.equal(arabicAttempt.jawOpen, 0);
  assert.equal(arabicAttempt.lipRound, 0);
  assert.equal(arabicAttempt.lipClose, 0);

  // 2) Full 3-phase Yâsîn sequence suppresses arabicPlayer mouth pulses & animates only intro/closing Turkish
  const phases = [];
  const framesByPhase = { yasin_intro: [], arabic_audio: [], turkish_speech: [] };
  let currentPhase = 'yasin_intro';

  const yasinEvent = {
    id: 'evt_yasin_lipsync',
    dedupeKey: 'sim:yasin_ls',
    source: 'simulation',
    eventType: 'gift',
    tier: 'yasin_300',
    username: 'MehmetBey',
    displayUsername: '@MehmetBey',
    giftId: 'tac',
    giftName: 'Taç',
    quantity: 1,
    priority: 'urgent',
    category: 'general_blessings',
    prayerId: DEFAULT_YASIN_RECITATION.id,
    prayerTitle: DEFAULT_YASIN_RECITATION.title,
    renderedPrayer: buildYasinClosingSpeech(DEFAULT_YASIN_RECITATION, 'MehmetBey'),
    yasinIntroSpeech: buildYasinIntroSpeech(DEFAULT_YASIN_RECITATION, 'MehmetBey'),
    arabicHarekeli: DEFAULT_YASIN_RECITATION.arabicHarekeliHeader,
    arabicAudioUrl: DEFAULT_YASIN_RECITATION.audioUrl,
    arabicAudioStatus: DEFAULT_YASIN_RECITATION.audioStatus,
    yasinAudioSha256: DEFAULT_YASIN_RECITATION.audioSha256,
    scholarId: 'scholar_1',
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
  };

  let completed = false;
  executeStage2PlaybackSequence({
    event: yasinEvent,
    arabicPlayer: {
      play(_url, opts) {
        opts.onStart?.({ durationMs: 714000 });
        // Attempt fake loud Qari mouth pulses during Arabic MP3 playback
        opts.onMouthLevel?.(0.95);
        opts.onMouthLevel?.(0.84);
        opts.onEnd?.();
      },
      pause() {},
      resume() {},
      stop() {},
    },
    turkishTts: {
      speak(text, opts) {
        opts.onStart?.();
        opts.onLipSyncFrame?.({
          level: 0.72,
          viseme: 'open_a',
          jawOpen: 0.7,
          lipRound: 0,
          lipClose: 0,
          lipSpread: 0.1,
          lowerLipTuck: 0,
          active: true,
          scholarId: opts.scholarId,
          syncMode: 'pcm_envelope_viseme',
        });
        assert.ok(text.length > 10);
        opts.onEnd?.();
      },
      pause() {},
      resume() {},
      stop() {},
    },
    ttsOptions: {
      scholarId: 'scholar_1',
      lang: 'tr-TR',
      rate: 0.94,
      pitch: 0.86,
      volume: 1,
    },
    onPhaseChange: (p) => {
      currentPhase = p;
      phases.push(p);
    },
    onLipSyncFrame: (frame) => {
      if (framesByPhase[currentPhase]) {
        framesByPhase[currentPhase].push(frame);
      }
    },
    onComplete: () => {
      completed = true;
    },
    onError: (err) => assert.fail(`Unexpected Yâsîn error: ${err}`),
  });

  assert.equal(completed, true);
  assert.deepEqual(phases, ['yasin_intro', 'arabic_audio', 'turkish_speech']);
  assert.ok(framesByPhase.yasin_intro.some((f) => f.active && f.viseme === 'open_a'));
  assert.ok(framesByPhase.turkish_speech.some((f) => f.active && f.viseme === 'open_a'));
  assert.ok(
    framesByPhase.arabic_audio.every((f) => !f.active && f.level === 0 && f.viseme === 'rest'),
    'No scholar lip-sync frames may activate during Yâsîn Arabic MP3 phase'
  );
});

test('LipSync 6: Seslen-TTS, EMA Lightning, and Zerre providers convert native PCM metrics (level, positionMs, hfRatio) to Turkish visemes', async () => {
  const runNativeProviderCase = async (ProviderCtor, pluginName, expectedEventName) => {
    let mouthHandler = null;
    let startHandler = null;
    let doneHandler = null;
    let lastUtteranceId = '';

    const restore = setupMockCapacitorPlugin(pluginName, {
      addListener: async (eventName, cb) => {
        if (eventName === expectedEventName) mouthHandler = cb;
        if (eventName.endsWith('Start')) startHandler = cb;
        if (eventName.endsWith('Done')) doneHandler = cb;
        return { remove: async () => {} };
      },
      speak: async (args) => {
        lastUtteranceId = args.utteranceId;
        return { ok: true };
      },
      stop: async () => ({ ok: true }),
      pause: async () => ({ ok: true }),
      resume: async () => ({ ok: true }),
    });

    try {
      const provider = new ProviderCtor();
      const capturedFrames = [];
      let ended = false;

      provider.speak('Baba, Allah ömür versin.', {
        scholarId: 'scholar_1',
        lang: 'tr-TR',
        rate: 0.94,
        pitch: 0.72,
        volume: 1,
        onLipSyncFrame: (frame) => capturedFrames.push(frame),
        onEnd: () => {
          ended = true;
        },
        onError: (e) => assert.fail(`${pluginName} failed: ${e}`),
      });

      await new Promise((r) => setTimeout(r, 20));
      startHandler?.({ utteranceId: lastUtteranceId });
      // Emit bilabial B start, open A, and fricative V/F slice with positionMs & hfRatio
      mouthHandler?.({ utteranceId: lastUtteranceId, level: 0.75, positionMs: 10, hfRatio: 0.12 });
      mouthHandler?.({ utteranceId: lastUtteranceId, level: 0.85, positionMs: 90, hfRatio: 0.15 });
      mouthHandler?.({ utteranceId: lastUtteranceId, level: 0.45, positionMs: 1200, hfRatio: 0.78 });
      doneHandler?.({ utteranceId: lastUtteranceId });

      assert.equal(ended, true);
      assert.ok(capturedFrames.some((f) => f.syncMode === 'pcm_envelope_viseme' && f.active));
      const lastFrame = capturedFrames[capturedFrames.length - 1];
      assert.equal(lastFrame.active, false);
      assert.equal(lastFrame.level, 0);
      assert.equal(lastFrame.viseme, 'rest');
    } finally {
      restore();
    }
  };

  await runNativeProviderCase(SeslenLocalTTSProvider, 'SeslenLocalTts', 'seslenMouth');
  await runNativeProviderCase(EmaLightningLocalTTSProvider, 'EmaLightningTts', 'emaMouth');
  await runNativeProviderCase(ZerreLocalTTSProvider, 'ZerreTts', 'zerreMouth');
});

test('LipSync 7: NativeAndroidTTSProvider (Antalia-2 Mini) and BrowserSpeechSynthesisProvider wire boundary/range events into viseme frames', async () => {
  // 7a. NativeAndroidTTSProvider (`ttsRange` { start, end })
  let rangeCb = null;
  let startCb = null;
  let doneCb = null;
  let capturedUid = '';
  const restoreNative = setupMockCapacitorPlugin('NurIDuaTts', {
    addListener: async (ev, cb) => {
      if (ev === 'ttsStart') startCb = cb;
      if (ev === 'ttsRange') rangeCb = cb;
      if (ev === 'ttsDone') doneCb = cb;
      return { remove: async () => {} };
    },
    speak: async (args) => {
      capturedUid = args.utteranceId;
      return { ok: true };
    },
    stop: async () => ({ ok: true }),
    pause: async () => ({ ok: true }),
    resume: async () => ({ ok: true }),
  });

  try {
    const androidTts = new NativeAndroidTTSProvider();
    const frames = [];
    let ended = false;
    androidTts.speak('Mübarek olsun.', {
      scholarId: 'scholar_2',
      lang: 'tr-TR',
      rate: 0.96,
      pitch: 0.85,
      volume: 1,
      onLipSyncFrame: (f) => frames.push(f),
      onEnd: () => {
        ended = true;
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    startCb?.({ utteranceId: capturedUid });
    rangeCb?.({ utteranceId: capturedUid, start: 0, end: 7 });
    await new Promise((r) => setTimeout(r, 50));
    doneCb?.({ utteranceId: capturedUid });
    assert.equal(ended, true);
    assert.ok(frames.some((f) => f.syncMode === 'engine_boundary_viseme' && f.active));
    assert.equal(frames[frames.length - 1].active, false);
  } finally {
    restoreNative();
  }

  // 7b. BrowserSpeechSynthesisProvider (`utterance.onboundary` `charIndex`)
  const prevWin = globalThis.window;
  const prevUtt = globalThis.SpeechSynthesisUtterance;
  try {
    class MockUtterance {
      constructor(text) {
        this.text = text;
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.lang = 'tr-TR';
      }
    }
    let lastUtt = null;
    globalThis.SpeechSynthesisUtterance = MockUtterance;
    globalThis.window = {
      SpeechSynthesisUtterance: MockUtterance,
      speechSynthesis: {
        speaking: false,
        pending: false,
        paused: false,
        getVoices: () => [{ voiceURI: 'tr', name: 'Turkish', lang: 'tr-TR', localService: true, default: true }],
        speak: (u) => {
          lastUtt = u;
          u.onstart?.();
        },
        cancel: () => {},
        pause: () => {},
        resume: () => {},
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    };

    const browserTts = new BrowserSpeechSynthesisProvider();
    const browserFrames = [];
    let browserEnded = false;
    browserTts.speak('Fâtiha okuyalım.', {
      scholarId: 'scholar_2',
      lang: 'tr-TR',
      rate: 0.94,
      pitch: 0.9,
      volume: 1,
      onLipSyncFrame: (f) => browserFrames.push(f),
      onEnd: () => {
        browserEnded = true;
      },
    });
    assert.ok(lastUtt);
    lastUtt.onboundary?.({ charIndex: 0, charLength: 6 });
    await new Promise((r) => setTimeout(r, 55));
    lastUtt.onend?.();
    assert.equal(browserEnded, true);
    assert.ok(browserFrames.some((f) => f.syncMode === 'engine_boundary_viseme' && f.active));
    assert.equal(browserFrames[browserFrames.length - 1].active, false);
  } finally {
    globalThis.window = prevWin;
    globalThis.SpeechSynthesisUtterance = prevUtt;
  }
});

test('LipSync 8: Shader, SSE sync, Java plugins, character artwork & 9:16 broadcast invariants remain intact', () => {
  const root = process.cwd();
  const stageSrc = fs.readFileSync(path.join(root, 'src/scene/PhotorealisticMosqueStage.ts'), 'utf8');
  const broadcastSrc = fs.readFileSync(path.join(root, 'src/components/BroadcastView.tsx'), 'utf8');
  const contextSrc = fs.readFileSync(path.join(root, 'src/context/StudioContext.tsx'), 'utf8');
  const viewportSrc = fs.readFileSync(path.join(root, 'src/components/MosqueViewport.tsx'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
  const syncSrc = fs.readFileSync(path.join(root, 'src/services/syncClient.ts'), 'utf8');

  // Shader uses 5-channel viseme morph uniforms & no forced Math.sin flapping
  assert.ok(stageSrc.includes('uniform vec4 uMouthMorph[2];'));
  assert.ok(stageSrc.includes('uniform float uLowerLipTuck[2];'));
  assert.ok(!stageSrc.includes('Math.sin(t * 10.2)'));
  assert.ok(!stageSrc.includes('uMouthOpen'));
  assert.ok(stageSrc.includes("mosque_scholars_broadcast_1795080562181.jpg"));

  // SSE + Context + Viewport + Server preserve lipSyncFrame & arabic_audio resting guard
  assert.ok(serverSrc.includes('lipSyncFrame'));
  assert.ok(syncSrc.includes('lipSyncFrame?: LipSyncFrame'));
  assert.ok(contextSrc.includes('subscribeLipSyncFrame'));
  assert.ok(!contextSrc.includes('mouthLevel: 0.4'));
  assert.ok(!contextSrc.includes('mouthLevel: 0.25'));
  assert.ok(viewportSrc.includes("playbackPhase !== 'arabic_audio'"));
  assert.ok(broadcastSrc.includes('max-w-[540px]') || broadcastSrc.includes('aspect-[9/16]') || broadcastSrc.includes('1080'));

  // Java plugins emit both posMs and hfRatio cleanly without pcm16 typo
  for (const javaRel of [
    'android/app/src/main/java/com/nur/idua/SeslenLocalTtsPlugin.java',
    'android/app/src/main/java/com/nur/idua/EmaLightningTtsPlugin.java',
    'android/app/src/main/java/com/nur/idua/ZerreTtsPlugin.java',
  ]) {
    const javaSrc = fs.readFileSync(path.join(root, javaRel), 'utf8');
    assert.ok(javaSrc.includes('"positionMs"'), `${javaRel} missing positionMs`);
    assert.ok(javaSrc.includes('"hfRatio"'), `${javaRel} missing hfRatio`);
    if (javaRel.endsWith('SeslenLocalTtsPlugin.java')) {
      const pcm16Section = javaSrc.slice(javaSrc.indexOf('playShortPcm16Clean'));
      assert.ok(pcm16Section.includes('track.write(pcm16, offset, count)'), 'SeslenLocalTtsPlugin missing pcm16 write');
    }
  }
});
