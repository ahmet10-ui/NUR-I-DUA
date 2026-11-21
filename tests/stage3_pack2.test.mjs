import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';

import { createRelayServer } from '../relay-server/server.mjs';
import { TikTokLiveConnectorService } from '../src/services/tiktokLiveConnectorService.ts';
import { classifyGiftInteraction } from '../src/services/interactionClassifier.ts';
import {
  buildMissingYasinAudioMessage,
  buildYasinClosingSpeech,
  buildYasinIntroSpeech,
  executeStage2PlaybackSequence,
  insertQueueEventPreservingActive,
  isSupportedYasinAudioFormat,
  YASIN_ACCEPTED_AUDIO_FORMATS,
} from '../src/services/stage2Flow.ts';
import {
  containsArabicScript,
  sanitizeTurkishTtsPayload,
  StudioTTSRouter,
  verifyAudioUrlSha256,
} from '../src/services/ttsService.ts';
import {
  DEFAULT_HIGH_TIER_DUAS,
  DEFAULT_MID_OPENING_PRAYERS,
  DEFAULT_TIER_RULES,
  DEFAULT_YASIN_RECITATION,
} from '../src/data/defaults.ts';

class NodeHttpEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.onopen = null;
    this.onerror = null;
    this.closed = false;
    this.lastEventId = '';
    this.req = null;
    this.res = null;
    this._connect();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  _dispatch(type, eventObj) {
    for (const fn of this.listeners.get(type) || []) fn(eventObj);
  }
  _connect() {
    const parsed = new URL(this.url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(this.lastEventId ? { 'Last-Event-ID': this.lastEventId } : {}),
        },
      },
      (res) => {
        this.res = res;
        if (res.statusCode !== 200) {
          this.onerror?.(new Error(`SSE HTTP ${res.statusCode}`));
          return;
        }
        this.onopen?.({});
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const rawBlock = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            this._parseBlock(rawBlock);
          }
        });
        res.on('end', () => {
          if (!this.closed) this.onerror?.(new Error('SSE stream ended'));
        });
        res.on('error', (err) => {
          if (!this.closed) this.onerror?.(err);
        });
      }
    );
    req.on('error', (err) => {
      if (!this.closed) this.onerror?.(err);
    });
    req.end();
    this.req = req;
  }
  _parseBlock(block) {
    let id = '';
    let eventName = 'message';
    const dataParts = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('id:')) id = line.slice(3).trim();
      else if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataParts.push(line.slice(5).trim());
    }
    if (dataParts.length === 0) return;
    if (id) this.lastEventId = id;
    this._dispatch(eventName, {
      type: eventName,
      data: dataParts.join('\n'),
      lastEventId: id || this.lastEventId,
    });
  }
  close() {
    this.closed = true;
    try {
      this.res?.destroy();
      this.req?.destroy();
    } catch {
      // ignore
    }
  }
}

async function waitFor(predicate, timeoutMs = 2000, stepMs = 15) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

function buildYasinQueueEvent(overrides = {}) {
  const username = overrides.username || 'huseyin_kaya';
  const yasinCfg = {
    ...DEFAULT_YASIN_RECITATION,
    audioStatus: 'verified_ready',
    ...(overrides.yasinConfig || {}),
  };
  return {
    id: overrides.id || 'evt_yasin_1',
    dedupeKey: overrides.dedupeKey || 'real:streak_yasin_1:0',
    source: overrides.source || 'real',
    eventType: 'gift',
    tier: 'yasin_300',
    username,
    displayUsername: `@${username}`,
    giftId: 'gift_yasin',
    giftName: overrides.giftName || 'Yâsîn Tacı',
    quantity: overrides.quantity ?? 1,
    unitCoins: overrides.unitCoins ?? 300,
    eventCoins: overrides.eventCoins ?? 300,
    priority: 'urgent',
    category: 'general_blessings',
    prayerId: yasinCfg.id,
    prayerTitle: yasinCfg.title,
    yasinIntroSpeech:
      overrides.yasinIntroSpeech !== undefined
        ? overrides.yasinIntroSpeech
        : buildYasinIntroSpeech(yasinCfg, username),
    renderedPrayer:
      overrides.renderedPrayer !== undefined
        ? overrides.renderedPrayer
        : buildYasinClosingSpeech(yasinCfg, username),
    arabicHarekeli: yasinCfg.arabicHarekeliHeader,
    turkishMeaning: overrides.turkishMeaning,
    sourceCitation: yasinCfg.sourceCitation,
    arabicAudioUrl: yasinCfg.audioUrl,
    arabicAudioLicense: yasinCfg.audioLicense,
    arabicAudioAttribution: yasinCfg.audioAttribution,
    arabicAudioStatus: yasinCfg.audioStatus,
    yasinAudioSha256: yasinCfg.audioSha256,
    scholarId: 'scholar_1',
    status: overrides.status || 'pending',
    attempts: overrides.attempts ?? 0,
    createdAt: new Date().toISOString(),
  };
}

