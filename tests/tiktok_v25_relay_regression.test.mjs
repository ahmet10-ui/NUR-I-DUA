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
  const signSrc = fs.readFileSync(path.resolve('relay-server/signingProvider.mjs'), 'utf8');
  assert.ok(srvSrc.includes('SIGN_API_KEY'));
  assert.ok(signSrc.includes('SIGN_SERVER_URL'));
  assert.ok(signSrc.includes('fetchWebcastSignatureFromProvider'));
  assert.ok(signSrc.includes('fetchSignedWebSocketFromProvider'));
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

    nextErr = "The requested user isn't online :(";
    const r2 = await fetch(`${baseUrl}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fcproplayer7' }),
    });
    const j2 = await r2.json();
    assert.equal(j2.ok, false);
    assert.equal(j2.state, 'disconnected');
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

test('TikTok v2.5.0 5: Both RouteConfig signing routes enforce strict contracts, reject empty/JSON-stub payloads, and never leak secrets or Euler Business calls', async () => {
  const http = await import('node:http');
  const tlc = await import('../relay-server/node_modules/tiktok-live-connector/dist/index.js');
  const protoV3 = await import('../relay-server/node_modules/tiktok-live-proto/dist/node/v3.js');
  const {
    configureTikTokConnectorRoutes,
    resolveSignerConfiguration,
    requestCustomSignedWebSocket,
    requestCustomWebcastSignature,
  } = await import('../relay-server/signingProvider.mjs');

  const validFetchProtoBytes = Buffer.from(
    protoV3.ProtoMessageFetchResult.encode({
      messages: [],
      cursor: '1795347720694_1_1_1_test',
      fetchInterval: '1000',
      now: '1795347720694',
      internalExt: 'internal_test_ext',
      fetchType: 1,
      routeParams: { route_key: 'val' },
      heartbeatDuration: '10000',
      needAck: true,
      pushServer: 'wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/',
      isFirst: true,
    }).finish()
  );

  let signerMode = 'valid_binary';
  let observedAuthHeader = '';
  const signerServer = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    observedAuthHeader = String(req.headers.authorization || '');

    if (reqUrl.pathname === '/ws-sign') {
      if (signerMode === 'valid_binary') {
        res.writeHead(200, {
          'Content-Type': 'application/x-protobuf',
          'x-set-tt-cookie': 'ttwid=1%7Ctest_cookie_value; msToken=test_ms',
          'x-room-id': '7710947598055672598',
        });
        res.end(validFetchProtoBytes);
        return;
      }
      if (signerMode === 'valid_json_b64') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            signedWebSocketBase64: validFetchProtoBytes.toString('base64'),
            cookieHeader: 'ttwid=json_cookie_val',
            roomId: '7710947598055672598',
          })
        );
        return;
      }
      if (signerMode === 'empty_200') {
        res.writeHead(200, { 'Content-Type': 'application/x-protobuf' });
        res.end('');
        return;
      }
      if (signerMode === 'raw_json_as_protobuf') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(JSON.stringify({ fake: true }));
        return;
      }
      if (signerMode === 'missing_cookies') {
        res.writeHead(200, { 'Content-Type': 'application/x-protobuf' });
        res.end(validFetchProtoBytes);
        return;
      }
    }

    if (reqUrl.pathname === '/http-sign') {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        const parsed = body ? JSON.parse(body) : {};
        if (signerMode === 'http_empty') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{}');
          return;
        }
        if (signerMode === 'http_missing_tokens') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ signedUrl: parsed.url }));
          return;
        }
        const signed = new URL(parsed.url);
        signed.searchParams.set('X-Bogus', 'DFSzswVL_test_bogus');
        signed.searchParams.set('msToken', 'ms_test_token_value');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: 200,
            message: 'ok',
            response: {
              signedUrl: signed.toString(),
              userAgent: 'TestSignerAgent/1.0',
              tokens: {
                'X-Bogus': 'DFSzswVL_test_bogus',
                msToken: 'ms_test_token_value',
              },
              requestHeaders: { 'x-signed-by': 'custom-local' },
            },
          })
        );
      });
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise((resolve) => signerServer.listen(0, '127.0.0.1', resolve));
  const signerAddr = signerServer.address();
  const wsSignUrl = `http://127.0.0.1:${signerAddr.port}/ws-sign`;
  const httpSignUrl = `http://127.0.0.1:${signerAddr.port}/http-sign`;

  try {
    // 1. Default mode blocks Euler Business endpoint & avoids Euler fallback when custom configured
    const defaultCfg = configureTikTokConnectorRoutes(tlc, {});
    assert.equal(defaultCfg.signerMode, 'euler_free_ws_direct_gifts');
    assert.equal(defaultCfg.eulerBusinessEndpointBlocked, true);
    await assert.rejects(
      () =>
        tlc.RouteConfig.fetchWebcastSignatureFromProvider({
          url: 'https://webcast.tiktok.com/webcast/gift/list/?aid=1988',
          method: 'GET',
          userAgent: 'UA',
        }),
      /EulerStream Business|HTTP_SIGN_SERVER_URL/i
    );

    // 2. Full custom WS + HTTP signing mode overrides BOTH routes cleanly
    const customEnv = {
      WS_SIGN_SERVER_URL: wsSignUrl,
      HTTP_SIGN_SERVER_URL: httpSignUrl,
      SIGN_SERVER_TOKEN: 'secret_signer_token_should_not_leak',
      SIGN_API_KEY: 'secret_api_key_should_not_leak',
    };
    const customCfg = configureTikTokConnectorRoutes(tlc, customEnv);
    assert.equal(customCfg.signerMode, 'custom_full');
    assert.equal(customCfg.eulerFallbackDisabled, true);
    assert.equal(tlc.RoomIdRouteConfig.skipFetchRoomIdFromEulerRoute, true);
    assert.equal(tlc.IsLiveRouteConfig.skipFetchRoomIdFromEulerRoute, true);

    // 2a. Custom WS route: binary protobuf
    signerMode = 'valid_binary';
    const wsBinary = await tlc.RouteConfig.fetchSignedWebSocketFromProvider({
      roomId: '7710947598055672598',
      cursor: '',
      useMobile: false,
    });
    assert.equal(wsBinary.fetchResult.cursor, '1795347720694_1_1_1_test');
    assert.match(wsBinary.fetchResult.pushServer, /^wss:\/\//);
    assert.match(wsBinary.fetchResultCookieHeader, /ttwid=/);
    assert.equal(wsBinary.fetchResultRoomId, '7710947598055672598');
    assert.equal(observedAuthHeader, 'Bearer secret_signer_token_should_not_leak');

    // 2b. Custom WS route: JSON base64
    signerMode = 'valid_json_b64';
    const wsJson = await tlc.RouteConfig.fetchSignedWebSocketFromProvider({
      roomId: '7710947598055672598',
      cursor: '',
      useMobile: false,
    });
    assert.equal(wsJson.fetchResult.cursor, '1795347720694_1_1_1_test');
    assert.equal(wsJson.fetchResultCookieHeader, 'ttwid=json_cookie_val');

    // 2c. Strict rejections: HTTP 200 empty payload, JSON masquerading as protobuf, missing cookies
    signerMode = 'empty_200';
    await assert.rejects(
      () =>
        requestCustomSignedWebSocket({
          wsSignUrl,
          deserializeMessage: tlc.deserializeMessage,
          roomId: '7710947598055672598',
        }),
      /Empty Payload|boş yanıt/i
    );

    signerMode = 'raw_json_as_protobuf';
    await assert.rejects(
      () =>
        requestCustomSignedWebSocket({
          wsSignUrl,
          deserializeMessage: tlc.deserializeMessage,
          roomId: '7710947598055672598',
        }),
      /Empty Payload|JSON|base64/i
    );

    signerMode = 'missing_cookies';
    await assert.rejects(
      () =>
        requestCustomSignedWebSocket({
          wsSignUrl,
          deserializeMessage: tlc.deserializeMessage,
          roomId: '7710947598055672598',
        }),
      /Empty Cookies|çerezi/i
    );

    // 2d. Custom HTTP signature route: valid SignTikTokUrlResponse vs empty/missing tokens
    signerMode = 'valid_http';
    const sigOk = await tlc.RouteConfig.fetchWebcastSignatureFromProvider({
      url: 'https://webcast.tiktok.com/webcast/gift/list/?aid=1988&X-Bogus=stale',
      method: 'GET',
      userAgent: 'OrigUA',
    });
    assert.equal(sigOk.code, 200);
    assert.match(sigOk.response.signedUrl, /X-Bogus=DFSzswVL_test_bogus/);
    assert.doesNotMatch(sigOk.response.signedUrl, /X-Bogus=stale/);
    assert.equal(sigOk.response.tokens['X-Bogus'], 'DFSzswVL_test_bogus');
    assert.equal(sigOk.response.userAgent, 'TestSignerAgent/1.0');

    signerMode = 'http_empty';
    await assert.rejects(
      () =>
        requestCustomWebcastSignature({
          httpSignUrl,
          url: 'https://webcast.tiktok.com/webcast/gift/list/?aid=1988',
        }),
      /Empty Payload|eksik/i
    );

    signerMode = 'http_missing_tokens';
    await assert.rejects(
      () =>
        requestCustomWebcastSignature({
          httpSignUrl,
          url: 'https://webcast.tiktok.com/webcast/gift/list/?aid=1988',
        }),
      /Empty Payload|imza token/i
    );

    // 3. Relay /health & /status expose non-secret diagnostics only (NEVER URLs or tokens)
    const relay = createRelayServer({
      simulationEnabled: false,
      env: customEnv,
    });
    await new Promise((resolve) => relay.server.listen(0, '127.0.0.1', resolve));
    const relayAddr = relay.server.address();
    const relayBase = `http://127.0.0.1:${relayAddr.port}`;
    try {
      const hRes = await fetch(`${relayBase}/health`);
      const hRaw = await hRes.text();
      const hJson = JSON.parse(hRaw);
      assert.equal(hJson.signerMode, 'custom_full');
      assert.equal(hJson.hasCustomWsSigner, true);
      assert.equal(hJson.hasCustomHttpSigner, true);
      assert.equal(hJson.eulerFallbackDisabled, true);
      assert.equal(hJson.eulerBusinessEndpointBlocked, true);
      assert.doesNotMatch(hRaw, /secret_signer_token_should_not_leak|secret_api_key_should_not_leak|ws-sign|http-sign/);

      const sRes = await fetch(`${relayBase}/status?username=fcproplayer7`);
      const sRaw = await sRes.text();
      const sJson = JSON.parse(sRaw);
      assert.equal(sJson.signerMode, 'custom_full');
      assert.doesNotMatch(sRaw, /secret_signer_token_should_not_leak|secret_api_key_should_not_leak/);
    } finally {
      await relay.shutdown();
    }

    // 4. URL validation rejects embedded credentials & non-HTTP schemes
    assert.throws(() => resolveSignerConfiguration({ SIGN_SERVER_URL: 'https://user:pass@signer.example.com' }));
    assert.throws(() => resolveSignerConfiguration({ HTTP_SIGN_SERVER_URL: 'file:///etc/passwd' }));
  } finally {
    // Restore default clean RouteConfig
    configureTikTokConnectorRoutes(tlc, {});
    await new Promise((resolve) => signerServer.close(() => resolve()));
  }
});

