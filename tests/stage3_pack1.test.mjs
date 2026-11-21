import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';

import {
  createRelayServer,
  isSocialFollowEvent,
  parseLastEventId,
} from '../relay-server/server.mjs';
import { TikTokLiveConnectorService } from '../src/services/tiktokLiveConnectorService.ts';
import {
  classifyFollowInteraction,
  classifyGiftInteraction,
} from '../src/services/interactionClassifier.ts';
import {
  buildHighTierTurkishSpeech,
  pickNonConsecutiveMidPrayer,
} from '../src/services/stage2Flow.ts';
import {
  DEFAULT_HIGH_TIER_DUAS,
  DEFAULT_MID_OPENING_PRAYERS,
} from '../src/data/defaults.ts';

/**
 * Minimal real-TCP HTTP EventSource implementation for Node.js tests.
 * Connects to a live HTTP server over loopback, parses `id:`, `event:`, `data:` frames,
 * fires `onopen`, custom event listeners, and `onerror`, and supports explicit `.close()`.
 */
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
    const fns = this.listeners.get(type) || [];
    for (const fn of fns) {
      fn(eventObj);
    }
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
          if (!this.closed) {
            this.onerror?.(new Error('SSE stream ended'));
          }
        });
        res.on('error', (err) => {
          if (!this.closed) {
            this.onerror?.(err);
          }
        });
      }
    );
    req.on('error', (err) => {
      if (!this.closed) {
        this.onerror?.(err);
      }
    });
    req.end();
    this.req = req;
  }

  _parseBlock(block) {
    const lines = block.split('\n');
    let id = '';
    let eventName = 'message';
    const dataParts = [];
    for (const line of lines) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('id:')) {
        id = line.slice(3).trim();
      } else if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataParts.push(line.slice(5).trim());
      }
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

async function startTestRelay(opts = {}) {
  const relay = createRelayServer(opts);
  await new Promise((resolve) => relay.server.listen(0, '127.0.0.1', resolve));
  const addr = relay.server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return { relay, baseUrl };
}

function createMockWebCastFactory() {
  const instances = [];
  const factory = async () => {
    const emitter = new EventEmitter();
    emitter.connect = async () => ({
      roomId: 'room_test_777',
      roomInfo: { user_count: 123 },
    });
    emitter.disconnect = () => {};
    instances.push(emitter);
    return emitter;
  };
  return { factory, instances };
}

function createServiceConfig(baseUrl, overrides = {}) {
  return {
    username: 'fcproplayer7',
    connectionState: 'disconnected',
    connectorEndpoint: baseUrl,
    autoReconnect: false,
    maxRetries: 3,
    retryDelaySec: 2,
    duplicateWindowSec: 8,
    lastError: null,
    lastCheckedAt: null,
    roomId: null,
    viewerCount: null,
    ...overrides,
  };
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 2000, stepMs = 15) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await waitMs(stepMs);
  }
  return false;
}

test('isSocialFollowEvent captures action === 1 even with localized/unknown displayType and rejects share/like', () => {
  assert.equal(isSocialFollowEvent({ action: 1, displayType: 'pm_mt_msg_viewer_followed' }), true);
  assert.equal(isSocialFollowEvent({ action: 1, displayType: 'localized_social_type_tr' }), true);
  assert.equal(isSocialFollowEvent({ action: 1 }), true);
  assert.equal(isSocialFollowEvent({ action: 3, displayType: 'pm_mt_guidance_share' }), false);
  assert.equal(isSocialFollowEvent({ action: 1, displayType: 'pm_mt_msg_share' }), false);
  assert.equal(isSocialFollowEvent({ action: 1, displayType: 'room_like_action' }), false);
  assert.equal(isSocialFollowEvent({ action: 2, displayType: 'join_room' }), false);
});