function createFakeQueueManager() {
  const seenDedupe = new Set();
  const queue = [];
  const history = [];
  let seq = 0;

  return {
    queue,
    history,
    enqueueFromGift(gift) {
      const c = classifyGiftInteraction(
        {
          username: gift.username,
          userId: gift.userId,
          unitCoins: gift.unitCoins ?? gift.diamondCount,
          repeatCount: gift.repeatCount ?? gift.quantity,
          quantity: gift.quantity,
          giftType: gift.giftType,
          repeatEnd: gift.repeatEnd,
        },
        DEFAULT_TIER_RULES
      );
      if (!c.shouldEnqueue || !c.tier) return { ok: false, reason: c.reason };
      const key = gift.streakKey || gift.sseEventId || `k_${++seq}`;
      if (seenDedupe.has(key)) return { ok: false, reason: 'duplicate' };
      seenDedupe.add(key);

      const evt =
        c.tier === 'yasin_300'
          ? buildYasinQueueEvent({
              id: `evt_${++seq}`,
              dedupeKey: `${key}:0`,
              source: gift.isSimulated ? 'simulation' : 'real',
              username: gift.username,
              quantity: gift.repeatCount ?? gift.quantity ?? 1,
              unitCoins: c.unitCoins,
              eventCoins: c.eventCoins,
            })
          : {
              id: `evt_${++seq}`,
              dedupeKey: `${key}:0`,
              source: gift.isSimulated ? 'simulation' : 'real',
              eventType: 'gift',
              tier: c.tier,
              username: gift.username,
              displayUsername: `@${gift.username}`,
              giftId: gift.giftId || 'gift',
              giftName: gift.giftName || 'Hediye',
              quantity: gift.repeatCount ?? gift.quantity ?? 1,
              unitCoins: c.unitCoins,
              eventCoins: c.eventCoins,
              priority: c.priority,
              category: 'general_blessings',
              prayerId: 'p1',
              prayerTitle: 'Dua',
              renderedPrayer: c.renderedGreeting || `Allahım ${gift.username} kardeşimize hayırlar ver.`,
              scholarId: 'scholar_2',
              status: 'pending',
              attempts: 0,
              createdAt: new Date().toISOString(),
            };

      const sorted = insertQueueEventPreservingActive(queue, evt);
      queue.length = 0;
      queue.push(...sorted);
      return { ok: true, event: evt };
    },
  };
}

test('1-4. Single finalized 300, 600, 1000 coin gifts create exactly 1 Yâsîn each; 2 independent gifts create 2 Yâsîn items', () => {
  for (const coins of [300, 600, 1000]) {
    const c = classifyGiftInteraction({
      username: 'ahmet_can',
      unitCoins: coins,
      repeatCount: 1,
      giftType: 0,
    });
    assert.equal(c.shouldEnqueue, true);
    assert.equal(c.tier, 'yasin_300');
    assert.equal(c.eventCount, 1);
    assert.equal(c.priority, 'urgent');
    assert.equal(c.eventCoins, coins);
  }

  const mgr = createFakeQueueManager();
  const r1 = mgr.enqueueFromGift({
    username: 'ali_veli',
    giftId: 'yasin_gift',
    giftName: 'Aslan',
    unitCoins: 300,
    repeatCount: 1,
    giftType: 0,
    streakKey: 'ind_1',
  });
  const r2 = mgr.enqueueFromGift({
    username: 'veli_ali',
    giftId: 'yasin_gift',
    giftName: 'Aslan',
    unitCoins: 300,
    repeatCount: 1,
    giftType: 0,
    streakKey: 'ind_2',
  });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(mgr.queue.filter((e) => e.tier === 'yasin_300').length, 2);
});

test('5-6. Streak math: 1 coin x 300 finalized -> 1 Yâsîn; incomplete streak -> 0 Yâsîn', () => {
  const mgr = createFakeQueueManager();
  const receivedFinalized = [];
  const svc = new TikTokLiveConnectorService(
    {
      username: 'fcproplayer7',
      connectionState: 'disconnected',
      connectorEndpoint: 'http://127.0.0.1:8787',
      autoReconnect: false,
      maxRetries: 2,
      retryDelaySec: 2,
      duplicateWindowSec: 8,
      lastError: null,
      lastCheckedAt: null,
    },
    {
      onFinalizedGift: (g) => {
        receivedFinalized.push(g);
        mgr.enqueueFromGift(g);
      },
    }
  );

  // Incomplete 1 x 300 streak -> buffered ONLY, 0 Yâsîn queued
  const inc1 = svc.ingestRawGiftEvent({
    eventId: 'stk_inc_y1',
    userId: 'u300',
    username: 'serhat_seri',
    giftId: '5655',
    giftName: 'Gül',
    giftType: 1,
    repeatCount: 299,
    repeatEnd: false,
    unitCoins: 1,
  });
  assert.equal(inc1.buffered, true);
  assert.equal(receivedFinalized.length, 0);
  assert.equal(mgr.queue.length, 0);

  // Finalized 1 x 300 streak -> strictly 1 Yâsîn queued
  const fin = svc.ingestRawGiftEvent({
    eventId: 'stk_fin_y1',
    userId: 'u300',
    username: 'serhat_seri',
    giftId: '5655',
    giftName: 'Gül',
    giftType: 1,
    repeatCount: 300,
    repeatEnd: true,
    unitCoins: 1,
  });
  assert.equal(fin.accepted, true);
  assert.equal(receivedFinalized.length, 1);
  assert.equal(mgr.queue.length, 1);
  assert.equal(mgr.queue[0].tier, 'yasin_300');
  assert.equal(mgr.queue[0].eventCoins, 300);

  // Separate uncompleted streak that disconnects -> 0 new Yâsîn
  svc.ingestRawGiftEvent({
    eventId: 'stk_inc_y2',
    userId: 'u301',
    username: 'yarim_yasin',
    giftId: '5655',
    giftName: 'Gül',
    giftType: 1,
    repeatCount: 300,
    repeatEnd: false,
    unitCoins: 1,
  });
  svc.dispose();
  assert.equal(mgr.queue.length, 1);
});

