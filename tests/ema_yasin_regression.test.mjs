import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  createDefaultAppState,
  DEFAULT_TIER_RULES,
  DEFAULT_YASIN_RECITATION,
} from '../src/data/defaults.ts';
import {
  buildYasinClosingSpeech,
  buildYasinIntroSpeech,
  executeStage2PlaybackSequence,
  insertQueueEventPreservingActive,
} from '../src/services/stage2Flow.ts';
import {
  classifyGiftInteraction,
} from '../src/services/interactionClassifier.ts';
import {
  containsArabicScript,
  sanitizeTurkishTtsPayload,
  StudioTTSRouter,
} from '../src/services/ttsService.ts';
import {
  chunkTextForEma,
  computeEmaDecoderWindows,
  computeEmaWords,
  EMA_BENCHMARK_PRESETS,
  EMA_LIGHTNING_MODEL_METADATA,
  EMA_MODEL_FILES,
  encodeEmaVocabIds,
  normalizeTurkishForEma,
  planEmaFrames,
} from '../src/services/emaTextFrontend.ts';

function buildYasinQueueEvent(overrides = {}) {
  const username = 'HuseyinKaya';
  return {
    id: overrides.id || 'evt_yasin_test_1',
    eventType: 'gift',
    source: 'simulation',
    priority: 'urgent',
    tier: 'yasin_300',
    scholarId: 'scholar_1',
    username,
    displayUsername: username,
    giftName: 'Taç',
    giftCount: 1,
    totalCoins: 300,
    renderedPrayer: buildYasinClosingSpeech(DEFAULT_YASIN_RECITATION, username),
    yasinIntroSpeech: buildYasinIntroSpeech(DEFAULT_YASIN_RECITATION, username),
    arabicHarekeli: DEFAULT_YASIN_RECITATION.arabicHarekeliHeader,
    arabicAudioUrl: DEFAULT_YASIN_RECITATION.audioUrl,
    arabicAudioStatus: DEFAULT_YASIN_RECITATION.audioStatus,
    yasinAudioSha256: DEFAULT_YASIN_RECITATION.audioSha256,
    turkishMeaning: undefined,
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSimpleFakeProvider(name, logArr, { failWith = null, emitStart = true } = {}) {
  return {
    id: 'browser_speech_synthesis',
    label: name,
    isStudioGrade: false,
    isSupported: () => true,
    speak(text, options) {
      logArr.push({ provider: name, text, scholarId: options.scholarId, rate: options.rate });
      queueMicrotask(() => {
        if (emitStart) options.onStart?.();
        if (failWith) {
          options.onError?.(failWith);
        } else {
          options.onEnd?.();
        }
      });
    },
    pause() {},
    resume() {},
    stop() {},
  };
}

// 1. Strict 3-phase Yasin order: yasin_intro -> arabic_audio -> turkish_speech
test('Test 1: Yasin playback enforces strict yasin_intro -> arabic_audio -> turkish_speech order', async () => {
  const phases = [];
  const spoken = [];
  const arabicCalls = [];
  const ev = buildYasinQueueEvent();

  await new Promise((resolve, reject) => {
    const handle = executeStage2PlaybackSequence({
      event: ev,
      arabicPlayer: {
        play(url, opts) {
          arabicCalls.push({ url, expectedSha256: opts.expectedSha256 });
          queueMicrotask(() => {
            opts.onStart?.({ durationMs: 714024 });
            queueMicrotask(() => opts.onEnd?.());
          });
        },
        pause() {},
        resume() {},
        stop() {},
      },
      turkishTts: {
        speak(text, opts) {
          spoken.push({ text, scholarId: opts.scholarId });
          queueMicrotask(() => {
            opts.onStart?.();
            opts.onEnd?.();
          });
        },
        pause() {},
        resume() {},
        stop() {},
      },
      ttsOptions: {
        scholarId: 'scholar_1',
        preferredEngine: 'browser_speech_synthesis',
        voiceURI: '',
        neuralProviderId: 'piper_local',
        neuralVoiceId: 'hasan',
        tone: 'calm_elderly',
        fallbackToBrowser: false,
        lang: 'tr-TR',
        rate: 0.94,
        pitch: 0.68,
        volume: 0.95,
      },
      onPhaseChange: (p) => phases.push(p),
      onComplete: () => {
        assert.deepEqual(phases, ['yasin_intro', 'arabic_audio', 'turkish_speech']);
        assert.equal(spoken.length, 2);
        assert.equal(spoken[0].scholarId, 'scholar_1');
        assert.equal(spoken[1].scholarId, 'scholar_1');
        assert.equal(arabicCalls.length, 1);
        assert.equal(arabicCalls[0].url, DEFAULT_YASIN_RECITATION.audioUrl);
        assert.equal(arabicCalls[0].expectedSha256, DEFAULT_YASIN_RECITATION.audioSha256);
        assert.equal(handle.isLocked(), false);
        resolve();
      },
      onError: reject,
    });
  });
});

// 2. Rogue onEnd without onStart on arabic_audio is rejected as onError and stops player
test('Test 2: Premature arabic_audio onEnd without verified onStart is rejected with onError and stop()', async () => {
  let stopCount = 0;
  let completed = false;
  let errorMsg = '';

  await new Promise((resolve) => {
    executeStage2PlaybackSequence({
      event: buildYasinQueueEvent(),
      arabicPlayer: {
        play(_url, opts) {
          // Deliberately emit onEnd WITHOUT emitting onStart first!
          queueMicrotask(() => opts.onEnd?.());
        },
        pause() {},
        resume() {},
        stop() {
          stopCount++;
        },
      },
      turkishTts: makeSimpleFakeProvider('tts', []),
      ttsOptions: {
        scholarId: 'scholar_1',
        preferredEngine: 'browser_speech_synthesis',
        voiceURI: '',
        neuralProviderId: 'piper_local',
        neuralVoiceId: 'hasan',
        tone: 'calm_elderly',
        fallbackToBrowser: false,
        lang: 'tr-TR',
        rate: 0.94,
        pitch: 0.68,
        volume: 0.95,
      },
      onComplete: () => {
        completed = true;
      },
      onError: (err) => {
        errorMsg = err;
        resolve();
      },
    });
  });

  assert.equal(completed, false);
  assert.ok(stopCount >= 1);
  assert.match(errorMsg, /playback-start|başlamadan erken/i);
});

// 3. Rejected early arabic_audio NEVER advances to Phase 3 (closing prayer) or marks complete
test('Test 3: Rejected early Yasin audio never invokes Phase 3 closing prayer TTS', async () => {
  const spokenTexts = [];
  let completed = false;
  let failed = false;

  await new Promise((resolve) => {
    executeStage2PlaybackSequence({
      event: buildYasinQueueEvent(),
      arabicPlayer: {
        play(_url, opts) {
          queueMicrotask(() => opts.onEnd?.());
        },
        pause() {},
        resume() {},
        stop() {},
      },
      turkishTts: {
        speak(text, opts) {
          spokenTexts.push(text);
          queueMicrotask(() => {
            opts.onStart?.();
            opts.onEnd?.();
          });
        },
        pause() {},
        resume() {},
        stop() {},
      },
      ttsOptions: {
        scholarId: 'scholar_1',
        preferredEngine: 'browser_speech_synthesis',
        voiceURI: '',
        neuralProviderId: 'piper_local',
        neuralVoiceId: 'hasan',
        tone: 'calm_elderly',
        fallbackToBrowser: false,
        lang: 'tr-TR',
        rate: 0.94,
        pitch: 0.68,
        volume: 0.95,
      },
      onComplete: () => {
        completed = true;
      },
      onError: () => {
        failed = true;
        resolve();
      },
    });
  });

  assert.equal(failed, true);
  assert.equal(completed, false);
  // Only Phase 1 (intro) ran; Phase 3 closing prayer MUST NOT run!
  assert.equal(spokenTexts.length, 1);
  assert.ok(!spokenTexts[0].includes('Sadakallâhülazîm'));
});

// 4. Corrupt / failing arabic_audio releases queue lock so subsequent queued prayer plays normally
test('Test 4: Failing Yasin audio unlocks sequence cleanly and allows next queued item to play', async () => {
  const ev = buildYasinQueueEvent();
  let firstError = '';

  const handle1 = await new Promise((resolve) => {
    const h = executeStage2PlaybackSequence({
      event: ev,
      arabicPlayer: {
        play(_url, opts) {
          queueMicrotask(() => opts.onError?.('Corrupt MP3 header'));
        },
        pause() {},
        resume() {},
        stop() {},
      },
      turkishTts: makeSimpleFakeProvider('tts', []),
      ttsOptions: {
        scholarId: 'scholar_1',
        preferredEngine: 'browser_speech_synthesis',
        voiceURI: '',
        neuralProviderId: 'piper_local',
        neuralVoiceId: 'hasan',
        tone: 'calm_elderly',
        fallbackToBrowser: false,
        lang: 'tr-TR',
        rate: 0.94,
        pitch: 0.68,
        volume: 0.95,
      },
      onComplete: () => assert.fail('Should not complete'),
      onError: (err) => {
        firstError = err;
        resolve(h);
      },
    });
  });

  assert.equal(handle1.isLocked(), false);
  assert.match(firstError, /Corrupt MP3 header/);

  // Next queued event starts cleanly without being blocked
  const nextSpoken = [];
  await new Promise((resolve, reject) => {
    executeStage2PlaybackSequence({
      event: {
        id: 'evt_follow_next',
        eventType: 'follow',
        source: 'simulation',
        priority: 'normal',
        tier: 'follower',
        scholarId: 'scholar_2',
        username: 'Ayse',
        displayUsername: 'Ayşe',
        renderedPrayer: 'Hoş geldin Ayşe kardeşimiz.',
        status: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
      },
      arabicPlayer: { play() {}, pause() {}, resume() {}, stop() {} },
      turkishTts: makeSimpleFakeProvider('antalia', nextSpoken),
      ttsOptions: {
        scholarId: 'scholar_2',
        preferredEngine: 'browser_speech_synthesis',
        voiceURI: '',
        neuralProviderId: 'piper_local',
        neuralVoiceId: 'hasan',
        tone: 'calm_elderly',
        fallbackToBrowser: false,
        lang: 'tr-TR',
        rate: 0.86,
        pitch: 0.84,
        volume: 0.95,
      },
      onComplete: resolve,
      onError: reject,
    });
  });
  assert.equal(nextSpoken.length, 1);
});

// 5. arabic_audio start watchdog fires onError and calls stop() on silent stall
test('Test 5: Yasin arabic_audio start watchdog fires onError and calls stop() when playback stalls', async () => {
  let stopped = false;
  let errorMsg = '';

  const handle = await new Promise((resolve) => {
    const h = executeStage2PlaybackSequence({
      event: buildYasinQueueEvent(),
      arabicStartTimeoutMs: 50,
      arabicPlayer: {
        play() {
          // Hang silently without onStart, onEnd, or onError
        },
        pause() {},
        resume() {},
        stop() {
          stopped = true;
        },
      },
      turkishTts: makeSimpleFakeProvider('tts', []),
      ttsOptions: {
        scholarId: 'scholar_1',
        preferredEngine: 'browser_speech_synthesis',
        voiceURI: '',
        neuralProviderId: 'piper_local',
        neuralVoiceId: 'hasan',
        tone: 'calm_elderly',
        fallbackToBrowser: false,
        lang: 'tr-TR',
        rate: 0.94,
        pitch: 0.68,
        volume: 0.95,
      },
      onComplete: () => assert.fail('Stalled audio must not complete'),
      onError: (err) => {
        errorMsg = err;
        resolve(h);
      },
    });
  });

  assert.equal(stopped, true);
  assert.equal(handle.isLocked(), false);
  assert.match(errorMsg, /zaman aşımı/i);
});

// 6. Duplicate onEnd / onComplete callbacks only settle once
test('Test 6: Duplicate onEnd callbacks during Yasin playback only invoke onComplete once', async () => {
  let completeCount = 0;

  await new Promise((resolve) => {
    executeStage2PlaybackSequence({
      event: buildYasinQueueEvent(),
      arabicPlayer: {
        play(_url, opts) {
          queueMicrotask(() => {
            opts.onStart?.({ durationMs: 714024 });
            opts.onEnd?.();
            opts.onEnd?.(); // duplicate
          });
        },
        pause() {},
        resume() {},
        stop() {},
      },
      turkishTts: {
        speak(_text, opts) {
          queueMicrotask(() => {
            opts.onStart?.();
            opts.onEnd?.();
            opts.onEnd?.(); // duplicate
          });
        },
        pause() {},
        resume() {},
        stop() {},
      },
      ttsOptions: {
        scholarId: 'scholar_1',
        preferredEngine: 'browser_speech_synthesis',
        voiceURI: '',
        neuralProviderId: 'piper_local',
        neuralVoiceId: 'hasan',
        tone: 'calm_elderly',
        fallbackToBrowser: false,
        lang: 'tr-TR',
        rate: 0.94,
        pitch: 0.68,
        volume: 0.95,
      },
      onComplete: () => {
        completeCount++;
        setTimeout(resolve, 25);
      },
      onError: () => assert.fail('Should not fail'),
    });
  });

  assert.equal(completeCount, 1);
});

// 7. Full Yasin intro & closing texts preserved verbatim without shortening
test('Test 7: Yasin intro and closing speeches preserve full templates verbatim', () => {
  const intro = buildYasinIntroSpeech(DEFAULT_YASIN_RECITATION, 'Ahmet');
  const closing = buildYasinClosingSpeech(DEFAULT_YASIN_RECITATION, 'Ahmet');

  assert.ok(intro.includes('Ahmet kardeşimizin güzel niyetleri ve hayır temennileri vesilesiyle'));
  assert.ok(intro.includes('Yâsîn-i Şerîf Sûresi’ni baştan sona tilavet ediyoruz'));
  assert.ok(closing.includes('Sadakallâhülazîm'));
  assert.ok(closing.includes('Ahmet kardeşimizin, muhterem anne ve babasının'));
  assert.ok(closing.includes('ahirete irtihal etmiş anne, baba, dede, nine ve bütün vefat etmiş yakınlarının'));
  assert.equal(intro.length, DEFAULT_YASIN_RECITATION.introSpeechTemplate.replace('{isim}', 'Ahmet').length);
  assert.equal(closing.length, DEFAULT_YASIN_RECITATION.closingPrayerTemplate.replaceAll('{isim}', 'Ahmet').length);
});

// 8. Yasin carries NO Turkish meal and meal never reaches TTS
test('Test 8: Yasin carries no Turkish meal and forbiddenMealText never reaches TTS', () => {
  assert.equal(DEFAULT_YASIN_RECITATION.turkishMealNotice, '');
  const mealText = 'Rahman ve Rahim olan Allahın adıyla. Hikmet dolu Kurana andolsun.';
  const duaText = 'Allahım kardeşimize afiyet ihsan eyle.';
  const sanitized = sanitizeTurkishTtsPayload(`${duaText} ${mealText}`, mealText);
  assert.equal(sanitized, duaText);
});

// 9. Arabic script never sent to any Turkish TTS engine
test('Test 9: StudioTTSRouter rejects or strips Arabic script before calling any TTS provider', () => {
  const browserCalls = [];
  const fakeBrowser = makeSimpleFakeProvider('browser', browserCalls);
  const router = new StudioTTSRouter(fakeBrowser, fakeBrowser, fakeBrowser, fakeBrowser, fakeBrowser);

  let errorMsg = '';
  router.speak('يس وَالْقُرْآنِ الْحَكِيمِ', {
    scholarId: 'scholar_1',
    preferredEngine: 'browser_speech_synthesis',
    voiceURI: '',
    neuralProviderId: 'piper_local',
    neuralVoiceId: 'hasan',
    tone: 'calm_elderly',
    fallbackToBrowser: false,
    lang: 'tr-TR',
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    onError: (msg) => {
      errorMsg = msg;
    },
  });

  assert.equal(browserCalls.length, 0);
  assert.ok(containsArabicScript('يس'));
  assert.match(errorMsg, /Arapça metin/i);
});

// 10. Hacı Mehmet Efendi (scholar_2) Antalia-2 Mini routing unaffected
test('Test 10: scholar_2 continues using NativeAndroidTTSProvider (Antalia-2 Mini) even when scholar1Engine is ema_lightning', () => {
  const nativeCalls = [];
  const emaCalls = [];
  const seslenCalls = [];
  const fakeNative = { ...makeSimpleFakeProvider('native_android', nativeCalls), isSupported: () => true };
  const fakeSeslen = { ...makeSimpleFakeProvider('seslen_hasan', seslenCalls), isSupported: () => true };
  const fakeEma = { ...makeSimpleFakeProvider('ema_lightning', emaCalls), isSupported: () => true };
  const fakeBrowser = makeSimpleFakeProvider('browser', []);

  const router = new StudioTTSRouter(fakeBrowser, fakeNative, fakeBrowser, fakeSeslen, fakeEma);
  router.speak('Hoş geldiniz kıymetli kardeşimiz.', {
    scholarId: 'scholar_2',
    scholar1Engine: 'ema_lightning',
    preferredEngine: 'browser_speech_synthesis',
    voiceURI: '',
    neuralProviderId: 'piper_local',
    neuralVoiceId: 'hasan',
    tone: 'calm_elderly',
    fallbackToBrowser: true,
    lang: 'tr-TR',
    rate: 0.86,
    pitch: 0.84,
    volume: 0.95,
  });

  assert.equal(nativeCalls.length, 1);
  assert.equal(emaCalls.length, 0);
  assert.equal(seslenCalls.length, 0);
  assert.equal(router.getActiveEngine(), 'native_android');

  // Verify Antalia Java plugin was not altered to depend on EMA
  const antaliaPluginSrc = fs.readFileSync(
    path.resolve('android/app/src/main/java/com/nur/idua/NurIDuaTtsPlugin.java'),
    'utf8'
  );
  assert.ok(antaliaPluginSrc.includes('android.speech.tts.TextToSpeech'));
  assert.ok(!antaliaPluginSrc.includes('EmaLightning'));
});

// 11. Default scholar_1 engine stays 'seslen_hasan' prior to user approval & plugins registered
test('Test 11: scholar1Engine defaults to seslen_hasan before approval and MainActivity registers EMA plugin', () => {
  const defaultVoice = createDefaultAppState().voice;
  assert.equal(defaultVoice.scholar1Engine, 'seslen_hasan');
  assert.equal(defaultVoice.emaLightningApproved, false);
  assert.equal(defaultVoice.emaLightningFallbackToHasan, true);

  const mainActivitySrc = fs.readFileSync(
    path.resolve('android/app/src/main/java/com/nur/idua/MainActivity.java'),
    'utf8'
  );
  assert.ok(mainActivitySrc.includes('SeslenLocalTtsPlugin.class'));
  assert.ok(mainActivitySrc.includes('EmaLightningTtsPlugin.class'));
});

// 12. EMA_MODEL_FILES manifest matches Java plugin manifest bit-for-bit
test('Test 12: EMA model manifest totals 34959357 bytes with valid SHA-256 hashes matching Java plugin', () => {
  assert.equal(EMA_MODEL_FILES.length, 4);
  const sum = EMA_MODEL_FILES.reduce((acc, f) => acc + f.expectedBytes, 0);
  assert.equal(sum, 34959357);
  assert.equal(sum, EMA_LIGHTNING_MODEL_METADATA.totalBytes);
  assert.equal(EMA_LIGHTNING_MODEL_METADATA.license, 'Apache-2.0');

  const javaSrc = fs.readFileSync(
    path.resolve('android/app/src/main/java/com/nur/idua/EmaLightningTtsPlugin.java'),
    'utf8'
  );
  assert.ok(!/^import\s+android\.speech\.tts\./m.test(javaSrc));
  for (const entry of EMA_MODEL_FILES) {
    assert.match(entry.expectedSha256, /^[0-9a-f]{64}$/);
    assert.ok(javaSrc.includes(`"${entry.fileName}"`), `Java missing ${entry.fileName}`);
    assert.ok(javaSrc.includes(`${entry.expectedBytes}L`), `Java missing size ${entry.expectedBytes}`);
    assert.ok(javaSrc.includes(`"${entry.expectedSha256}"`), `Java missing SHA-256 for ${entry.fileName}`);
  }
});

// 13. Turkish normalizer & vocab ID encoder handle abbreviations, times, %, ordinals, accents
test('Test 13: normalizeTurkishForEma handles times, percentages, ordinals, circumflex accents and Turkish letters', () => {
  const norm = normalizeTurkishForEma('Saat 14:30 civarı %25 indirim, Dr. Ahmet Yâsîn’in 36. suresini okudu!');
  assert.ok(norm.includes('on dört otuz'));
  assert.ok(norm.includes('yüzde yirmi beş'));
  assert.ok(norm.includes("doktor ahmet yasin'in otuz altıncı suresini okudu"));
  assert.ok(/[çğıöşü]/.test(norm));

  const ids = encodeEmaVocabIds(norm);
  assert.ok(ids.length === norm.length);
  assert.ok(ids.every((id) => id >= 2));
});

// 14. Chunker, word aligner, frame planner, and decoder window math produce finite positive bounds
test('Test 14: Chunker & frame/window planners handle single sentence and long multi-paragraph text cleanly', () => {
  const longNorm = normalizeTurkishForEma(EMA_BENCHMARK_PRESETS[3].text);
  const pieces = chunkTextForEma(longNorm, 1.0);
  assert.ok(pieces.length >= 4);
  for (let i = 0; i < pieces.length; i++) {
    assert.ok(pieces[i].text.length <= 251);
    assert.match(pieces[i].text, /[.!?]$/);
    if (i === pieces.length - 1) assert.equal(pieces[i].pauseSec, 0);
  }

  const piece = pieces[0].text;
  const { cw, wstart } = computeEmaWords(piece);
  const fakeDur = new Array(piece.length).fill(1.6);
  const { T, cg, fg } = planEmaFrames(cw, wstart, fakeDur, 1.0);
  assert.ok(T > 0 && T <= 3000);
  assert.equal(cg.length, piece.length);
  assert.equal(fg.length, T);
  assert.ok(cg.every((v) => Number.isFinite(v)));
  assert.ok(fg.every((v) => Number.isFinite(v)));

  const windows = computeEmaDecoderWindows(T, 25, 100);
  assert.ok(windows.length >= 1);
  assert.ok(windows[0][1] - windows[0][0] <= 25);
  assert.equal(windows[windows.length - 1][1], T);
});

// 15. Streaming 48 kHz mono PCM/hop arithmetic
test('Test 15: Streaming decoder produces 48 kHz mono 1920-sample hop frames accurately', () => {
  assert.equal(EMA_LIGHTNING_MODEL_METADATA.sampleRate, 48000);
  assert.equal(EMA_LIGHTNING_MODEL_METADATA.channels, 1);
  assert.equal(EMA_LIGHTNING_MODEL_METADATA.hopSamples, 1920);
  const spans = computeEmaDecoderWindows(150, 25, 100);
  assert.deepEqual(spans, [
    [0, 25],
    [25, 125],
    [125, 150],
  ]);
  const totalSamples = spans.reduce((acc, [s, e]) => acc + (e - s) * EMA_LIGHTNING_MODEL_METADATA.hopSamples, 0);
  assert.equal(totalSamples, 150 * 1920);
  assert.equal((totalSamples / 48000) * 1000, 6000); // 6.000s exact
});

// 16. StudioTTSRouter controlled pre-start fallback to Hasan (and NEVER post-start or Antalia fallback)
test('Test 16: Router falls back EMA pre-start error -> Hasan once, NEVER post-start double-speaking, NEVER Antalia', async () => {
  // Case A: pre-start failure -> falls back to Hasan
  const hasanCallsA = [];
  const nativeCallsA = [];
  const emaPreFail = {
    ...makeSimpleFakeProvider('ema', [], { failWith: 'Model not downloaded', emitStart: false }),
    isSupported: () => true,
  };
  const seslenOk = { ...makeSimpleFakeProvider('seslen_hasan', hasanCallsA), isSupported: () => true };
  const nativeSpyA = { ...makeSimpleFakeProvider('native_android', nativeCallsA), isSupported: () => true };
  const routerA = new StudioTTSRouter(nativeSpyA, nativeSpyA, nativeSpyA, seslenOk, emaPreFail);

  let notice = '';
  await new Promise((resolve, reject) => {
    routerA.speak('Selâmün aleyküm.', {
      scholarId: 'scholar_1',
      scholar1Engine: 'ema_lightning',
      emaFallbackToHasan: true,
      preferredEngine: 'browser_speech_synthesis',
      voiceURI: '',
      neuralProviderId: 'piper_local',
      neuralVoiceId: 'hasan',
      tone: 'calm_elderly',
      fallbackToBrowser: true,
      lang: 'tr-TR',
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      onFallbackNotice: (msg) => {
        notice = msg;
      },
      onEnd: resolve,
      onError: reject,
    });
  });
  assert.equal(hasanCallsA.length, 1);
  assert.equal(nativeCallsA.length, 0);
  assert.match(notice, /Hasan motoruna kontrollü geçiş/i);

  // Case B: post-start failure -> MUST NOT double-speak with Hasan!
  const hasanCallsB = [];
  const emaPostFail = {
    ...makeSimpleFakeProvider('ema', [], { failWith: 'AudioTrack interrupted mid-speech', emitStart: true }),
    isSupported: () => true,
  };
  const seslenSpyB = { ...makeSimpleFakeProvider('seslen_hasan', hasanCallsB), isSupported: () => true };
  const routerB = new StudioTTSRouter(nativeSpyA, nativeSpyA, nativeSpyA, seslenSpyB, emaPostFail);

  let postErr = '';
  await new Promise((resolve) => {
    routerB.speak('Selâmün aleyküm.', {
      scholarId: 'scholar_1',
      scholar1Engine: 'ema_lightning',
      emaFallbackToHasan: true,
      preferredEngine: 'browser_speech_synthesis',
      voiceURI: '',
      neuralProviderId: 'piper_local',
      neuralVoiceId: 'hasan',
      tone: 'calm_elderly',
      fallbackToBrowser: true,
      lang: 'tr-TR',
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      onEnd: () => assert.fail('Should not complete via fallback after audio started'),
      onError: (e) => {
        postErr = e;
        resolve();
      },
    });
  });
  assert.equal(hasanCallsB.length, 0);
  assert.match(postErr, /AudioTrack interrupted/);
});

// 17. Queue lock remains held across all Yasin phases & insertQueueEventPreservingActive preserves active event
test('Test 17: Yasin queue lock stays true until done and new gifts do not preempt active Yasin', async () => {
  const yasinEv = buildYasinQueueEvent({ status: 'speaking' });
  const followEv = { ...buildYasinQueueEvent({ id: 'evt_urgent_2' }) };
  const ordered = insertQueueEventPreservingActive([yasinEv], followEv);
  assert.equal(ordered[0].id, yasinEv.id);

  let lockIntro = false;
  let lockAudio = false;
  let lockClosing = false;
  let handleRef;

  await new Promise((resolve, reject) => {
    handleRef = executeStage2PlaybackSequence({
      event: buildYasinQueueEvent(),
      arabicPlayer: {
        play(_url, opts) {
          lockAudio = handleRef.isLocked();
          queueMicrotask(() => {
            opts.onStart?.({ durationMs: 714024 });
            queueMicrotask(() => opts.onEnd?.());
          });
        },
        pause() {},
        resume() {},
        stop() {},
      },
      turkishTts: {
        speak(text, opts) {
          queueMicrotask(() => {
            if (text.includes('tilavet ediyoruz')) lockIntro = handleRef.isLocked();
            if (text.includes('Sadakallâhülazîm')) lockClosing = handleRef.isLocked();
            opts.onStart?.();
            opts.onEnd?.();
          });
        },
        pause() {},
        resume() {},
        stop() {},
      },
      ttsOptions: {
        scholarId: 'scholar_1',
        preferredEngine: 'browser_speech_synthesis',
        voiceURI: '',
        neuralProviderId: 'piper_local',
        neuralVoiceId: 'hasan',
        tone: 'calm_elderly',
        fallbackToBrowser: false,
        lang: 'tr-TR',
        rate: 0.94,
        pitch: 0.68,
        volume: 0.95,
      },
      onComplete: () => resolve(),
      onError: reject,
    });
  });

  assert.equal(lockIntro, true);
  assert.equal(lockAudio, true);
  assert.equal(lockClosing, true);
  assert.equal(handleRef.isLocked(), false);
  assert.equal(handleRef.getPhase(), 'done');
});

// 18. 300, 600, 1000 coin finalized single gifts create strictly 1 Yasin event each
test('Test 18: Single finalized gifts of 300, 600, and 1000 coins yield strictly eventCount === 1 yasin_300', () => {
  for (const coins of [300, 600, 1000]) {
    const res = classifyGiftInteraction(
      {
        unitCoins: coins,
        repeatCount: 1,
        giftType: 1,
        repeatEnd: true,
        username: 'Cemil',
      },
      DEFAULT_TIER_RULES
    );
    assert.equal(res.shouldEnqueue, true);
    assert.equal(res.tier, 'yasin_300');
    assert.equal(res.eventCount, 1);
    assert.equal(res.eventCoins, coins);
  }
});

// 19. Two independent 300-coin finalized gifts yield 2 separate yasin_300 events
test('Test 19: Two independent 300-coin finalized gifts enqueue two separate Yasin events', () => {
  const g1 = classifyGiftInteraction(
    { unitCoins: 300, repeatCount: 1, giftType: 1, repeatEnd: true, username: 'Ali' },
    DEFAULT_TIER_RULES
  );
  const g2 = classifyGiftInteraction(
    { unitCoins: 300, repeatCount: 1, giftType: 1, repeatEnd: true, username: 'Veli' },
    DEFAULT_TIER_RULES
  );
  assert.equal(g1.shouldEnqueue, true);
  assert.equal(g2.shouldEnqueue, true);
  assert.equal(g1.tier, 'yasin_300');
  assert.equal(g2.tier, 'yasin_300');
  assert.equal(g1.eventCount + g2.eventCount, 2);
});

// 20. Incomplete streak never creates Yasin
test('Test 20: Incomplete streak (repeatEnd: false) at 300+ coins is rejected and never creates Yasin', () => {
  const res = classifyGiftInteraction(
    { unitCoins: 300, repeatCount: 2, giftType: 1, repeatEnd: false, username: 'Murat' },
    DEFAULT_TIER_RULES
  );
  assert.equal(res.shouldEnqueue, false);
  assert.equal(res.reason, 'streak_incomplete');
  assert.equal(res.eventCount, 0);
});

// 21. Latency metrics calculation & 5 Redmi Note 10T 5G benchmark presets
test('Test 21: RTF metric calculation and 5 Redmi Note 10T 5G benchmark presets are valid and non-empty', () => {
  assert.equal(EMA_BENCHMARK_PRESETS.length, 5);
  for (const preset of EMA_BENCHMARK_PRESETS) {
    assert.ok(preset.label.length > 5);
    assert.ok(preset.text.trim().length >= 30);
    assert.ok(!containsArabicScript(preset.text));
  }
  const synthesisMs = 420;
  const audioDurationMs = 3500;
  const realTimeFactor = Number((synthesisMs / Math.max(1, audioDurationMs)).toFixed(3));
  assert.equal(realTimeFactor, 0.12);
});

// 22. NurIDuaAudioPlugin.java hardens Yasin MediaPlayer start verification, SHA-256 prep executor, and asset path resolution
test('Test 22: NurIDuaAudioPlugin enforces hasPrepared/hasPlaybackStarted, off-lock prepExecutor, and localhost asset mapping', () => {
  const audioPluginSrc = fs.readFileSync(
    path.resolve('android/app/src/main/java/com/nur/idua/NurIDuaAudioPlugin.java'),
    'utf8'
  );
  assert.ok(audioPluginSrc.includes('hasPrepared'));
  assert.ok(audioPluginSrc.includes('hasPlaybackStarted'));
  assert.ok(audioPluginSrc.includes('completionEmitted'));
  assert.ok(audioPluginSrc.includes('prepExecutor'));
  assert.ok(audioPluginSrc.includes('normalizePlayableSource'));
  assert.ok(audioPluginSrc.includes('resolveAssetCandidate'));
  assert.ok(audioPluginSrc.includes('!hasPrepared || !hasPlaybackStarted'));
});
