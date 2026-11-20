import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyFollowInteraction,
  classifyGiftInteraction,
  resolveTierRules,
} from '../src/services/interactionClassifier.ts';
import { TikTokLiveConnectorService } from '../src/services/tiktokLiveConnectorService.ts';
import { sanitizePrayerTemplate } from '../src/utils/sanitize.ts';
import { DEFAULT_TIER_RULES } from '../src/data/defaults.ts';

function createBaseTikTokConfig() {
  return {
    username: 'fcproplayer7',
    connectionState: 'disconnected',
    connectorEndpoint: 'https://relay.example.com',
    autoReconnect: false,
    maxRetries: 0,
    retryDelaySec: 5,
    duplicateWindowSec: 8,
    lastError: null,
    lastCheckedAt: null,
    roomId: null,
    viewerCount: null,
  };
}

test('Stage 1 boundaries: 1, 49, 50, 149, 150, 299, 300, 600, 1000', () => {
  const cases = [
    { coins: 1, expectedTier: 'small_gift', requiresPrayer: false },
    { coins: 49, expectedTier: 'small_gift', requiresPrayer: false },
    { coins: 50, expectedTier: 'mid_gift', requiresPrayer: true },
    { coins: 149, expectedTier: 'mid_gift', requiresPrayer: true },
    { coins: 150, expectedTier: 'high_gift', requiresPrayer: true },
    { coins: 299, expectedTier: 'high_gift', requiresPrayer: true },
    { coins: 300, expectedTier: 'yasin_300', requiresPrayer: true },
    { coins: 600, expectedTier: 'yasin_300', requiresPrayer: true },
    { coins: 1000, expectedTier: 'yasin_300', requiresPrayer: true },
  ];

  for (const c of cases) {
    const res = classifyGiftInteraction({
      username: 'ahmet_yilmaz',
      unitCoins: c.coins,
      repeatCount: 1,
      giftType: 0,
    });
    assert.equal(res.shouldEnqueue, true, `coins=${c.coins} should enqueue`);
    assert.equal(res.tier, c.expectedTier, `coins=${c.coins} tier mismatch`);
    assert.equal(res.eventCount, 1, `coins=${c.coins} must emit 1 event`);
    assert.equal(res.requiresPrayer, c.requiresPrayer, `coins=${c.coins} requiresPrayer mismatch`);
    assert.equal(res.eventCoins, c.coins);
  }
});

test('1 x 300 and 300 x 1 each produce exactly 1 yasin_300 event', () => {
  const single300 = classifyGiftInteraction({
    username: 'fatma_nur',
    unitCoins: 300,
    repeatCount: 1,
    giftType: 0,
  });
  assert.equal(single300.shouldEnqueue, true);
  assert.equal(single300.tier, 'yasin_300');
  assert.equal(single300.eventCount, 1);
  assert.equal(single300.eventCoins, 300);

  const streak300x1 = classifyGiftInteraction({
    username: 'mehmet_can',
    unitCoins: 1,
    repeatCount: 300,
    giftType: 1,
    repeatEnd: true,
  });
  assert.equal(streak300x1.shouldEnqueue, true);
  assert.equal(streak300x1.tier, 'yasin_300');
  assert.equal(streak300x1.eventCount, 1);
  assert.equal(streak300x1.eventCoins, 300);
});

test('600 x 1 and 1000 x 1 single gift streaks still produce only 1 yasin_300 event', () => {
  const gift600 = classifyGiftInteraction({
    username: 'zeynep_kaya',
    unitCoins: 600,
    repeatCount: 1,
    giftType: 0,
  });
  assert.equal(gift600.shouldEnqueue, true);
  assert.equal(gift600.tier, 'yasin_300');
  assert.equal(gift600.eventCount, 1);

  const gift600Streak = classifyGiftInteraction({
    username: 'zeynep_kaya',
    unitCoins: 300,
    repeatCount: 2,
    giftType: 1,
    repeatEnd: true,
  });
  assert.equal(gift600Streak.shouldEnqueue, true);
  assert.equal(gift600Streak.tier, 'yasin_300');
  assert.equal(gift600Streak.eventCount, 1);

  const gift1000 = classifyGiftInteraction({
    username: 'ibrahim_oz',
    unitCoins: 1000,
    repeatCount: 1,
    giftType: 0,
  });
  assert.equal(gift1000.shouldEnqueue, true);
  assert.equal(gift1000.tier, 'yasin_300');
  assert.equal(gift1000.eventCount, 1);
});