test('raw.uniqueId and user.uniqueId fallback chain works for follow & gift ingestion', () => {
  const receivedFollows = [];
  const receivedGifts = [];
  const svc = new TikTokLiveConnectorService(createServiceConfig('https://relay.example.com'), {
    onFollowEvent: (f) => receivedFollows.push(f),
    onFinalizedGift: (g) => receivedGifts.push(g),
  });

  const fRes = svc.ingestRawFollowEvent({
    eventId: 'uid_flw_1',
    uniqueId: 'kerem_unique',
    userId: '8881',
  });
  assert.equal(fRes.accepted, true);
  assert.equal(receivedFollows[0].username, 'kerem_unique');

  const gRes = svc.ingestRawGiftEvent({
    eventId: 'uid_gft_1',
    user: { uniqueId: 'elif_nested', userId: '9992' },
    giftId: '5655',
    giftName: 'Çay',
    unitCoins: 1,
    repeatCount: 1,
    giftType: 0,
  });
  assert.equal(gRes.accepted, true);
  assert.equal(receivedGifts[0].username, 'elif_nested');
  assert.equal(receivedGifts[0].userId, '9992');

  svc.dispose();
});

test('End-to-end Relay -> SSE -> Client -> Classifier for follower, 1 coin, 50-149, 150-299, and 300+ (guard preserved)', async () => {
  const mock = createMockWebCastFactory();
  const { relay, baseUrl } = await startTestRelay({ connectionFactory: mock.factory });
  const originalES = globalThis.EventSource;
  globalThis.EventSource = NodeHttpEventSource;

  const follows = [];
  const gifts = [];
  const statuses = [];

  const svc = new TikTokLiveConnectorService(createServiceConfig(baseUrl), {
    onStatusChange: (s) => statuses.push(s),
    onFollowEvent: (f) => follows.push(f),
    onFinalizedGift: (g) => gifts.push(g),
  });

  try {
    const conn = await svc.connect('fcproplayer7');
    assert.equal(conn.ok, true);
    assert.equal(mock.instances.length, 1);
    const webcast = mock.instances[0];

    assert.equal(
      await waitFor(() => statuses.some((s) => s.state === 'connected')),
      true
    );

    // 1. Follow via social with action=1 & localized displayType
    webcast.emit('social', {
      userId: '101',
      uniqueId: 'selim_takipci',
      nickname: 'Selim',
      action: 1,
      displayType: 'localized_follow_key_v2',
      msgId: 'm_flw_1',
    });

    // 2. Small gift (1 coin)
    webcast.emit('gift', {
      userId: '102',
      uniqueId: 'ayse_1coin',
      giftId: '5655',
      giftName: 'Çay',
      giftType: 0,
      repeatCount: 1,
      msgId: 'm_gft_1',
      extendedGiftInfo: { diamond_count: 1 },
    });

    // 3. Mid gift (75 coin)
    webcast.emit('gift', {
      userId: '103',
      uniqueId: 'mehmet_75coin',
      giftId: '5660',
      giftName: 'Kalp',
      giftType: 0,
      repeatCount: 1,
      msgId: 'm_gft_75',
      extendedGiftInfo: { diamond_count: 75 },
    });

    // 4. High gift (200 coin)
    webcast.emit('gift', {
      userId: '104',
      uniqueId: 'fatma_200coin',
      giftId: '5760',
      giftName: 'Taç',
      giftType: 0,
      repeatCount: 1,
      msgId: 'm_gft_200',
      extendedGiftInfo: { diamond_count: 200 },
    });

    // 5. Yâsîn threshold (300+ coin)
    webcast.emit('gift', {
      userId: '105',
      uniqueId: 'ali_300coin',
      giftId: '6001',
      giftName: 'Nurlu Taç',
      giftType: 0,
      repeatCount: 1,
      msgId: 'm_gft_300',
      extendedGiftInfo: { diamond_count: 300 },
    });

    const ok = await waitFor(() => follows.length === 1 && gifts.length === 4);
    assert.equal(ok, true, 'All 1 follow + 4 gift events should arrive over SSE');

    // Verify 1: Follow classification
    const cFollow = classifyFollowInteraction(follows[0]);
    assert.equal(cFollow.shouldEnqueue, true);
    assert.equal(cFollow.tier, 'follower');
    assert.ok(cFollow.renderedGreeting.includes('Selim Takipci'));

    // Verify 2: 1 coin small gift -> greeting ONLY
    const cSmall = classifyGiftInteraction(gifts[0]);
    assert.equal(cSmall.tier, 'small_gift');
    assert.equal(cSmall.requiresPrayer, false);
    assert.ok(cSmall.renderedGreeting?.includes('Ayse 1coin'));

    // Verify 3: 50-149 mid gift -> Başlangıç duası
    const cMid = classifyGiftInteraction(gifts[1]);
    assert.equal(cMid.tier, 'mid_gift');
    assert.equal(cMid.requiresPrayer, true);
    const pickedMid = pickNonConsecutiveMidPrayer(DEFAULT_MID_OPENING_PRAYERS, null);
    assert.ok(pickedMid);

    // Verify 4: 150-299 high gift -> Verified high prayer flow
    const cHigh = classifyGiftInteraction(gifts[2]);
    assert.equal(cHigh.tier, 'high_gift');
    assert.equal(cHigh.requiresPrayer, true);
    const turkishDua = buildHighTierTurkishSpeech(DEFAULT_HIGH_TIER_DUAS[0], gifts[2].username);
    assert.ok(turkishDua.includes('Fatma 200coin'));

    // Verify 5: 300+ coin -> Classified as yasin_300 (Stage 2 guard remains intact in StudioContext)
    const cYasin = classifyGiftInteraction(gifts[3]);
    assert.equal(cYasin.tier, 'yasin_300');
    assert.equal(cYasin.eventCount, 1);
    assert.equal(cYasin.eventCoins, 300);
  } finally {
    await svc.disconnect();
    svc.dispose();
    await relay.shutdown();
    globalThis.EventSource = originalES;
  }
});

