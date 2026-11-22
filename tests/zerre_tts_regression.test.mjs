import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createDefaultAppState } from '../src/data/defaults.ts';
import { TURKISH_TTS_CANDIDATE_MATRIX } from '../src/services/turkishTtsCandidates.ts';
import {
  clampZerreSpeed,
  fallbackPhonesZerre,
  normalizeTurkishForZerre,
  phonemizeZerreSentence,
  splitZerreSentences,
  ZERRE_ARTIFACT_MANIFEST,
  ZERRE_LEGAL_WARNING,
  ZERRE_SAMPLE_RATE,
  ZERRE_SYMBOLS,
  ZERRE_TOTAL_BYTES,
  ZERRE_VOICE_INDEX_MK,
} from '../src/services/zerreTextFrontend.ts';
import { StudioTTSRouter } from '../src/services/ttsService.ts';

function makeFakeProvider(idLabel, calls, { emitStart = true, failWith = null } = {}) {
  return {
    id: 'browser_speech_synthesis',
    label: idLabel,
    isStudioGrade: false,
    isSupported: () => true,
    speak(text, options) {
      calls.push({ label: idLabel, text, scholarId: options.scholarId, rate: options.rate });
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

test('Zerre 1: Default scholar_1 stays seslen_hasan with zerreSesAApproved === false and candidate matrix covers all 6 researched engines', () => {
  const defaults = createDefaultAppState();
  assert.equal(defaults.voice.scholar1Engine, 'seslen_hasan');
  assert.equal(defaults.voice.zerreSesAApproved, false);
  assert.equal(defaults.voice.zerreSesAFallbackToHasan, true);
  assert.equal(defaults.voice.zerreSesARate, 0.94);

  const ids = TURKISH_TTS_CANDIDATE_MATRIX.map((c) => c.id);
  assert.deepEqual(ids, [
    'seslen_hasan',
    'zerre_ses_a',
    'ema_lightning',
    'zerre_ses_b',
    'piper_fettah',
    'piper_fahrettin',
  ]);
  const zerreEntry = TURKISH_TTS_CANDIDATE_MATRIX.find((c) => c.id === 'zerre_ses_a');
  assert.equal(zerreEntry.status, 'integrated_opt_in');
  assert.equal(zerreEntry.sampleRateHz, 24000);
  assert.ok(ZERRE_LEGAL_WARNING.includes('data_sources.md'));
});

test('Zerre 2: Manifest bytes (9724638) and 64-char SHA-256 hashes match ZerreTtsPlugin.java bit-for-bit', () => {
  assert.equal(ZERRE_ARTIFACT_MANIFEST.length, 3);
  const sum = ZERRE_ARTIFACT_MANIFEST.reduce((acc, a) => acc + a.expectedBytes, 0);
  assert.equal(sum, 9724638);
  assert.equal(sum, ZERRE_TOTAL_BYTES);
  assert.equal(ZERRE_VOICE_INDEX_MK, 0);
  assert.equal(ZERRE_SAMPLE_RATE, 24000);
  assert.equal(ZERRE_SYMBOLS.length, 62);

  const javaSrc = fs.readFileSync(
    path.resolve('android/app/src/main/java/com/nur/idua/ZerreTtsPlugin.java'),
    'utf8'
  );
  // Strictly pure ONNX Runtime — never imports android.speech.tts.*
  assert.equal(/^import\s+android\.speech\.tts\./m.test(javaSrc), false);
  assert.ok(javaSrc.includes('private static final long VOICE_INDEX_MK = 0L;'));
  assert.ok(javaSrc.includes('AudioTrack.STATE_INITIALIZED'));
  assert.ok(javaSrc.includes('requestSpeechAudioFocus()'));
  assert.ok(javaSrc.includes('Zerre AudioTrack write hatası'));

  for (const item of ZERRE_ARTIFACT_MANIFEST) {
    assert.match(item.sha256, /^[0-9a-f]{64}$/);
    assert.ok(javaSrc.includes(`"${item.fileName}"`), `Java missing ${item.fileName}`);
    assert.ok(javaSrc.includes(`${item.expectedBytes}L`), `Java missing size ${item.expectedBytes}`);
    assert.ok(javaSrc.includes(`"${item.sha256}"`), `Java missing SHA-256 for ${item.fileName}`);
  }

  const mainActivity = fs.readFileSync(
    path.resolve('android/app/src/main/java/com/nur/idua/MainActivity.java'),
    'utf8'
  );
  assert.ok(mainActivity.includes('ZerreTtsPlugin.class'));
});

test('Zerre 3: Turkish phonemizer handles palatal k/g, dark l, ğ lengthening, final vowel stress, punctuation, and sentence splitting', () => {
  // Palatal k -> c before front vowel, dark l -> ɫ after back vowel, ğ -> length mark ː
  const dag = fallbackPhonesZerre('dağ');
  assert.deepEqual(dag.phones, ['d', 'aː']);
  assert.deepEqual(dag.stress, [0, 1]);

  const kul = fallbackPhonesZerre('kul');
  assert.deepEqual(kul.phones, ['k', 'u', 'ɫ']);
  assert.deepEqual(kul.stress, [0, 1, 0]);

  const kedi = fallbackPhonesZerre('kedi');
  assert.deepEqual(kedi.phones, ['c', 'e', 'd', 'i']);
  assert.deepEqual(kedi.stress, [0, 0, 0, 1]);

  const gel = fallbackPhonesZerre('gel');
  assert.deepEqual(gel.phones, ['ɟ', 'e', 'l']);
  assert.deepEqual(gel.stress, [0, 1, 0]);

  const normalized = normalizeTurkishForZerre('Saat 14:30 civarı %25 indirimle 3. dua!');
  assert.ok(normalized.includes('on dört otuz'));
  assert.ok(normalized.includes('yüzde yirmi beş'));
  assert.ok(normalized.includes('üçüncü dua'));

  const encoded = phonemizeZerreSentence('Selâmün aleyküm, dünya!');
  assert.equal(encoded.symbols[0], '<bos>');
  assert.equal(encoded.symbols[encoded.symbols.length - 1], '<eos>');
  assert.ok(encoded.symbols.includes('<sp>'));
  assert.ok(encoded.symbols.includes(','));
  assert.ok(encoded.symbols.includes('!'));
  assert.equal(encoded.ids.length, encoded.stress.length);

  const chunks = splitZerreSentences(
    'Allahım kardeşimize afiyet ihsan eyle. Onu hayırlı işlerinde muvaffak eyle! Amin.',
    45
  );
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.length <= 45));

  assert.equal(clampZerreSpeed(0.2), 0.65);
  assert.equal(clampZerreSpeed(2.5), 1.45);
  assert.equal(clampZerreSpeed(undefined), 0.94);
});

test('Zerre 4: StudioTTSRouter isolates scholar_1 Zerre SES-A from scholar_2 Antalia and allows pre-start fallback to Hasan only', async () => {
  const nativeCalls = [];
  const seslenCalls = [];
  const emaCalls = [];
  const zerreCalls = [];
  const browserCalls = [];

  const router = new StudioTTSRouter(
    makeFakeProvider('browser', browserCalls),
    makeFakeProvider('native_android', nativeCalls),
    makeFakeProvider('server', []),
    makeFakeProvider('seslen_hasan', seslenCalls),
    makeFakeProvider('ema_lightning', emaCalls),
    makeFakeProvider('zerre_ses_a', zerreCalls)
  );

  // scholar_1 -> zerre_ses_a
  await new Promise((resolve, reject) => {
    router.speak('Allahım şifa ihsan eyle.', {
      scholarId: 'scholar_1',
      scholar1Engine: 'zerre_ses_a',
      preferredEngine: 'browser_speech_synthesis',
      voiceURI: '',
      neuralProviderId: 'piper_local',
      neuralVoiceId: 'hasan',
      tone: 'calm_elderly',
      fallbackToBrowser: true,
      lang: 'tr-TR',
      rate: 0.94,
      pitch: 0.72,
      volume: 0.95,
      onEnd: resolve,
      onError: reject,
    });
  });
  assert.equal(zerreCalls.length, 1);
  assert.equal(nativeCalls.length, 0);
  assert.equal(router.getActiveEngine(), 'zerre_ses_a');

  // scholar_2 NEVER touches zerre_ses_a -> stays NativeAndroidTTSProvider (Antalia-2 Mini)
  await new Promise((resolve, reject) => {
    router.speak('Hoş geldiniz kardeşimiz.', {
      scholarId: 'scholar_2',
      scholar1Engine: 'zerre_ses_a',
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
      onEnd: resolve,
      onError: reject,
    });
  });
  assert.equal(nativeCalls.length, 1);
  assert.equal(zerreCalls.length, 1);

  // Pre-start Zerre failure falls back strictly to Hasan (NOT Antalia)
  const preFailRouter = new StudioTTSRouter(
    makeFakeProvider('browser', []),
    makeFakeProvider('native_android', nativeCalls),
    makeFakeProvider('server', []),
    makeFakeProvider('seslen_hasan', seslenCalls),
    makeFakeProvider('ema_lightning', []),
    makeFakeProvider('zerre_ses_a', [], { emitStart: false, failWith: 'Zerre model missing' })
  );
  let fallbackMsg = '';
  await new Promise((resolve, reject) => {
    preFailRouter.speak('Hayırlı akşamlar.', {
      scholarId: 'scholar_1',
      scholar1Engine: 'zerre_ses_a',
      zerreFallbackToHasan: true,
      preferredEngine: 'browser_speech_synthesis',
      voiceURI: '',
      neuralProviderId: 'piper_local',
      neuralVoiceId: 'hasan',
      tone: 'calm_elderly',
      fallbackToBrowser: true,
      lang: 'tr-TR',
      rate: 0.94,
      pitch: 0.72,
      volume: 0.95,
      onFallbackNotice: (msg) => {
        fallbackMsg = msg;
      },
      onEnd: resolve,
      onError: reject,
    });
  });
  assert.equal(seslenCalls.length, 1);
  assert.equal(nativeCalls.length, 1); // unchanged from scholar_2 call above
  assert.match(fallbackMsg, /Zerre SES-A.*Seslen-TTS Hasan/);
});
