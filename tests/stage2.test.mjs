import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  classifyFollowInteraction,
  classifyGiftInteraction,
  resolveTierRules,
} from '../src/services/interactionClassifier.ts';
import {
  buildHighTierTurkishSpeech,
  executeStage2PlaybackSequence,
  normalizeFollowSessionKey,
  pickNonConsecutiveHighDua,
  pickNonConsecutiveMidPrayer,
  stripTurkishMeaningFromSpeech,
} from '../src/services/stage2Flow.ts';
import {
  containsArabicScript,
  getScholarProsody,
  splitLongTextIfNeeded,
  stripArabicScriptForTurkishTts,
} from '../src/services/ttsService.ts';
import {
  DEFAULT_HIGH_TIER_DUAS,
  DEFAULT_MID_OPENING_PRAYERS,
  DEFAULT_TIER_RULES,
} from '../src/data/defaults.ts';

test('Follower classification greets once with editable template and normalizes session key', () => {
  const res = classifyFollowInteraction({
    username: 'ayse_nur',
    userId: '778899',
  });
  assert.equal(res.shouldEnqueue, true);
  assert.equal(res.tier, 'follower');
  assert.equal(res.eventCount, 1);
  assert.equal(res.renderedGreeting, 'Selâmün aleyküm, Ayse Nur! NUR-I DUA ailemize hoş geldin.');

  // Session deduplication key checks
  const keyUid1 = normalizeFollowSessionKey({ userId: '778899', username: 'ayse_nur' });
  const keyUid2 = normalizeFollowSessionKey({ userId: '778899', username: 'ayse_renamed' });
  assert.equal(keyUid1, 'uid:778899');
  assert.equal(keyUid1, keyUid2);

  const keyName1 = normalizeFollowSessionKey({ username: '@Mehmet_Can' });
  const keyName2 = normalizeFollowSessionKey({ username: 'mehmet_can' });
  assert.equal(keyName1, keyName2);

  // Disabled follower tier check
  const disabledRules = resolveTierRules({ ...DEFAULT_TIER_RULES, followerEnabled: false });
  const disabledRes = classifyFollowInteraction({ username: 'ayse_nur' }, disabledRules);
  assert.equal(disabledRes.shouldEnqueue, false);
  assert.equal(disabledRes.reason, 'follower_disabled');
});

test('Small gift (1-10 coins) greets ONLY without prayer and respects enable toggle', () => {
  for (const coins of [1, 5, 10]) {
    const res = classifyGiftInteraction({
      username: 'omer_faruk',
      unitCoins: coins,
      repeatCount: 1,
      giftType: 0,
    });
    assert.equal(res.shouldEnqueue, true);
    assert.equal(res.tier, 'small_gift');
    assert.equal(res.requiresPrayer, false);
    assert.equal(res.renderedGreeting, 'Selâmün aleyküm, Omer Faruk!');
  }

  const disabledSmall = resolveTierRules({ ...DEFAULT_TIER_RULES, smallGiftEnabled: false });
  const rejected = classifyGiftInteraction(
    { username: 'omer_faruk', unitCoins: 10, repeatCount: 1 },
    disabledSmall
  );
  assert.equal(rejected.shouldEnqueue, false);
  assert.equal(rejected.reason, 'tier_disabled');
});