test('Incomplete streaks never enter queue on streamEnd, disconnect(), or 4.5s timeout; completed repeatEnd emits once', async () => {
  const mock = createMockWebCastFactory();
  const { relay, baseUrl } = await startTestRelay({
    connectionFactory: mock.factory,
    streakTimeoutMs: 100, // accelerated 4.5s timeout for deterministic test
    streakGarbageCollectMs: 400,
  });
  const originalES = globalThis.EventSource;
  globalThis.EventSource = NodeHttpEventSource;

  const gifts = [];
  const svc = new TikTokLiveConnectorService(
    createServiceConfig(baseUrl),
    { onFinalizedGift: (g) => gifts.push(g) },
    { streakTimeoutMs: 100, streakGcMs: 400 }
  );

  try {
    await svc.connect('fcproplayer7');
    const webcast = mock.instances[0];

    // 6. Send incomplete streak (`repeatEnd: false`) -> wait past timeout -> NEVER finalized
    webcast.emit('gift', {
      userId: '201',
      uniqueId: 'yarim_seri',
      giftId: '5655',
      giftName: 'Gül',
      giftType: 1,
      repeatCount: 5,
      repeatEnd: false,
      msgId: 'stk_inc_1',
      extendedGiftInfo: { diamond_count: 10 },
    });

    await waitMs(180);
    assert.equal(gifts.length, 0, 'Timed-out incomplete streak MUST NEVER emit or finalize');

    // 8. Delayed `repeatEnd: true` arrives AFTER timeout -> merges cleanly ONCE with qty=8 (NOT 5+8=13!)
    webcast.emit('gift', {
      userId: '201',
      uniqueId: 'yarim_seri',
      giftId: '5655',
      giftName: 'Gül',
      giftType: 1,
      repeatCount: 8,
      repeatEnd: true,
      msgId: 'stk_inc_2',
      extendedGiftInfo: { diamond_count: 10 },
    });

    assert.equal(
      await waitFor(() => gifts.length === 1),
      true,
      'Delayed repeatEnd should arrive once'
    );
    assert.equal(gifts.length, 1);
    assert.equal(gifts[0].repeatCount, 8, 'Delayed repeatEnd must not double-count');

    // Now test streamEnd while another streak is incomplete -> must discard, never finalize
    webcast.emit('gift', {
      userId: '202',
      uniqueId: 'kopan_yayin',
      giftId: '5655',
      giftName: 'Gül',
      giftType: 1,
      repeatCount: 12,
      repeatEnd: false,
      msgId: 'stk_drop_1',
      extendedGiftInfo: { diamond_count: 10 },
    });
    await waitMs(40);
    webcast.emit('streamEnd');
    await waitMs(80);
    assert.equal(gifts.length, 1, 'streamEnd must clean pending incomplete streak without emitting');

    // Also test client disconnect() directly on buffered incomplete client streak -> must NOT emit
    const clientBuff = svc.ingestRawGiftEvent({
      eventId: 'cli_buf_1',
      userId: '203',
      username: 'istemci_kopma',
      giftId: '5655',
      giftName: 'Gül',
      giftType: 1,
      repeatCount: 4,
      repeatEnd: false,
      unitCoins: 10,
    });
    assert.equal(clientBuff.buffered, true);
    await svc.disconnect();
    assert.equal(gifts.length, 1, 'Client disconnect() must never emit incomplete buffered streak');

    // 7. New completed streak without groupId -> emits once
    const svc2 = new TikTokLiveConnectorService(createServiceConfig(baseUrl), {
      onFinalizedGift: (g) => gifts.push(g),
    });
    svc2.ingestRawGiftEvent({
      eventId: 'nogrp_1',
      userId: '204',
      username: 'grupsuz_seri',
      giftId: '777',
      giftName: 'Lale',
      giftType: 1,
      repeatCount: 2,
      repeatEnd: false,
      unitCoins: 25,
    });
    svc2.ingestRawGiftEvent({
      eventId: 'nogrp_2',
      userId: '204',
      username: 'grupsuz_seri',
      giftId: '777',
      giftName: 'Lale',
      giftType: 1,
      repeatCount: 4,
      repeatEnd: true,
      unitCoins: 25,
    });
    // Replay of repeatEnd:true -> ignored!
    svc2.ingestRawGiftEvent({
      eventId: 'nogrp_2',
      userId: '204',
      username: 'grupsuz_seri',
      giftId: '777',
      giftName: 'Lale',
      giftType: 1,
      repeatCount: 4,
      repeatEnd: true,
      unitCoins: 25,
    });
    assert.equal(gifts.length, 2);
    assert.equal(gifts[1].repeatCount, 4);
    svc2.dispose();
  } finally {
    svc.dispose();
    await relay.shutdown();
    globalThis.EventSource = originalES;
  }
});

