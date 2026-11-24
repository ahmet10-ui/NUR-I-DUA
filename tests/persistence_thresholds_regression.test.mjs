import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';

import { createRelayServer } from '../relay-server/server.mjs';
import {
  DEFAULT_HIGH_TIER_DUAS,
  DEFAULT_MID_OPENING_PRAYERS,
  DEFAULT_PRAYERS,
  DEFAULT_TIER_RULES,
  DEFAULT_YASIN_RECITATION,
  LEGACY_DEFAULT_TIER_THRESHOLDS,
} from '../src/data/defaults.ts';
import {
  classifyGiftInteraction,
  resolveTierRules,
} from '../src/services/interactionClassifier.ts';
import {
  buildTopTierBarItems,
  formatBroadcastPrayerNotification,
  TOP_TIER_BAR_GRID_COLUMNS,
  TOP_TIER_BAR_ITEMS,
} from '../src/services/broadcastDisplay.ts';
import { SharedTikTokConnectionManager } from '../src/services/tiktokLiveConnectorService.ts';
import { buildHighTierTurkishSpeech, pickNonConsecutiveMidPrayer } from '../src/services/stage2Flow.ts';

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
    for (const fn of this.listeners.get(type) || []) {
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

async function waitFor(predicate, timeoutMs = 2500, stepMs = 15) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

test('Boundary matrix (1, 10, 11, 35, 36, 60, 61, 199, 200) maps accurately while preserving existing prayer pools verbatim', () => {
  const expected = [
    { coins: 1, tier: 'small_gift', requiresPrayer: false, priority: 'normal' },
    { coins: 10, tier: 'small_gift', requiresPrayer: false, priority: 'normal' },
    { coins: 11, tier: 'mid_gift', requiresPrayer: true, priority: 'normal' },
    { coins: 35, tier: 'mid_gift', requiresPrayer: true, priority: 'normal' },
    { coins: 36, tier: 'high_gift', requiresPrayer: true, priority: 'high' },
    { coins: 60, tier: 'high_gift', requiresPrayer: true, priority: 'high' },
    { coins: 61, tier: 'high_gift', requiresPrayer: true, priority: 'high' },
    { coins: 199, tier: 'high_gift', requiresPrayer: true, priority: 'high' },
    { coins: 200, tier: 'yasin_300', requiresPrayer: true, priority: 'urgent' },
  ];

  assert.deepEqual(
    {
      smallMin: DEFAULT_TIER_RULES.smallGiftMinCoins,
      smallMax: DEFAULT_TIER_RULES.smallGiftMaxCoins,
      midMin: DEFAULT_TIER_RULES.midGiftMinCoins,
      midMax: DEFAULT_TIER_RULES.midGiftMaxCoins,
      highMin: DEFAULT_TIER_RULES.highGiftMinCoins,
      highMax: DEFAULT_TIER_RULES.highGiftMaxCoins,
      yasinMin: DEFAULT_TIER_RULES.yasinMinCoins,
    },
    {
      smallMin: 1,
      smallMax: 10,
      midMin: 11,
      midMax: 35,
      highMin: 36,
      highMax: 199,
      yasinMin: 200,
    }
  );

  for (const row of expected) {
    const res = classifyGiftInteraction({
      username: 'sinir_test_user',
      unitCoins: row.coins,
      repeatCount: 1,
      giftType: 0,
    });
    assert.equal(res.shouldEnqueue, true, `coins=${row.coins} should enqueue`);
    assert.equal(res.tier, row.tier, `coins=${row.coins} tier mismatch`);
    assert.equal(res.requiresPrayer, row.requiresPrayer, `coins=${row.coins} requiresPrayer mismatch`);
    assert.equal(res.priority, row.priority, `coins=${row.coins} priority mismatch`);
    assert.equal(res.eventCount, 1);

    if (row.tier === 'small_gift') {
      assert.ok(res.renderedGreeting?.includes('Sinir Test'));
    } else if (row.tier === 'mid_gift') {
      const picked = pickNonConsecutiveMidPrayer(DEFAULT_MID_OPENING_PRAYERS, null);
      assert.ok(picked && picked.category === 'mid_opening');
    } else if (row.tier === 'high_gift') {
      const turkish = buildHighTierTurkishSpeech(DEFAULT_HIGH_TIER_DUAS[0], 'sinir_test');
      assert.ok(turkish.includes('Sinir Test'));
    }
  }

  // Verify existing prayer pools remain strictly unchanged (count, categories, Yâsîn config)
  assert.equal(DEFAULT_MID_OPENING_PRAYERS.length, 5);
  assert.equal(DEFAULT_PRAYERS.length, 13);
  assert.equal(DEFAULT_HIGH_TIER_DUAS.length, 2);
  assert.equal(DEFAULT_YASIN_RECITATION.audioStatus, 'verified_ready');
  assert.equal(
    DEFAULT_YASIN_RECITATION.audioSha256,
    '3cd37c1e1ec60be3b46802ed8aef4c042cd5aa85373e20f2936813161d2bb7b9'
  );
});

test('Broadcast header preserves 4-box layout with JETON labels, dynamic tier rules, and zero notification regressions', () => {
  assert.equal(TOP_TIER_BAR_ITEMS.length, 4);
  assert.equal(TOP_TIER_BAR_GRID_COLUMNS, '0.85fr 1fr 1.15fr 1.05fr');
  assert.deepEqual(
    TOP_TIER_BAR_ITEMS.map((i) => ({ range: i.range, unitLabel: i.unitLabel, label: i.label })),
    [
      { range: '1–10', unitLabel: 'JETON', label: 'Selamlama' },
      { range: '11–35', unitLabel: 'JETON', label: 'Açılış duası' },
      { range: '36–199', unitLabel: 'JETON', label: 'Kapsamlı dua' },
      { range: '200+', unitLabel: 'JETON', label: 'Yâsîn-i Şerîf' },
    ]
  );

  const customItems = buildTopTierBarItems({
    ...DEFAULT_TIER_RULES,
    smallGiftMinCoins: 1,
    midGiftMinCoins: 20,
    highGiftMinCoins: 80,
    yasinMinCoins: 250,
  });
  assert.equal(customItems.length, 4);
  assert.deepEqual(
    customItems.map((i) => ({ range: i.range, unitLabel: i.unitLabel })),
    [
      { range: '1–19', unitLabel: 'JETON' },
      { range: '20–79', unitLabel: 'JETON' },
      { range: '80–249', unitLabel: 'JETON' },
      { range: '250+', unitLabel: 'JETON' },
    ]
  );

  // Confirm small_gift (1-10) shows no bottom prayer card while mid/high/yasin do
  assert.equal(
    formatBroadcastPrayerNotification(
      { tier: 'small_gift', eventType: 'gift', username: 'ali' },
      true
    ),
    null
  );
  assert.equal(
    formatBroadcastPrayerNotification(
      { tier: 'yasin_300', eventType: 'gift', username: 'ali' },
      true
    ),
    'Yâsîn-i Şerîf okunuyor'
  );
});

test('SharedTikTokConnectionManager keeps connection alive across TikTokPage -> BroadcastView -> TikTokPage transitions without duplicate connects', async () => {
  const webcasts = [];
  let disconnectCalls = 0;

  const relay = createRelayServer({
    connectionFactory: async () => {
      const emitter = new EventEmitter();
      emitter.connect = async () => ({
        roomId: 'room_persist_999',
        roomInfo: { user_count: 88 },
      });
      emitter.disconnect = () => {
        disconnectCalls += 1;
      };
      webcasts.push(emitter);
      return emitter;
    },
  });
  await new Promise((r) => relay.server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${relay.server.address().port}`;

  const originalES = globalThis.EventSource;
  globalThis.EventSource = NodeHttpEventSource;

  const manager = new SharedTikTokConnectionManager(
    {
      username: 'fcproplayer7',
      connectorEndpoint: baseUrl,
      autoReconnect: false,
    },
    { streakTimeoutMs: 100 }
  );

  const pageAEvents = [];
  const pageACallbacks = {
    onStatusChange: (s) => pageAEvents.push({ type: 'status', state: s.state, roomId: s.roomId }),
    onFinalizedGift: (g) => pageAEvents.push({ type: 'gift', g }),
    onFollowEvent: (f) => pageAEvents.push({ type: 'follow', f }),
  };

  const broadcastEvents = [];
  const broadcastCallbacks = {
    onStatusChange: (s) => broadcastEvents.push({ type: 'status', state: s.state, roomId: s.roomId }),
    onFinalizedGift: (g) => broadcastEvents.push({ type: 'gift', g }),
    onFollowEvent: (f) => broadcastEvents.push({ type: 'follow', f }),
  };

  try {
    // 1. Connect on TikTokPage
    manager.attachCallbacks(pageACallbacks);
    const conn1 = await manager.connect('fcproplayer7');
    assert.equal(conn1.ok, true);
    assert.equal(webcasts.length, 1);
    assert.equal(manager.hasActiveLiveSession(), true);
    assert.equal(await waitFor(() => manager.getStatus() === 'connected'), true);

    // 2. User leaves TikTokPage & opens BroadcastView (StrictMode double-detach / attach safe)
    manager.detachCallbacks(pageACallbacks);

    // Emit a follow right during view swap gap -> must be buffered and flushed cleanly to next attached view
    webcasts[0].emit('social', {
      userId: '501',
      uniqueId: 'gecis_takipci',
      action: 1,
      displayType: 'pm_mt_msg_viewer_followed',
      msgId: 'flw_gap_1',
    });

    await new Promise((r) => setTimeout(r, 80));
    assert.equal(disconnectCalls, 0, 'Unmounting TikTokPage must NEVER disconnect TikTok WebCast');
    assert.equal(manager.hasActiveLiveSession(), true);

    // Attach BroadcastView / Studio consumer callbacks
    manager.attachCallbacks(broadcastCallbacks);
    assert.equal(
      await waitFor(() => broadcastEvents.some((e) => e.type === 'follow' && e.f.username === 'gecis_takipci')),
      true,
      'Follow event emitted during view switch must reach BroadcastView queue'
    );

    // 3. Emit live gift while BroadcastView is active -> must reach BroadcastView
    webcasts[0].emit('gift', {
      userId: '502',
      uniqueId: 'yayin_hediyeci',
      giftId: '5660',
      giftName: 'Kalp',
      giftType: 0,
      repeatCount: 1,
      msgId: 'gft_live_25',
      extendedGiftInfo: { diamond_count: 25 },
    });
    assert.equal(
      await waitFor(() => broadcastEvents.some((e) => e.type === 'gift' && e.g.username === 'yayin_hediyeci')),
      true,
      'Live gift must be delivered while BroadcastView is active'
    );

    // 4. User returns to TikTokPage and triggers repeated connect attempt (idempotent guard)
    manager.detachCallbacks(broadcastCallbacks);
    manager.attachCallbacks(pageACallbacks);
    const conn2 = await manager.connect('fcproplayer7');
    assert.equal(conn2.ok, true);
    assert.equal(webcasts.length, 1, 'Returning to TikTokPage MUST NOT open a second TikTok LIVE connection');
    assert.equal(disconnectCalls, 0);

    const latestStatus = manager.getLatestStatus();
    assert.equal(latestStatus.state, 'connected');
    assert.equal(latestStatus.roomId, 'room_persist_999');
    assert.equal(latestStatus.lastEvent?.kind, 'gift');
    assert.equal(latestStatus.lastEvent?.username, 'yayin_hediyeci');

    // 5. Repeat switch to BroadcastView & send 200-coin Yâsîn gift -> still same single connection
    manager.detachCallbacks(pageACallbacks);
    manager.attachCallbacks(broadcastCallbacks);
    webcasts[0].emit('gift', {
      userId: '503',
      uniqueId: 'yasin_hediyeci',
      giftId: '6001',
      giftName: 'Nurlu Taç',
      giftType: 0,
      repeatCount: 1,
      msgId: 'gft_live_200',
      extendedGiftInfo: { diamond_count: 200 },
    });
    assert.equal(
      await waitFor(() => broadcastEvents.some((e) => e.type === 'gift' && e.g.username === 'yasin_hediyeci')),
      true
    );
    assert.equal(webcasts.length, 1);

    // 6. Explicit manual disconnect closes the shared live session cleanly
    await manager.disconnect();
    assert.equal(manager.getStatus(), 'disconnected');
    assert.equal(manager.hasActiveLiveSession(), false);
    assert.equal(disconnectCalls, 1, 'Explicit disconnect must close the underlying WebCast session');
  } finally {
    await manager.disconnect();
    await relay.shutdown();
    globalThis.EventSource = originalES;
  }
});

test('App.tsx keeps a single StudioProvider across authenticated views & StudioContext migrates legacy defaults without side-effect disconnect', () => {
  const appSrc = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  const ctxSrc = fs.readFileSync(path.resolve('src/context/StudioContext.tsx'), 'utf8');

  // Verify App renders a single StudioProvider wrapping authenticated standaloneBroadcast & AdminShell
  assert.ok(appSrc.includes('standaloneBroadcast && (!isAuthenticated || obsClean)'));
  assert.ok(appSrc.includes('section={adminSection}'));
  assert.equal(ctxSrc.includes('connector.dispose()'), false, 'StudioContext unmount MUST NOT call connector.dispose()');
  assert.ok(ctxSrc.includes('sharedTikTokConnectionManager.detachCallbacks'));

  // Verify legacy threshold constants match 49/50/150/300 and resolveTierRules leaves custom overrides intact
  assert.equal(LEGACY_DEFAULT_TIER_THRESHOLDS.smallGiftMaxCoins, 49);
  assert.equal(LEGACY_DEFAULT_TIER_THRESHOLDS.midGiftMinCoins, 50);
  assert.equal(LEGACY_DEFAULT_TIER_THRESHOLDS.highGiftMinCoins, 150);
  assert.equal(LEGACY_DEFAULT_TIER_THRESHOLDS.yasinMinCoins, 300);

  const customPreserved = resolveTierRules({
    smallGiftMinCoins: 1,
    midGiftMinCoins: 20,
    highGiftMinCoins: 70,
    yasinMinCoins: 250,
  });
  assert.equal(customPreserved.midGiftMinCoins, 20);
  assert.equal(customPreserved.highGiftMinCoins, 70);
  assert.equal(customPreserved.yasinMinCoins, 250);
});

test('Centralized thresholds (1, 10, 11, 35, 36, 199, 200) leave zero 36–60 · 61–199 splits and normalize synced tierRules', () => {
  const broadcastDisplaySrc = fs.readFileSync(path.resolve('src/services/broadcastDisplay.ts'), 'utf8');
  const ctxSrc = fs.readFileSync(path.resolve('src/context/StudioContext.tsx'), 'utf8');

  assert.equal(broadcastDisplaySrc.includes('36–60'), false);
  assert.equal(broadcastDisplaySrc.includes('61–199'), false);
  assert.ok(ctxSrc.includes('resolveTierRules(migrateLegacyTierRules(res.appState?.tierRules))'));
  assert.ok(ctxSrc.includes('resolveTierRules(migrateLegacyTierRules(incoming?.tierRules))'));

  const boundaryChecks = [
    [1, 'small_gift'],
    [10, 'small_gift'],
    [11, 'mid_gift'],
    [35, 'mid_gift'],
    [36, 'high_gift'],
    [199, 'high_gift'],
    [200, 'yasin_300'],
  ];
  for (const [coins, expectedTier] of boundaryChecks) {
    const result = classifyGiftInteraction({ username: 'deneme_user', unitCoins: coins, repeatCount: 1 });
    assert.equal(result.shouldEnqueue, true);
    assert.equal(result.tier, expectedTier, `coins=${coins} must map to ${expectedTier}`);
  }
});