test('Mid gift (11-35 coins) draws non-consecutively from Başlangıç Duaları pool', () => {
  const res = classifyGiftInteraction({
    username: 'zeynep_kaya',
    unitCoins: 25,
    repeatCount: 1,
  });
  assert.equal(res.shouldEnqueue, true);
  assert.equal(res.tier, 'mid_gift');
  assert.equal(res.requiresPrayer, true);
  assert.equal(res.renderedGreeting, undefined);

  assert.ok(DEFAULT_MID_OPENING_PRAYERS.length >= 3);

  let lastId = null;
  for (let i = 0; i < 50; i += 1) {
    const picked = pickNonConsecutiveMidPrayer(DEFAULT_MID_OPENING_PRAYERS, lastId);
    assert.ok(picked, 'Must return an active mid_opening prayer');
    assert.equal(picked.category, 'mid_opening');
    if (lastId) {
      assert.notEqual(picked.id, lastId, `Draw #${i} picked consecutive identical prayer ${picked.id}`);
    }
    lastId = picked.id;
  }

  const disabledMid = resolveTierRules({ ...DEFAULT_TIER_RULES, midGiftEnabled: false });
  const rejected = classifyGiftInteraction(
    { username: 'zeynep_kaya', unitCoins: 25, repeatCount: 1 },
    disabledMid
  );
  assert.equal(rejected.shouldEnqueue, false);
  assert.equal(rejected.reason, 'tier_disabled');
});