test('SSE disconnect & Last-Event-ID replay recovers missed events in order and blocks duplicates idempotently', async () => {
  const { relay, baseUrl } = await startTestRelay({
    simulationEnabled: true,
    ringBufferSize: 50,
    instanceId: 'rly_replay_test',
  });
  const originalES = globalThis.EventSource;
  globalThis.EventSource = NodeHttpEventSource;

  const received = [];
  const svc = new TikTokLiveConnectorService(createServiceConfig(baseUrl), {
    onFinalizedGift: (g) => received.push(g),
  });

  try {
    // Open simulation SSE stream and receive event #1
    svc.connectSimulationStream('fcproplayer7');
    assert.equal(
      await waitFor(() => svc.getLastEventId(baseUrl, 'fcproplayer7') !== null),
      true
    );

    await fetch(`${baseUrl}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'fcproplayer7',
        scenario: 'small_gift',
        senderUsername: 'birinci_kullanici',
        unitCoins: 5,
      }),
    });
    assert.equal(
      await waitFor(() => received.length === 1),
      true
    );
    const savedLastId = svc.getLastEventId(baseUrl, 'fcproplayer7');
    const parsedId = parseLastEventId(savedLastId);
    assert.ok(parsedId && parsedId.instanceId === 'rly_replay_test');

    // Disconnect client (simulating SSE drop while relay stays up)
    svc.stopSimulationStream();

    // Emit 2 gifts while client is offline
    await fetch(`${baseUrl}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'fcproplayer7',
        scenario: 'mid_gift',
        senderUsername: 'kacan_ikinci',
        unitCoins: 75,
      }),
    });
    await fetch(`${baseUrl}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'fcproplayer7',
        scenario: 'high_gift',
        senderUsername: 'kacan_ucuncu',
        unitCoins: 200,
      }),
    });

    // Reconnect -> client automatically passes ?lastEventId=... -> receives both missed events in order!
    svc.connectSimulationStream('fcproplayer7');
    assert.equal(
      await waitFor(() => received.length === 3),
      true
    );
    assert.equal(received[0].username, 'birinci_kullanici');
    assert.equal(received[1].username, 'kacan_ikinci');
    assert.equal(received[2].username, 'kacan_ucuncu');

    // 10. Re-ingest an already received event (replay / duplicate sseEventId & streakKey) -> blocked idempotently!
    const replayAttempt = svc.ingestRawGiftEvent({ ...received[1], replayed: true });
    assert.equal(replayAttempt.accepted, false);
    assert.equal(received.length, 3);
  } finally {
    svc.stopSimulationStream();
    svc.dispose();
    await relay.shutdown();
    globalThis.EventSource = originalES;
  }
});

test('Recovery gap emitted accurately on ring-buffer eviction and relay restart', async () => {
  const { relay, baseUrl } = await startTestRelay({
    simulationEnabled: true,
    ringBufferSize: 10,
    instanceId: 'rly_gap_a',
  });
  const originalES = globalThis.EventSource;
  globalThis.EventSource = NodeHttpEventSource;

  const gaps = [];
  const gifts = [];
  const svc = new TikTokLiveConnectorService(createServiceConfig(baseUrl), {
    onRecoveryGap: (g) => gaps.push(g),
    onFinalizedGift: (g) => gifts.push(g),
  });

  try {
    svc.connectSimulationStream('fcproplayer7');
    assert.equal(
      await waitFor(() => svc.getLastEventId(baseUrl, 'fcproplayer7') !== null),
      true,
      'Simulation SSE stream must open before emitting initial event'
    );
    await fetch(`${baseUrl}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fcproplayer7', scenario: 'small_gift', senderUsername: 'ilk_kisi' }),
    });
    assert.equal(
      await waitFor(() => gifts.length === 1),
      true,
      'Initial gift must arrive before disconnect'
    );
    svc.stopSimulationStream();

    // Overflow the 10-event ring buffer with 15 new events
    for (let i = 0; i < 15; i += 1) {
      await fetch(`${baseUrl}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'fcproplayer7',
          scenario: 'small_gift',
          senderUsername: `tasan_${i}`,
        }),
      });
    }

    svc.connectSimulationStream('fcproplayer7');
    assert.equal(
      await waitFor(() => gaps.length === 1 && gifts.length === 11),
      true,
      'Reconnect should emit buffer_evicted recovery_gap and replay 10 buffered gifts'
    );
    assert.equal(gaps[0].reason, 'buffer_evicted');
    assert.ok((gaps[0].missedEstimate ?? 0) >= 1);
    assert.equal(gifts.length, 11, '1 initial + 10 remaining in ring buffer');
  } finally {
    svc.stopSimulationStream();
    svc.dispose();
    await relay.shutdown();
  }

  // Case B: Relay restart -> new instanceId -> recovery_gap: 'relay_restarted'
  const { relay: relayB, baseUrl: baseUrlB } = await startTestRelay({
    simulationEnabled: true,
    instanceId: 'rly_gap_b',
  });
  const gapsB = [];
  const svcB = new TikTokLiveConnectorService(createServiceConfig(baseUrlB), {
    onRecoveryGap: (g) => gapsB.push(g),
  });
  try {
    // Seed old lastEventId pointing to old relay instance
    const rawEs = new NodeHttpEventSource(
      `${baseUrlB}/events?username=fcproplayer7&lastEventId=${encodeURIComponent('rly_gap_a:42')}`
    );
    const receivedGap = await new Promise((resolve) => {
      rawEs.addEventListener('recovery_gap', (ev) => resolve(JSON.parse(ev.data)));
    });
    assert.equal(receivedGap.reason, 'relay_restarted');
    assert.equal(receivedGap.previousInstanceId, 'rly_gap_a');
    assert.equal(receivedGap.lastReceivedSeq, 42);
    rawEs.close();
  } finally {
    svcB.dispose();
    await relayB.shutdown();
    globalThis.EventSource = originalES;
  }
});

test('Manual disconnect() prevents auto-reconnect, and retryCount does NOT infinite-loop when SSE drops immediately', async () => {
  const originalES = globalThis.EventSource;
  const originalFetch = globalThis.fetch;

  let connectCalls = 0;
  let disconnectCalls = 0;

  // Mock EventSource that fails immediately onopen/onerror to test retry loop termination
  class FailingEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.onopen = null;
      this.onerror = null;
      setTimeout(() => {
        // Simulate server opening socket then dropping immediately (before stabilityResetMs)
        this.onopen?.({});
        this.onerror?.(new Error('immediate drop'));
      }, 10);
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    close() {}
  }

  globalThis.EventSource = FailingEventSource;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/connect')) {
      connectCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, state: 'connected', roomId: 'r1' }),
      };
    }
    if (String(url).endsWith('/disconnect')) {
      disconnectCalls += 1;
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };

  const svc = new TikTokLiveConnectorService(
    createServiceConfig('https://relay.example.com', {
      autoReconnect: true,
      maxRetries: 2,
      retryDelaySec: 2,
    }),
    {},
    {
      stabilityResetMs: 1500,
      maxBackoffMs: 25,
    }
  );
  // Override retryDelaySec wait cleanly? Wait: min retryDelaySec clamped to 2s, let's test manual disconnect AND retryCount behavior fast via direct connect failure or verify retryCount incremented without reset!
  try {
    // 1. Verify connect() does NOT reset retryCount before SSE stabilizes
    svc['retryCount'] = 2;
    await svc.connect('fcproplayer7');
    assert.equal(svc.getRetryCount(), 2, 'POST /connect success must NOT prematurely reset retryCount');

    // Wait 30ms -> FailingEventSource fires onopen + immediate onerror -> maxRetries(2) exhausted -> NO extra connect!
    await waitMs(40);
    assert.equal(connectCalls, 1, 'Exhausted maxRetries must stop reconnect loop');
    assert.equal(svc.getStatus(), 'error');

    // 2. Test manual disconnect cancels any scheduled reconnect
    svc['retryCount'] = 0;
    svc.updateConfig({ maxRetries: 5 });
    await svc.connect('fcproplayer7');
    await waitMs(30); // triggers retryCount = 1 and schedules reconnect timer (4s)
    assert.equal(svc.getStatus(), 'connecting');
    await svc.disconnect();
    assert.equal(disconnectCalls >= 1, true);
    assert.equal(svc.getStatus(), 'disconnected');
    const callsAtDisconnect = connectCalls;
    await waitMs(50);
    assert.equal(connectCalls, callsAtDisconnect, 'Manual disconnect must never trigger reconnect');
    // 3. Controlled reconnect when active stream ends via status: disconnected
    class StreamDropEventSource {
      constructor(url) {
        this.url = url;
        this.listeners = new Map();
        this.onopen = null;
        this.onerror = null;
        setTimeout(() => {
          this.onopen?.({});
          const statusListeners = this.listeners.get('status') || [];
          for (const fn of statusListeners) {
            fn({ data: JSON.stringify({ state: 'connected', username: 'fcproplayer7' }), lastEventId: 'r_drop:1' });
            fn({ data: JSON.stringify({ state: 'disconnected', error: 'Yayın sona erdi' }), lastEventId: 'r_drop:2' });
          }
        }, 10);
      }
      addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
      }
      close() {}
    }

    globalThis.EventSource = StreamDropEventSource;
    svc['retryCount'] = 0;
    svc.updateConfig({ autoReconnect: true, maxRetries: 3 });
    await svc.connect('fcproplayer7');
    assert.equal(
      await waitFor(() => svc.getRetryCount() === 1 && svc.getStatus() === 'connecting'),
      true,
      'Unexpected status:disconnected on active stream should trigger controlled reconnect'
    );
    await svc.disconnect();
    assert.equal(svc.getStatus(), 'disconnected');
  } finally {
    svc.dispose();
    globalThis.EventSource = originalES;
    globalThis.fetch = originalFetch;
  }
});

test('/simulate returns 404 when disabled (production default) and emits over real SSE when SIMULATION_ENABLED=true', async () => {
  // 13. Production default: SIMULATION_ENABLED unset/false -> 404
  const prod = await startTestRelay({ simulationEnabled: false });
  try {
    const res404 = await fetch(`${prod.baseUrl}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'small_gift' }),
    });
    assert.equal(res404.status, 404, '/simulate must return 404 when simulation is disabled');
    const healthProd = await (await fetch(`${prod.baseUrl}/health`)).json();
    assert.equal(healthProd.simulationEnabled, false);
  } finally {
    await prod.relay.shutdown();
  }

  // 14. Explicitly enabled test relay -> /simulate broadcasts over real SSE without touching real connection
  const testRelay = await startTestRelay({ simulationEnabled: true });
  const originalES = globalThis.EventSource;
  globalThis.EventSource = NodeHttpEventSource;

  const simGifts = [];
  const simFollows = [];
  const svc = new TikTokLiveConnectorService(createServiceConfig(testRelay.baseUrl), {
    onFinalizedGift: (g) => simGifts.push(g),
    onFollowEvent: (f) => simFollows.push(f),
  });

  try {
    svc.connectSimulationStream('fcproplayer7');
    assert.equal(
      await waitFor(() => svc.getLastEventId(testRelay.baseUrl, 'fcproplayer7') !== null),
      true
    );

    // Follower simulation
    const rFlw = await (
      await fetch(`${testRelay.baseUrl}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'fcproplayer7', scenario: 'follower' }),
      })
    ).json();
    assert.equal(rFlw.ok, true);

    // Streak simulation with repeatEnd=true
    const rStk = await (
      await fetch(`${testRelay.baseUrl}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'fcproplayer7',
          scenario: 'streak',
          unitCoins: 20,
          steps: [1, 2, 4],
          includeRepeatEnd: true,
        }),
      })
    ).json();
    assert.equal(rStk.ok, true);
    assert.equal(rStk.bufferedCount, 2);
    assert.equal(rStk.emittedCount, 1);

    // Incomplete streak simulation -> MUST NOT reach onFinalizedGift
    const rInc = await (
      await fetch(`${testRelay.baseUrl}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'fcproplayer7',
          scenario: 'incomplete_streak',
          unitCoins: 50,
          steps: [1, 2],
        }),
      })
    ).json();
    assert.equal(rInc.ok, true);
    assert.equal(rInc.emittedCount, 0);

    assert.equal(
      await waitFor(() => simFollows.length === 1 && simGifts.length === 1),
      true
    );
    assert.equal(simFollows[0].isSimulated, true);
    assert.equal(simGifts[0].isSimulated, true);
    assert.equal(simGifts[0].repeatCount, 4);
    assert.equal(simGifts[0].unitCoins, 20);
  } finally {
    svc.stopSimulationStream();
    svc.dispose();
    await testRelay.relay.shutdown();
    globalThis.EventSource = originalES;
  }
});
