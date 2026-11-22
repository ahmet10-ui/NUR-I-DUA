import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { createRelayServer } from '../relay-server/server.mjs';
import { TikTokLiveConnectorService } from '../src/services/tiktokLiveConnectorService.ts';
import { createDefaultAppState } from '../src/data/defaults.ts';

function buildBaseConfig(connectorEndpoint = '') {
  return {
    username: 'fcproplayer7',
    connectionState: connectorEndpoint ? 'disconnected' : 'unconfigured',
    connectorEndpoint,
    autoReconnect: false,
    maxRetries: 1,
    retryDelaySec: 2,
    duplicateWindowSec: 8,
    lastError: null,
    lastCheckedAt: null,
  };
}

test('TikTok v2.5.0 1: relay-server/package.json enforces tiktok-live-connector 2.5.0 and Node >=20', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve('relay-server/package.json'), 'utf8'));
  assert.equal(pkg.dependencies['tiktok-live-connector'], '2.5.0');
  assert.equal(pkg.engines.node, '>=20.0.0');

  const srvSrc = fs.readFileSync(path.resolve('relay-server/server.mjs'), 'utf8');
  assert.ok(srvSrc.includes('SIGN_API_KEY'));
  assert.ok(srvSrc.includes('SIGN_SERVER_URL'));
  assert.ok(srvSrc.includes("'/status'"));
  assert.ok(srvSrc.includes("'/reconnect'"));
});

test('TikTok v2.5.0 2: Relay extracts v2.5.0 protobuf user/gift/transactionId/roomUser/follow & supports /health, /status, /reconnect', async () => {
  let activeMockConn = null;
  const relay = createRelayServer({
    simulationEnabled: false,
    connectionFactory: async () => {
      const conn = new EventEmitter();
      conn.connect = async () => ({
        roomId: 'room_250_live',
        roomInfo: { data: { user_count: 42 } },
      });
      conn.disconnect = async () => {};
      activeMockConn = conn;
      return conn;
    },
  });

  await new Promise((resolve) => relay.server.listen(0, '127.0.0.1', resolve));
  const addr = relay.server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. GET /health
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.connectorVersion, '2.5.0');
    assert.equal(healthJson.simulationEnabled, false);
    assert.ok(healthJson.endpoints.includes('GET /status'));
    assert.ok(healthJson.endpoints.includes('POST /reconnect'));

    // 2. Client checkHealth()
    const svc = new TikTokLiveConnectorService(buildBaseConfig(baseUrl));
    const clientHealth = await svc.checkHealth();
    assert.equal(clientHealth.ok, true);
    assert.equal(clientHealth.connectorVersion, '2.5.0');

    // 3. POST /connect
    const connRes = await fetch(`${baseUrl}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fcproplayer7' }),
    });
    assert.equal(connRes.status, 200);
    const connJson = await connRes.json();
    assert.equal(connJson.ok, true);
    assert.equal(connJson.roomId, 'room_250_live');
    assert.ok(activeMockConn);

    // 4. Emit v2.5.0 roomUser, follow, and gift (with transactionId & gift.type=1 repeatEnd=1)
    activeMockConn.emit('roomUser', { viewerCount: 55 });
    activeMockConn.emit('follow', {
      user: { id: 'u99', displayId: 'ahmet.k', nickname: 'Ahmet K.' },
      common: { msgId: 'flw_msg_99' },
    });
    activeMockConn.emit('gift', {
      user: { id: 'u77', displayId: 'mehmet.y', nickname: 'Mehmet Y.' },
      giftDetails: { id: 5655, giftName: 'Rose', giftType: 1, diamondCount: 1 },
      repeatCount: 5,
      repeatEnd: 1,
      groupId: 'grp_77_5655',
      transactionId: 'tx_998877',
    });

    // Wait a tick for async broadcast
    await new Promise((r) => setTimeout(r, 25));

    // 5. GET /status reflects roomUser, followerCount, and lastEvent
    const statusRes = await fetch(`${baseUrl}/status?username=fcproplayer7`);
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.ok, true);
    assert.equal(statusJson.state, 'connected');
    assert.equal(statusJson.viewerCount, 55);
    assert.equal(statusJson.followerCount, 1);
    assert.equal(statusJson.lastEvent.kind, 'gift');
    assert.equal(statusJson.lastEvent.coins, 5);

    // 6. POST /reconnect resets cleanly and connects again
    const reconnRes = await fetch(`${baseUrl}/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fcproplayer7' }),
    });
    assert.equal(reconnRes.status, 200);
    const reconnJson = await reconnRes.json();
    assert.equal(reconnJson.ok, true);
    assert.equal(reconnJson.state, 'connected');
  } finally {
    await relay.shutdown();
  }
});