test('7 & 14b. Relay SSE yasin_300 & replay deduplication blocks duplicate Yâsîn over real SSE', async () => {
  const relay = createRelayServer({ simulationEnabled: true, instanceId: 'rly_yasin_test' });
  await new Promise((r) => relay.server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${relay.server.address().port}`;
  const originalES = globalThis.EventSource;
  globalThis.EventSource = NodeHttpEventSource;

  const mgr = createFakeQueueManager();
  const finalized = [];
  const svc = new TikTokLiveConnectorService(
    {
      username: 'fcproplayer7',
      connectionState: 'disconnected',
      connectorEndpoint: baseUrl,
      autoReconnect: false,
      maxRetries: 2,
      retryDelaySec: 2,
      duplicateWindowSec: 8,
      lastError: null,
      lastCheckedAt: null,
    },
    {
      onFinalizedGift: (g) => {
        finalized.push(g);
        mgr.enqueueFromGift(g);
      },
    }
  );

  try {
    svc.connectSimulationStream('fcproplayer7');
    assert.equal(await waitFor(() => svc.getLastEventId(baseUrl, 'fcproplayer7') !== null), true);

    const simRes = await (
      await fetch(`${baseUrl}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'fcproplayer7',
          scenario: 'yasin_300',
          senderUsername: 'yasin_sim_user',
          unitCoins: 300,
        }),
      })
    ).json();
    assert.equal(simRes.ok, true);
    assert.equal(simRes.emittedCount, 1);

    assert.equal(await waitFor(() => finalized.length === 1), true);
    assert.equal(finalized[0].isSimulated, true);
    assert.equal(mgr.queue.length, 1);
    assert.equal(mgr.queue[0].tier, 'yasin_300');
    assert.equal(mgr.queue[0].source, 'simulation');

    // Replay same SSE payload -> idempotently blocked at both connector & queue levels
    const replay = svc.ingestRawGiftEvent({ ...finalized[0], replayed: true });
    assert.equal(replay.accepted, false);
    assert.equal(mgr.enqueueFromGift(finalized[0]).ok, false);
    assert.equal(mgr.queue.length, 1);
  } finally {
    svc.stopSimulationStream();
    svc.dispose();
    await relay.shutdown();
    globalThis.EventSource = originalES;
  }
});