test('Separate small gifts never accumulate to trigger Yasin', () => {
  const smallGifts = [49, 49, 49, 49, 49, 49, 49]; // sum = 343 across separate events
  for (const coins of smallGifts) {
    const res = classifyGiftInteraction({
      username: 'same_user',
      unitCoins: coins,
      repeatCount: 1,
      giftType: 0,
    });
    assert.equal(res.tier, 'small_gift');
    assert.notEqual(res.tier, 'yasin_300');
  }
});

test('Incomplete gift streak (giftType=1, repeatEnd=false) is never classified or finalized early', () => {
  const direct = classifyGiftInteraction({
    username: 'ali_veli',
    unitCoins: 300,
    repeatCount: 1,
    giftType: 1,
    repeatEnd: false,
  });
  assert.equal(direct.shouldEnqueue, false);
  assert.equal(direct.reason, 'streak_incomplete');
  assert.equal(direct.eventCount, 0);

  const finalizedGifts = [];
  const service = new TikTokLiveConnectorService(createBaseTikTokConfig(), {
    onFinalizedGift: (gift) => finalizedGifts.push(gift),
  });

  const step1 = service.ingestRawGiftEvent({
    eventId: 'evt_1',
    streakKey: 'u1:rose:g1',
    userId: '1001',
    username: 'ali_veli',
    giftId: '5655',
    giftName: 'Rose',
    unitCoins: 1,
    repeatCount: 120,
    giftType: 1,
    repeatEnd: false,
  });
  assert.equal(step1.accepted, true);
  assert.equal(step1.buffered, true);
  assert.equal(finalizedGifts.length, 0, 'Incomplete streak must not emit finalized gift');

  const step2 = service.ingestRawGiftEvent({
    eventId: 'evt_2',
    streakKey: 'u1:rose:g1',
    userId: '1001',
    username: 'ali_veli',
    giftId: '5655',
    giftName: 'Rose',
    unitCoins: 1,
    repeatCount: 300,
    giftType: 1,
    repeatEnd: true,
  });
  assert.equal(step2.accepted, true);
  assert.equal(step2.buffered, false);
  assert.equal(finalizedGifts.length, 1);
  assert.equal(finalizedGifts[0].unitCoins, 1);
  assert.equal(finalizedGifts[0].repeatCount, 300);

  const classified = classifyGiftInteraction(finalizedGifts[0]);
  assert.equal(classified.tier, 'yasin_300');
  assert.equal(classified.eventCount, 1);

  service.dispose();
});

test('Two separate completed 300-coin gift events produce two separate events', () => {
  const finalizedGifts = [];
  const service = new TikTokLiveConnectorService(createBaseTikTokConfig(), {
    onFinalizedGift: (gift) => finalizedGifts.push(gift),
  });

  service.ingestRawGiftEvent({
    eventId: 'evt_a',
    streakKey: 'u1:yasin_gift:grpA',
    userId: '1001',
    username: 'ayse_demir',
    giftId: '9001',
    giftName: 'Kalp',
    unitCoins: 300,
    repeatCount: 1,
    giftType: 1,
    repeatEnd: true,
  });

  service.ingestRawGiftEvent({
    eventId: 'evt_b',
    streakKey: 'u1:yasin_gift:grpB',
    userId: '1001',
    username: 'ayse_demir',
    giftId: '9001',
    giftName: 'Kalp',
    unitCoins: 300,
    repeatCount: 1,
    giftType: 1,
    repeatEnd: true,
  });

  assert.equal(finalizedGifts.length, 2);
  const c1 = classifyGiftInteraction(finalizedGifts[0]);
  const c2 = classifyGiftInteraction(finalizedGifts[1]);
  assert.equal(c1.tier, 'yasin_300');
  assert.equal(c2.tier, 'yasin_300');
  assert.equal(c1.eventCount, 1);
  assert.equal(c2.eventCount, 1);

  service.dispose();
});