test('TikTok v2.5.0 3: Error classification distinguishes EulerStream business plan vs stream offline cleanly', async () => {
  let nextErr = 'EulerStream Business Plan or SIGN_API_KEY required (403 Forbidden)';
  const relay = createRelayServer({
    simulationEnabled: false,
    connectionFactory: async () => {
      const conn = new EventEmitter();
      conn.connect = async () => {
        throw new Error(nextErr);
      };
      conn.disconnect = async () => {};
      return conn;
    },
  });

  await new Promise((resolve) => relay.server.listen(0, '127.0.0.1', resolve));
  const addr = relay.server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const r1 = await fetch(`${baseUrl}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fcproplayer7' }),
    });
    const j1 = await r1.json();
    assert.equal(j1.ok, false);
    assert.equal(j1.lastErrorCategory, 'euler_business_plan_required');
    assert.match(j1.error, /SIGN_API_KEY|EulerStream/i);

    nextErr = 'User is offline or live ended';
    const r2 = await fetch(`${baseUrl}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fcproplayer7' }),
    });
    const j2 = await r2.json();
    assert.equal(j2.ok, false);
    assert.equal(j2.lastErrorCategory, 'stream_offline');
  } finally {
    await relay.shutdown();
  }
});

test('TikTok v2.5.0 4: Client TikTokLiveConnectorService deduplicates by transactionId, parses v2.5.0 shapes, and preserves zero-credential isolation', () => {
  const gifts = [];
  const follows = [];
  const svc = new TikTokLiveConnectorService(buildBaseConfig(''), {
    onFinalizedGift: (g) => gifts.push(g),
    onFollowEvent: (f) => follows.push(f),
  });

  // Incomplete streak ignored until repeatEnd === true
  const inc = svc.ingestRawGiftEvent({
    user: { id: 'u1', displayId: 'ali_bey', nickname: 'Ali' },
    gift: { id: 101, name: 'Gül', type: 1, diamondCount: 10 },
    repeatCount: 2,
    repeatEnd: false,
    groupId: 'g1',
  });
  assert.equal(inc.accepted, true);
  assert.equal(inc.buffered, true);
  assert.equal(gifts.length, 0);

  // Completed streak finalized once
  const done1 = svc.ingestRawGiftEvent({
    user: { id: 'u1', displayId: 'ali_bey', nickname: 'Ali' },
    gift: { id: 101, name: 'Gül', type: 1, diamondCount: 10 },
    repeatCount: 3,
    repeatEnd: true,
    groupId: 'g1',
    transactionId: 'tx_dup_check_1',
  });
  assert.equal(done1.accepted, true);
  assert.equal(done1.buffered, false);
  assert.equal(gifts.length, 1);
  assert.equal(gifts[0].quantity, 3);
  assert.equal(gifts[0].unitCoins, 10);

  // Duplicate transactionId with different eventId is still blocked
  const dupTx = svc.ingestRawGiftEvent({
    eventId: 'different_event_id',
    user: { id: 'u1', displayId: 'ali_bey', nickname: 'Ali' },
    gift: { id: 101, name: 'Gül', type: 0, diamondCount: 10 },
    repeatCount: 3,
    repeatEnd: true,
    transactionId: 'tx_dup_check_1',
  });
  assert.equal(dupTx.accepted, false);
  assert.equal(gifts.length, 1);

  // Follow dedupe across SSE retry
  const flw1 = svc.ingestRawFollowEvent({
    user: { id: 'f1', displayId: 'ayse.hanim', nickname: 'Ayşe' },
    msgId: 'msg_flw_1',
  });
  const flw2 = svc.ingestRawFollowEvent({
    user: { id: 'f1', displayId: 'ayse.hanim', nickname: 'Ayşe' },
    msgId: 'msg_flw_2',
  });
  assert.equal(flw1.accepted, true);
  assert.equal(flw2.accepted, false);
  assert.equal(follows.length, 1);

  const defaults = createDefaultAppState();
  assert.equal(defaults.stats.realFollowers, 0);
  assert.equal(defaults.stats.simulatedFollowers, 0);
  assert.equal(defaults.tiktok.username, 'fcproplayer7');
});