test('High gift (36-199 coins) verified Arabic audio files pass SHA-256/CC0 and all 8 entries isolate Arabic & meal from Turkish TTS', () => {
  assert.ok(DEFAULT_HIGH_TIER_DUAS.length >= 8);
  const publicDir = path.resolve(process.cwd(), 'public');

  const verifiedEntries = DEFAULT_HIGH_TIER_DUAS.filter((d) => d.audioStatus === 'verified_ready');
  const pendingEntries = DEFAULT_HIGH_TIER_DUAS.filter(
    (d) => d.audioStatus === 'pending_license_verification'
  );
  assert.equal(verifiedEntries.length, 7);
  assert.equal(pendingEntries.length, 1);
  assert.equal(pendingEntries[0].id, 'high-dua-salati-tefriciye');

  for (const dua of DEFAULT_HIGH_TIER_DUAS) {
    assert.ok(dua.sourceCitation.length > 20, `Expected source citation on ${dua.id}`);
    assert.ok(containsArabicScript(dua.arabicHarekeli), `Expected Arabic script on ${dua.id}`);
    assert.ok(dua.turkishMeaning.trim().length > 40, `Expected Turkish meal on ${dua.id}`);

    if (dua.audioStatus === 'verified_ready') {
      assert.ok(
        dua.audioLicense.includes('CC0') || dua.audioLicense.includes('CC BY-SA 4.0'),
        `Expected verified open license on ${dua.id}, got: ${dua.audioLicense}`
      );
      assert.ok(dua.audioSha256 && dua.audioSha256.length === 64, `Expected SHA-256 on ${dua.id}`);

      const relativeAudioPath = dua.audioUrl.replace(/^\//, '');
      const fullPath = path.join(publicDir, relativeAudioPath);
      assert.equal(fs.existsSync(fullPath), true, `Verified audio file missing: ${fullPath}`);

      const fileBuf = fs.readFileSync(fullPath);
      const actualHash = crypto.createHash('sha256').update(fileBuf).digest('hex');
      assert.equal(actualHash, dua.audioSha256, `SHA-256 mismatch for ${dua.audioUrl}`);
    } else {
      assert.equal(dua.audioUrl, '', `Pending entry ${dua.id} must not fabricate an audioUrl`);
      assert.equal(
        dua.audioLicense.includes('CC0'),
        false,
        `Pending entry ${dua.id} must not fabricate a CC0 license`
      );
    }

    const turkishSpeech = buildHighTierTurkishSpeech(dua, 'Ahmet');
    assert.equal(
      containsArabicScript(turkishSpeech),
      false,
      'Turkish speech output must NEVER contain Arabic script'
    );
    assert.equal(
      turkishSpeech.includes(dua.turkishMeaning),
      false,
      `Turkish speech output must NEVER include turkishMeaning (meal) for ${dua.id}`
    );
    assert.equal(
      turkishSpeech.toLowerCase().includes('meali:'),
      false,
      `Turkish speech output must NEVER speak meal header for ${dua.id}`
    );
    assert.ok(turkishSpeech.includes('Ahmet'));
    assert.ok(turkishSpeech.toLowerCase().includes('anne'));
    assert.ok(turkishSpeech.toLowerCase().includes('akraba'));
  }

  // Salât-ı Tefriciye must be explicitly labeled as traditional salavat/dua, NOT Qur'an
  const tefriciye = DEFAULT_HIGH_TIER_DUAS.find((d) => d.id === 'high-dua-salati-tefriciye');
  assert.ok(tefriciye);
  assert.match(tefriciye.sourceCitation, /Kur’ân-ı Kerîm ayeti değildir|Salavât/i);
  assert.match(tefriciye.turkishMeaning, /Kur’ân-ı Kerîm ayeti değildir/i);

  let lastHighId = null;
  for (let i = 0; i < 40; i += 1) {
    const picked = pickNonConsecutiveHighDua(DEFAULT_HIGH_TIER_DUAS, lastHighId);
    assert.ok(picked);
    if (lastHighId) assert.notEqual(picked.id, lastHighId);
    lastHighId = picked.id;
  }
});

test('High gift Stage 2 playback sequence plays Arabic Qari first, locks against interruption, and isolates Arabic from Turkish TTS', () => {
  const timeline = [];
  const dua = DEFAULT_HIGH_TIER_DUAS[0];
  const turkishSpeech = buildHighTierTurkishSpeech(dua, 'Fatma');

  let arabicCallbacks = null;
  let ttsCallbacks = null;
  let arabicStops = 0;
  let ttsStops = 0;
  let completed = false;
  let errorMsg = null;

  const mockArabicPlayer = {
    play(url, opts) {
      timeline.push(`arabic:play:${url}`);
      arabicCallbacks = opts;
      opts.onStart?.();
    },
    pause() {
      timeline.push('arabic:pause');
    },
    resume() {
      timeline.push('arabic:resume');
    },
    stop() {
      arabicStops += 1;
      timeline.push('arabic:stop');
    },
  };

  const mockTurkishTts = {
    speak(text, options) {
      assert.equal(containsArabicScript(text), false, 'Turkish TTS must never receive Arabic script');
      timeline.push(`tts:speak:${options.scholarId}`);
      ttsCallbacks = options;
      options.onStart?.();
    },
    pause() {
      timeline.push('tts:pause');
    },
    resume() {
      timeline.push('tts:resume');
    },
    stop() {
      ttsStops += 1;
      timeline.push('tts:stop');
    },
  };

  const highEvent = {
    id: 'evt_high_1',
    dedupeKey: 'dk_high_1',
    source: 'real',
    eventType: 'gift',
    tier: 'high_gift',
    username: 'fatma_nur',
    displayUsername: 'Fatma Nur',
    giftId: '200_gift',
    giftName: 'Taç',
    quantity: 1,
    unitCoins: 200,
    eventCoins: 200,
    priority: 'high',
    category: 'family_peace',
    prayerId: dua.id,
    prayerTitle: dua.title,
    renderedPrayer: turkishSpeech,
    arabicHarekeli: dua.arabicHarekeli,
    turkishMeaning: dua.turkishMeaning,
    sourceCitation: dua.sourceCitation,
    arabicAudioUrl: dua.audioUrl,
    arabicAudioLicense: dua.audioLicense,
    arabicAudioAttribution: dua.audioAttribution,
    arabicAudioStatus: 'verified_ready',
    scholarId: 'scholar_1',
    status: 'speaking',
    attempts: 1,
    createdAt: new Date().toISOString(),
  };

  const handle = executeStage2PlaybackSequence({
    event: highEvent,
    arabicPlayer: mockArabicPlayer,
    turkishTts: mockTurkishTts,
    ttsOptions: {
      scholarId: 'scholar_1',
      lang: 'tr-TR',
      rate: 0.9,
      pitch: 0.95,
      volume: 1,
    },
    onPhaseChange: (phase) => timeline.push(`phase:${phase}`),
    onStart: () => timeline.push('started'),
    onComplete: () => {
      completed = true;
      timeline.push('completed');
    },
    onError: (reason) => {
      errorMsg = reason;
    },
  });

  // Immediately after starting: Arabic phase must be active and playback strictly locked
  assert.equal(handle.getPhase(), 'arabic_audio');
  assert.equal(handle.isLocked(), true);
  assert.equal(ttsCallbacks, null, 'Turkish TTS must NOT start until Arabic Qari audio finishes');
  assert.equal(arabicStops, 0);
  assert.equal(ttsStops, 0);

  // Finish Arabic Qari audio -> automatically transitions to Turkish phase for scholar_1
  arabicCallbacks.onEnd();
  assert.equal(handle.getPhase(), 'turkish_speech');
  assert.equal(handle.isLocked(), true, 'Lock must remain active during Turkish dua');
  assert.ok(ttsCallbacks, 'Turkish TTS must start right after Arabic audio ends');
  assert.equal(ttsCallbacks.scholarId, 'scholar_1');

  // Finish Turkish TTS -> releases lock and completes
  ttsCallbacks.onEnd();
  assert.equal(handle.getPhase(), 'done');
  assert.equal(handle.isLocked(), false);
  assert.equal(completed, true);
  assert.equal(errorMsg, null);
  assert.deepEqual(timeline, [
    'phase:arabic_audio',
    `arabic:play:${dua.audioUrl}`,
    'started',
    'phase:turkish_speech',
    'tts:speak:scholar_1',
    'completed',
  ]);
});

test('Pending-verification Arabic audio falls back cleanly to Turkish-only without reading Arabic via Turkish TTS', () => {
  const notices = [];
  let arabicPlayed = false;
  let spokenText = '';
  let finished = false;

  const dua = DEFAULT_HIGH_TIER_DUAS[1];
  const event = {
    id: 'evt_high_unverified',
    dedupeKey: 'dk_high_unverified',
    source: 'simulation',
    eventType: 'gift',
    tier: 'high_gift',
    username: 'ali_veli',
    displayUsername: 'Ali Veli',
    giftId: '200_gift',
    giftName: 'Taç',
    quantity: 1,
    unitCoins: 200,
    eventCoins: 200,
    priority: 'high',
    category: 'family_peace',
    prayerId: dua.id,
    prayerTitle: dua.title,
    renderedPrayer: `${dua.arabicHarekeli} ${buildHighTierTurkishSpeech(dua, 'Ali Veli')}`,
    arabicHarekeli: dua.arabicHarekeli,
    arabicAudioUrl: '',
    arabicAudioStatus: 'pending_license_verification',
    scholarId: 'scholar_2',
    status: 'speaking',
    attempts: 1,
    createdAt: new Date().toISOString(),
  };

  executeStage2PlaybackSequence({
    event,
    arabicPlayer: {
      play() {
        arabicPlayed = true;
      },
      pause() {},
      resume() {},
      stop() {},
    },
    turkishTts: {
      speak(text, opts) {
        spokenText = text;
        assert.equal(opts.scholarId, 'scholar_2');
        opts.onStart?.();
        opts.onEnd?.();
      },
      pause() {},
      resume() {},
      stop() {},
    },
    ttsOptions: {
      scholarId: 'scholar_2',
      lang: 'tr-TR',
      rate: 0.9,
      pitch: 0.95,
      volume: 1,
    },
    onFallbackNotice: (n) => notices.push(n),
    onComplete: () => {
      finished = true;
    },
    onError: (err) => {
      assert.fail(`Unexpected error: ${err}`);
    },
  });

  assert.equal(arabicPlayed, false, 'Unverified audio URL must never play');
  assert.equal(finished, true);
  assert.equal(notices.length, 1);
  assert.equal(containsArabicScript(spokenText), false, 'Arabic script must be stripped before Turkish TTS');
  assert.ok(spokenText.includes('Ali Veli'));
  assert.equal(stripArabicScriptForTurkishTts('بِسْمِ اللّٰهِ Selâm'), 'Selâm');
});

test('Long Turkish prayers chunk cleanly for Android/Antalia-2 Mini and scholar prosody isolation stays intact', () => {
  const longPrayer =
    "Allah'ım, Mehmet kardeşimize ve muhterem anne babasına sağlık, huzur, bereket ve hayırlı ömürler ihsan eyle. ".repeat(
      18
    );
  assert.ok(longPrayer.length > 1800);

  const chunks = splitLongTextIfNeeded(longPrayer, 750, 600);
  assert.ok(chunks.length >= 3, `Expected >=3 chunks, got ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 600, `Chunk exceeded max length 600: ${chunk.length}`);
  }
  assert.equal(chunks.join(' '), longPrayer.trim().replace(/\s+/g, ' '));

  // Verify scholar prosody isolation: scholar_2 (Antalia-2 Mini) and scholar_1 (Hasan)
  const s2 = getScholarProsody(0.9, 0.95, 'scholar_2');
  assert.deepEqual(s2, { rate: 0.93, pitch: 0.9 });

  const s1 = getScholarProsody(0.9, 0.95, 'scholar_1', { enabled: true, rate: 0.76, pitch: 0.68 });
  assert.deepEqual(s1, { rate: 0.76, pitch: 0.68 });
});

test('Code-level guard blocks turkishMeaning (meal) from reaching TTS even in legacy queued events', () => {
  const dua = DEFAULT_HIGH_TIER_DUAS[0];
  const personalOnly = buildHighTierTurkishSpeech(dua, 'Mehmet');
  const legacyCombined = `${dua.arabicHarekeli} ${dua.turkishMeaning} ${personalOnly}`;
  const stripped = stripTurkishMeaningFromSpeech(legacyCombined, dua.turkishMeaning);
  assert.equal(containsArabicScript(stripped), false);
  assert.equal(stripped.includes(dua.turkishMeaning), false);
  assert.equal(stripped, personalOnly);

  let spokenToEngine = '';
  let completed = false;
  executeStage2PlaybackSequence({
    event: {
      id: 'evt_legacy_meal',
      dedupeKey: 'dk_legacy_meal',
      source: 'simulation',
      eventType: 'gift',
      tier: 'high_gift',
      username: 'mehmet',
      displayUsername: 'Mehmet',
      giftId: 'legacy_200',
      giftName: 'Asa',
      quantity: 1,
      unitCoins: 200,
      eventCoins: 200,
      priority: 'high',
      category: 'family_peace',
      prayerId: dua.id,
      prayerTitle: dua.title,
      renderedPrayer: legacyCombined,
      arabicHarekeli: dua.arabicHarekeli,
      turkishMeaning: dua.turkishMeaning,
      arabicAudioUrl: '',
      arabicAudioStatus: 'pending_license_verification',
      scholarId: 'scholar_1',
      status: 'speaking',
      attempts: 1,
      createdAt: new Date().toISOString(),
    },
    arabicPlayer: {
      play() {
        assert.fail('Unverified audio should not play');
      },
      pause() {},
      resume() {},
      stop() {},
    },
    turkishTts: {
      speak(text, opts) {
        spokenToEngine = text;
        opts.onStart?.();
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
      pitch: 1.0,
      volume: 0.95,
    },
    onComplete: () => {
      completed = true;
    },
    onError: (err) => {
      assert.fail(`Unexpected error: ${err}`);
    },
  });

  assert.equal(completed, true);
  assert.equal(containsArabicScript(spokenToEngine), false);
  assert.equal(spokenToEngine.includes(dua.turkishMeaning), false);
  assert.equal(spokenToEngine, personalOnly);
});