test('Missing, zero, negative, or non-finite coin values never produce Yasin', () => {
  const invalidPayloads = [
    { username: 'u1' },
    { username: 'u2', unitCoins: 0, repeatCount: 5 },
    { username: 'u3', unitCoins: -300, repeatCount: 1 },
    { username: 'u4', unitCoins: Number.NaN, repeatCount: 1 },
    { username: 'u5', unitCoins: Number.POSITIVE_INFINITY, repeatCount: 1 },
    { username: 'u6', unitCoins: 300, repeatCount: 0 },
    { username: 'u7', unitCoins: 300, repeatCount: -1 },
  ];

  for (const payload of invalidPayloads) {
    const res = classifyGiftInteraction(payload);
    assert.equal(res.shouldEnqueue, false, `Invalid payload should be rejected: ${JSON.stringify(payload)}`);
    assert.notEqual(res.tier, 'yasin_300');
    assert.equal(res.eventCount, 0);
  }
});

test('Admin-configurable thresholds override defaults cleanly', () => {
  const rules = resolveTierRules({
    ...DEFAULT_TIER_RULES,
    midGiftMinCoins: 40,
    highGiftMinCoins: 200,
    yasinMinCoins: 500,
  });

  assert.equal(classifyGiftInteraction({ unitCoins: 300, repeatCount: 1 }, rules).tier, 'high_gift');
  assert.equal(classifyGiftInteraction({ unitCoins: 500, repeatCount: 1 }, rules).tier, 'yasin_300');
  assert.equal(classifyGiftInteraction({ unitCoins: 45, repeatCount: 1 }, rules).tier, 'mid_gift');
});

test('sanitizePrayerTemplate supports long prayers (>800 chars) and preserves Arabic harekeler', () => {
  const arabicWithHarekeler =
    'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ';
  const longText = `${arabicWithHarekeler} `.repeat(25); // > 2000 chars
  assert.ok(longText.length > 2000);

  const sanitized = sanitizePrayerTemplate(`<b>${longText}</b>`);
  assert.ok(sanitized.length > 1800, 'Should not truncate at 800 characters');
  assert.ok(!sanitized.includes('<b>'));
  assert.ok(sanitized.includes('رَبَّنَا'), 'Must preserve Arabic fatha & shadda harekeler');
  assert.ok(sanitized.includes('الدُّنْيَا'), 'Must preserve damma & sukun harekeler');
});

test('Follow events reach application via SSE listener simulation and filter duplicate follows', async () => {
  const receivedFollows = [];
  const listeners = new Map();

  class MockEventSource {
    constructor(url) {
      this.url = url;
    }
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    }
    close() {}
  }

  const originalEventSource = globalThis.EventSource;
  const originalFetch = globalThis.fetch;
  globalThis.EventSource = MockEventSource;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, state: 'connected', roomId: 'room_123', viewerCount: 42 }),
  });

  const service = new TikTokLiveConnectorService(createBaseTikTokConfig(), {
    onFollowEvent: (follow) => receivedFollows.push(follow),
  });

  try {
    const conn = await service.connect('fcproplayer7');
    assert.equal(conn.ok, true);

    const followHandlers = listeners.get('follow') || [];
    assert.equal(followHandlers.length, 1, 'TikTokLiveConnectorService must register SSE follow listener');

    // Emit follow SSE event
    followHandlers[0]({
      data: JSON.stringify({
        eventId: 'msg_f1',
        dedupeKey: 'uid:555',
        userId: '555',
        uniqueId: 'hasan_can',
        username: 'hasan_can',
        rawEventType: 'follow',
        timestamp: new Date().toISOString(),
      }),
    });

    // Emit duplicate follow event from same user
    followHandlers[0]({
      data: JSON.stringify({
        eventId: 'msg_f2',
        dedupeKey: 'uid:555',
        userId: '555',
        username: 'hasan_can',
        rawEventType: 'social',
        timestamp: new Date().toISOString(),
      }),
    });

    assert.equal(receivedFollows.length, 1, 'Duplicate follow from same user must be filtered');
    assert.equal(receivedFollows[0].username, 'hasan_can');
    assert.equal(receivedFollows[0].userId, '555');

    const followClass = classifyFollowInteraction(receivedFollows[0]);
    assert.equal(followClass.shouldEnqueue, true);
    assert.equal(followClass.tier, 'follower');
    assert.ok(followClass.renderedGreeting.includes('Hasan Can'));
  } finally {
    service.dispose();
    globalThis.EventSource = originalEventSource;
    globalThis.fetch = originalFetch;
  }
});