test('8-9 & 14a. Atomic 3-phase Yâsîn sequence locks against interruption, supports pause/resume/cancel, and advances queue on completion', () => {
  const timeline = [];
  let ttsCalls = [];
  let audioCallbacks = null;
  let completedCount = 0;

  const mockArabicPlayer = {
    play(url, opts) {
      timeline.push(`arabic:play:${url}`);
      audioCallbacks = opts;
      opts.onStart?.({ durationMs: 320000 });
    },
    pause() {
      timeline.push('arabic:pause');
    },
    resume() {
      timeline.push('arabic:resume');
    },
    stop() {
      timeline.push('arabic:stop');
    },
  };

  const mockTurkishTts = {
    speak(text, opts) {
      ttsCalls.push({ text, opts });
      timeline.push(`tts:speak:${opts.scholarId}:${ttsCalls.length}`);
      opts.onStart?.();
    },
    pause() {
      timeline.push('tts:pause');
    },
    resume() {
      timeline.push('tts:resume');
    },
    stop() {
      timeline.push('tts:stop');
    },
  };

  const yasinEvent = buildYasinQueueEvent({ id: 'evt_yasin_atomic', status: 'speaking' });
  const incomingSmall = {
    id: 'evt_small_while_yasin',
    dedupeKey: 'dk_small_1',
    source: 'real',
    eventType: 'gift',
    tier: 'small_gift',
    username: 'misafir_1',
    displayUsername: '@misafir_1',
    giftId: 'cay',
    giftName: 'Çay',
    quantity: 1,
    unitCoins: 1,
    eventCoins: 1,
    priority: 'normal',
    category: 'general_blessings',
    prayerId: 'tier-small-greeting',
    prayerTitle: 'Küçük Hediye Selamlaması',
    renderedPrayer: 'Selâmün aleyküm, Misafir 1!',
    scholarId: 'scholar_2',
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
  };

  // Start atomic Yâsîn playback
  const handle = executeStage2PlaybackSequence({
    event: yasinEvent,
    arabicPlayer: mockArabicPlayer,
    turkishTts: mockTurkishTts,
    ttsOptions: {
      scholarId: 'scholar_1',
      lang: 'tr-TR',
      rate: 0.94,
      pitch: 0.68,
      volume: 1,
    },
    onPhaseChange: (p) => timeline.push(`phase:${p}`),
    onStart: () => timeline.push('started'),
    onComplete: () => {
      completedCount += 1;
      timeline.push('completed');
    },
    onError: (err) => assert.fail(`Unexpected error: ${err}`),
  });

  // Phase 1: Hacı Ahmet Efendi (scholar_1) takdim
  assert.equal(handle.getPhase(), 'yasin_intro');
  assert.equal(handle.isLocked(), true);
  assert.equal(ttsCalls.length, 1);
  assert.equal(ttsCalls[0].opts.scholarId, 'scholar_1');
  assert.equal(audioCallbacks, null, 'Yâsîn Qari audio must wait for Phase 1 takdim');

  // Test pause/resume during Phase 1
  handle.pause();
  handle.resume();

  // Incoming urgent/normal gifts queued while Yâsîn is speaking MUST NOT displace speaking Yâsîn at index 0
  let queueState = insertQueueEventPreservingActive([yasinEvent], incomingSmall);
  const incomingAnotherYasin = buildYasinQueueEvent({ id: 'evt_yasin_second', dedupeKey: 'dk_y2' });
  queueState = insertQueueEventPreservingActive(queueState, incomingAnotherYasin);
  assert.equal(queueState[0].id, 'evt_yasin_atomic', 'Active speaking Yâsîn stays undisturbed at index 0');
  assert.equal(queueState[1].id, 'evt_yasin_second', 'Pending urgent Yâsîn ranks before normal pending gift');
  assert.equal(handle.isLocked(), true);

  // Transition Phase 1 -> Phase 2 (Arabic Qari recording)
  ttsCalls[0].opts.onEnd();
  assert.equal(handle.getPhase(), 'arabic_audio');
  assert.equal(handle.isLocked(), true);
  assert.ok(audioCallbacks);
  assert.equal(audioCallbacks.expectedSha256, DEFAULT_YASIN_RECITATION.audioSha256);

  // Test pause/resume during Phase 2
  handle.pause();
  handle.resume();

  // Transition Phase 2 -> Phase 3 (Hacı Ahmet Efendi closing ithaf)
  audioCallbacks.onEnd();
  assert.equal(handle.getPhase(), 'turkish_speech');
  assert.equal(handle.isLocked(), true);
  assert.equal(ttsCalls.length, 2);
  assert.equal(ttsCalls[1].opts.scholarId, 'scholar_1');

  // Complete Phase 3 -> releases lock -> next queued event can start normally
  ttsCalls[1].opts.onEnd();
  assert.equal(handle.getPhase(), 'done');
  assert.equal(handle.isLocked(), false);
  assert.equal(completedCount, 1);
  assert.equal(timeline.includes('arabic:stop'), false, 'Yâsîn Qari audio must NEVER be interrupted while active');
  assert.deepEqual(timeline, [
    'phase:yasin_intro',
    'tts:speak:scholar_1:1',
    'started',
    'tts:pause',
    'tts:resume',
    'phase:arabic_audio',
    'arabic:play:/audio/duas/yasin_i_serif_verified.mp3',
    'arabic:pause',
    'arabic:resume',
    'phase:turkish_speech',
    'tts:speak:scholar_1:2',
    'completed',
  ]);

  // Verify waiting small_gift queued during Yâsîn continues normally right after Yâsîn unlocks
  let afterYasinDone = false;
  executeStage2PlaybackSequence({
    event: { ...incomingSmall, status: 'speaking' },
    arabicPlayer: mockArabicPlayer,
    turkishTts: mockTurkishTts,
    ttsOptions: { scholarId: 'scholar_2', lang: 'tr-TR', rate: 0.9, pitch: 0.9, volume: 1 },
    onComplete: () => { afterYasinDone = true; },
    onError: (err) => assert.fail(`Unexpected error after Yâsîn: ${err}`),
  });
  ttsCalls[ttsCalls.length - 1].opts.onEnd();
  assert.equal(afterYasinDone, true, 'Queued event after Yâsîn must continue seamlessly');

  // Verify cancel() mid-playback stops engines and unlocks cleanly
  const handle2 = executeStage2PlaybackSequence({
    event: buildYasinQueueEvent({ id: 'evt_yasin_cancel' }),
    arabicPlayer: mockArabicPlayer,
    turkishTts: mockTurkishTts,
    ttsOptions: { scholarId: 'scholar_1', lang: 'tr-TR', rate: 0.94, pitch: 0.68, volume: 1 },
    onComplete: () => assert.fail('Cancelled playback must not emit onComplete'),
    onError: () => assert.fail('Cancelled playback must not emit onError'),
  });
  assert.equal(handle2.isLocked(), true);
  handle2.cancel();
  assert.equal(handle2.isLocked(), false);
  assert.equal(handle2.getPhase(), 'done');
});

test('10a. Abdullah Awad Al-Juhani Yâsîn config (11:54, 83 ayet) is verified_ready, bundled at public/audio/duas/yasin_i_serif_verified.mp3, and passes SHA-256 verification', async () => {
  // Correct Qari & Source selected; previous Aaqib Azeez preference for Yâsîn cancelled
  assert.equal(DEFAULT_YASIN_RECITATION.audioStatus, 'verified_ready');
  assert.ok(DEFAULT_YASIN_RECITATION.audioAttribution.includes('Abdullah Awad Al-Juhani'));
  assert.ok(DEFAULT_YASIN_RECITATION.sourceCitation.includes('Abdullah Awad Al-Juhani'));
  assert.ok(DEFAULT_YASIN_RECITATION.sourceCitation.includes('83 Ayet'));
  assert.equal(DEFAULT_YASIN_RECITATION.sourceCitation.includes('Aaqib Azeez'), false);
  assert.equal(DEFAULT_YASIN_RECITATION.audioAttribution.includes('Aaqib Azeez'), false);
  assert.ok((DEFAULT_YASIN_RECITATION.audioSourceUrl || '').includes('qurancentral.net'));
  assert.ok((DEFAULT_YASIN_RECITATION.audioSourceUrl || '').includes('cdn.islamic.network/quran/audio-surah/128/ar.abdullahawadaljuhani/36.mp3'));
  assert.equal(DEFAULT_YASIN_RECITATION.audioUrl, '/audio/duas/yasin_i_serif_verified.mp3');

  // Measured duration (11:54 = 714.024s) & exact size/SHA-256
  assert.equal(DEFAULT_YASIN_RECITATION.durationLabel, '11:54');
  assert.ok(Math.abs((DEFAULT_YASIN_RECITATION.durationSec || 0) - 714.024) < 0.1);
  assert.equal(DEFAULT_YASIN_RECITATION.expectedFileBytes, 12109585);
  assert.equal(
    DEFAULT_YASIN_RECITATION.audioSha256,
    '3cd37c1e1ec60be3b46802ed8aef4c042cd5aa85373e20f2936813161d2bb7b9'
  );

  // Verified MP3 MUST exist at public/audio/duas/yasin_i_serif_verified.mp3 with exact byte size and SHA-256
  const publicDuasDir = path.resolve(process.cwd(), 'public', 'audio', 'duas');
  const yasinBundlePath = path.join(publicDuasDir, 'yasin_i_serif_verified.mp3');
  assert.equal(
    fs.existsSync(yasinBundlePath),
    true,
    'Verified Yâsîn MP3 must exist at public/audio/duas/yasin_i_serif_verified.mp3'
  );

  const fileBuffer = fs.readFileSync(yasinBundlePath);
  const targetSha = DEFAULT_YASIN_RECITATION.audioSha256;
  assert.equal(fileBuffer.length, 12109585);
  assert.equal(crypto.createHash('sha256').update(fileBuffer).digest('hex'), targetSha);

  const licenseDocPath = path.join(publicDuasDir, 'LICENSES.md');
  assert.equal(fs.existsSync(licenseDocPath), true);
  const licenseDoc = fs.readFileSync(licenseDocPath, 'utf8');
  assert.ok(licenseDoc.includes('Abdullah Awad Al-Juhani'));
  assert.ok(licenseDoc.includes('verified_ready'));
  assert.ok(licenseDoc.includes('QuranCentral'));
  assert.ok(licenseDoc.includes(targetSha));

  const server = http.createServer((req, res) => {
    if (req.url === '/audio/duas/yasin_i_serif_verified.mp3') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(fileBuffer.length) });
      res.end(fileBuffer);
      return;
    }
    if (req.url === '/audio/duas/corrupt.mp3') {
      const corrupt = Buffer.from(fileBuffer.subarray(0, 4096));
      corrupt[0] = corrupt[0] ^ 0xff;
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end(corrupt);
      return;
    }
    if (req.url === '/audio/duas/empty.mp3') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end(Buffer.alloc(0));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const validRes = await verifyAudioUrlSha256(`${baseUrl}/audio/duas/yasin_i_serif_verified.mp3`, targetSha);
    assert.equal(validRes.ok, true);
    assert.equal(validRes.actualSha256, targetSha);
    assert.equal(validRes.byteLength, fileBuffer.length);

    const corruptRes = await verifyAudioUrlSha256(`${baseUrl}/audio/duas/corrupt.mp3`, targetSha);
    assert.equal(corruptRes.ok, false);
    assert.ok(corruptRes.error && corruptRes.error.includes('SHA-256'));

    const emptyRes = await verifyAudioUrlSha256(`${baseUrl}/audio/duas/empty.mp3`, targetSha);
    assert.equal(emptyRes.ok, false);
    assert.ok(emptyRes.error && emptyRes.error.includes('boş'));

    const missingRes = await verifyAudioUrlSha256(`${baseUrl}/audio/duas/missing.mp3`, targetSha);
    assert.equal(missingRes.ok, false);
    assert.ok(missingRes.error && missingRes.error.includes('404'));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('10b. Pending-license override OR corrupt/hash-mismatched Yâsîn audio triggers clean error, releases lock, never fakes Step 3, and allows queue continuation', () => {
  // Case A: explicit pending_license_verification override -> immediate clean error, zero TTS/audio started
  let errA = null;
  let ttsCalledA = false;
  let audioCalledA = false;
  const hA = executeStage2PlaybackSequence({
    event: buildYasinQueueEvent({
      yasinConfig: { audioStatus: 'pending_license_verification' },
    }),
    arabicPlayer: {
      play() { audioCalledA = true; },
      pause() {},
      resume() {},
      stop() {},
    },
    turkishTts: {
      speak() { ttsCalledA = true; },
      pause() {},
      resume() {},
      stop() {},
    },
    ttsOptions: { scholarId: 'scholar_1', lang: 'tr-TR', rate: 0.94, pitch: 0.68, volume: 1 },
    onComplete: () => assert.fail('Unverified Yâsîn audio must NOT emit onComplete'),
    onError: (msg) => { errA = msg; },
  });
  assert.equal(audioCalledA, false);
  assert.equal(ttsCalledA, false);
  assert.equal(hA.isLocked(), false);
  assert.equal(hA.getPhase(), 'done');
  assert.ok(errA && errA.includes('.mp3') && errA.includes('.m4a') && errA.includes('.ogg') && errA.includes('.wav'));
  assert.ok(errA.includes('verified_ready'));

  // Case B: corrupt/404/hash-mismatch audio during Phase 2 -> emits onError, releases lock, NEVER fakes Phase 3 closing prayer
  let errB = null;
  let ttsCountB = 0;
  let completedB = false;
  const hB = executeStage2PlaybackSequence({
    event: buildYasinQueueEvent({ id: 'evt_yasin_corrupt' }),
    arabicPlayer: {
      play(_url, opts) {
        opts.onError?.('Ses dosyası SHA-256 doğrulaması başarısız (bozuk dosya)');
      },
      pause() {},
      resume() {},
      stop() {},
    },
    turkishTts: {
      speak(_text, opts) {
        ttsCountB += 1;
        opts.onStart?.();
        opts.onEnd?.();
      },
      pause() {},
      resume() {},
      stop() {},
    },
    ttsOptions: { scholarId: 'scholar_1', lang: 'tr-TR', rate: 0.94, pitch: 0.68, volume: 1 },
    onComplete: () => { completedB = true; },
    onError: (msg) => { errB = msg; },
  });
  assert.equal(ttsCountB, 1, 'Only Phase 1 takdim ran; Phase 3 closing MUST NOT run on corrupt Yâsîn audio');
  assert.equal(completedB, false);
  assert.equal(hB.isLocked(), false);
  assert.equal(hB.getPhase(), 'done');
  assert.ok(errB && errB.includes('SHA-256'));

  // Next queued small/mid event still executes normally after error unlocked the queue
  let nextDone = false;
  executeStage2PlaybackSequence({
    event: {
      id: 'evt_after_err',
      dedupeKey: 'dk_after',
      source: 'real',
      eventType: 'gift',
      tier: 'small_gift',
      username: 'sonraki_kisi',
      displayUsername: '@sonraki_kisi',
      giftId: 'cay',
      giftName: 'Çay',
      quantity: 1,
      priority: 'normal',
      category: 'general_blessings',
      prayerId: 'tier-small-greeting',
      prayerTitle: 'Selamlama',
      renderedPrayer: 'Selâmün aleyküm, Sonraki Kisi!',
      scholarId: 'scholar_2',
      status: 'speaking',
      attempts: 1,
      createdAt: new Date().toISOString(),
    },
    arabicPlayer: { play() {}, pause() {}, resume() {}, stop() {} },
    turkishTts: {
      speak(_t, opts) { opts.onStart?.(); opts.onEnd?.(); },
      pause() {},
      resume() {},
      stop() {},
    },
    ttsOptions: { scholarId: 'scholar_2', lang: 'tr-TR', rate: 0.9, pitch: 0.9, volume: 1 },
    onComplete: () => { nextDone = true; },
    onError: (e) => assert.fail(e),
  });
  assert.equal(nextDone, true);
});

test('11-12. Yâsîn has strictly NO Turkish meal on screen or in TTS, and Arabic/meal never reach Turkish TTS engines', () => {
  // Default Yâsîn config has empty meal notice and simple status title
  assert.equal(DEFAULT_YASIN_RECITATION.turkishMealNotice, '');
  assert.equal(DEFAULT_YASIN_RECITATION.title, 'Yâsîn-i Şerîf okunuyor');

  const yasinEvent = buildYasinQueueEvent();
  assert.equal(yasinEvent.turkishMeaning, undefined, 'Yâsîn queue event must carry no turkishMeaning');

  // Verify BroadcastView never renders Arabic text or Turkish meal for any tier, and StudioContext keeps Yâsîn meal undefined
  const broadcastSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/BroadcastView.tsx'), 'utf8');
  const broadcastDisplaySrc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/broadcastDisplay.ts'), 'utf8');
  const studioCtxSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/context/StudioContext.tsx'), 'utf8');
  assert.equal(broadcastSrc.includes('arabicHarekeli'), false);
  assert.equal(broadcastSrc.includes('turkishMeaning'), false);
  assert.equal(broadcastSrc.includes('Meal:'), false);
  assert.ok(broadcastDisplaySrc.includes('Yâsîn-i Şerîf okunuyor'));
  assert.ok(studioCtxSrc.includes('turkishMeaning = undefined'));

  const spokenPayloads = [];
  const fakeProvider = {
    id: 'browser_speech_synthesis',
    label: 'Stub',
    isStudioGrade: false,
    isSupported: () => true,
    speak(text, opts) {
      spokenPayloads.push(text);
      opts.onStart?.();
      opts.onEnd?.();
    },
    pause() {},
    resume() {},
    stop() {},
  };
  const router = new StudioTTSRouter(fakeProvider, fakeProvider, fakeProvider, fakeProvider);

  const sampleForbiddenMeal = 'Örnek Türkçe meal metni kesinlikle seslendirilmemelidir.';
  const arabicHeader = DEFAULT_YASIN_RECITATION.arabicHarekeliHeader;
  const cleanClosing = buildYasinClosingSpeech(DEFAULT_YASIN_RECITATION, 'Mustafa');

  // Inject Arabic + meal directly into text routed through StudioTTSRouter
  const poisonedText = `${arabicHeader} ${sampleForbiddenMeal} ${cleanClosing}`;
  let routerErr = null;
  let routerEnded = false;
  router.speak(poisonedText, {
    scholarId: 'scholar_2',
    forbiddenMealText: sampleForbiddenMeal,
    lang: 'tr-TR',
    rate: 0.9,
    pitch: 0.9,
    volume: 1,
    onEnd: () => { routerEnded = true; },
    onError: (e) => { routerErr = e; },
  });
  assert.equal(routerEnded, true);
  assert.equal(routerErr, null);
  assert.equal(spokenPayloads.length, 1);
  assert.equal(containsArabicScript(spokenPayloads[0]), false);
  assert.equal(spokenPayloads[0].includes(sampleForbiddenMeal), false);
  assert.equal(spokenPayloads[0], cleanClosing);

  // Pure Arabic or pure meal alone is rejected with onError and NEVER reaches provider
  const prevCount = spokenPayloads.length;
  let rejectedErr = null;
  router.speak(`${arabicHeader} ${sampleForbiddenMeal}`, {
    scholarId: 'scholar_2',
    forbiddenMealText: sampleForbiddenMeal,
    lang: 'tr-TR',
    rate: 0.9,
    pitch: 0.9,
    volume: 1,
    onError: (e) => { rejectedErr = e; },
  });
  assert.equal(spokenPayloads.length, prevCount, 'Provider must NEVER be called for Arabic/meal-only text');
  assert.ok(rejectedErr);
  assert.equal(sanitizeTurkishTtsPayload(arabicHeader, sampleForbiddenMeal), '');
});

test('13 & 14c. Existing long takdim, thank-you/ithaf & Stage 1/2 texts preserved verbatim without shortening', () => {
  const intro = buildYasinIntroSpeech(DEFAULT_YASIN_RECITATION, 'yusuf_demir');
  const closing = buildYasinClosingSpeech(DEFAULT_YASIN_RECITATION, 'yusuf_demir');

  // Full length & all key parts preserved verbatim
  assert.ok(intro.includes('Yusuf Demir'));
  assert.ok(intro.includes('Yâsîn-i Şerîf'));
  assert.equal(
    intro,
    DEFAULT_YASIN_RECITATION.introSpeechTemplate.replace(/\{isim\}/gi, 'Yusuf Demir')
  );

  assert.ok(closing.includes('Yusuf Demir'));
  assert.ok(closing.toLowerCase().includes('anne ve babasının'));
  assert.ok(closing.toLowerCase().includes('akrabalarının'));
  assert.ok(closing.toLowerCase().includes('vefat etmiş yakınlarının'));
  assert.equal(
    closing,
    DEFAULT_YASIN_RECITATION.closingPrayerTemplate.replace(/\{isim\}/gi, 'Yusuf Demir')
  );

  // Accepted format validator check & missing-audio helper message sanity
  for (const ext of YASIN_ACCEPTED_AUDIO_FORMATS) {
    assert.equal(isSupportedYasinAudioFormat(`/audio/duas/yasin${ext}`), true);
  }
  assert.equal(isSupportedYasinAudioFormat('/audio/duas/yasin.txt'), false);
  assert.ok(buildMissingYasinAudioMessage(DEFAULT_YASIN_RECITATION).includes('.mp3'));

  // Stage 2 existing high-tier & mid-tier pools preserved untouched
  assert.equal(DEFAULT_HIGH_TIER_DUAS.length, 2);
  assert.equal(DEFAULT_MID_OPENING_PRAYERS.length, 5);
});

test('15. StudioContext avoids handle TDZ ReferenceError on synchronous onError/onComplete (e.g. pending Yâsîn license)', () => {
  const studioCtxSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/context/StudioContext.tsx'), 'utf8');
  assert.equal(
    studioCtxSrc.includes('const handle = executeStage2PlaybackSequence('),
    false,
    'StudioContext must not bind executeStage2PlaybackSequence return value with const before synchronous callbacks run'
  );
  assert.ok(studioCtxSrc.includes('let handle: Stage2PlaybackHandle | null = null;'));
  assert.ok(studioCtxSrc.includes('let settledSynchronously = false;'));

  let activeRef = null;
  let handle = null;
  let settledSynchronously = false;
  let errReason = null;

  handle = executeStage2PlaybackSequence({
    event: buildYasinQueueEvent({
      id: 'evt_yasin_sync_err',
      yasinConfig: { audioStatus: 'pending_license_verification' },
    }),
    arabicPlayer: { play() {}, pause() {}, resume() {}, stop() {} },
    turkishTts: { speak() {}, pause() {}, resume() {}, stop() {} },
    ttsOptions: { scholarId: 'scholar_1', lang: 'tr-TR', rate: 0.94, pitch: 0.68, volume: 1 },
    onComplete: () => {
      settledSynchronously = true;
      if (!handle || activeRef === handle) {
        activeRef = null;
      }
      assert.fail('Pending Yâsîn must emit onError, not onComplete');
    },
    onError: (reason) => {
      settledSynchronously = true;
      if (!handle || activeRef === handle) {
        activeRef = null;
      }
      errReason = reason;
    },
  });

  if (!settledSynchronously && handle.isLocked()) {
    activeRef = handle;
  } else if (activeRef === handle) {
    activeRef = null;
  }

  assert.equal(settledSynchronously, true);
  assert.equal(activeRef, null);
  assert.equal(handle.isLocked(), false);
  assert.ok(errReason && errReason.includes('verified_ready'));
});

test('16. Un-overridden DEFAULT_YASIN_RECITATION runs 3-phase sequence with exact SHA-256 and Capacitor Android asset sync', () => {
  const realEvent = {
    ...buildYasinQueueEvent({
      id: 'evt_yasin_real_default',
      yasinConfig: DEFAULT_YASIN_RECITATION,
    }),
  };
  assert.equal(realEvent.arabicAudioStatus, 'verified_ready');
  assert.equal(realEvent.arabicAudioUrl, '/audio/duas/yasin_i_serif_verified.mp3');
  assert.equal(
    realEvent.yasinAudioSha256,
    '3cd37c1e1ec60be3b46802ed8aef4c042cd5aa85373e20f2936813161d2bb7b9'
  );
  assert.equal(realEvent.turkishMeaning, undefined);

  const phases = [];
  const spoken = [];
  let audioPlayedUrl = null;
  let audioExpectedSha = null;
  let completed = false;

  executeStage2PlaybackSequence({
    event: realEvent,
    arabicPlayer: {
      play(url, opts) {
        audioPlayedUrl = url;
        audioExpectedSha = opts.expectedSha256;
        opts.onStart?.({ durationMs: 714024 });
        opts.onEnd?.();
      },
      pause() {},
      resume() {},
      stop() {},
    },
    turkishTts: {
      speak(text, opts) {
        spoken.push({ scholarId: opts.scholarId, text });
        opts.onStart?.();
        opts.onEnd?.();
      },
      pause() {},
      resume() {},
      stop() {},
    },
    ttsOptions: { scholarId: 'scholar_1', lang: 'tr-TR', rate: 0.94, pitch: 0.68, volume: 1 },
    onPhaseChange: (p) => phases.push(p),
    onComplete: () => {
      completed = true;
    },
    onError: (e) => assert.fail(`Unexpected error: ${e}`),
  });

  assert.equal(completed, true);
  assert.deepEqual(phases, ['yasin_intro', 'arabic_audio', 'turkish_speech']);
  assert.equal(audioPlayedUrl, '/audio/duas/yasin_i_serif_verified.mp3');
  assert.equal(
    audioExpectedSha,
    '3cd37c1e1ec60be3b46802ed8aef4c042cd5aa85373e20f2936813161d2bb7b9'
  );
  assert.equal(spoken.length, 2);
  assert.equal(spoken[0].scholarId, 'scholar_1');
  assert.equal(spoken[1].scholarId, 'scholar_1');
  assert.equal(containsArabicScript(spoken[0].text), false);
  assert.equal(containsArabicScript(spoken[1].text), false);

  const androidAssetPath = path.resolve(
    process.cwd(),
    'android',
    'app',
    'src',
    'main',
    'assets',
    'public',
    'audio',
    'duas',
    'yasin_i_serif_verified.mp3'
  );
  assert.equal(
    fs.existsSync(androidAssetPath),
    true,
    'Capacitor Android assets must contain yasin_i_serif_verified.mp3'
  );
  const androidBuf = fs.readFileSync(androidAssetPath);
  assert.equal(androidBuf.length, 12109585);
  assert.equal(
    crypto.createHash('sha256').update(androidBuf).digest('hex'),
    '3cd37c1e1ec60be3b46802ed8aef4c042cd5aa85373e20f2936813161d2bb7b9'
  );
});


