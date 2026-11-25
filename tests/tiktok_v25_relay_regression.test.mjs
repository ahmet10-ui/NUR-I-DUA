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

test('TikTok v2.5.0 6: TIKTOK_SIGNER_PROVIDER=tiktok_signer supports nglmercer/tiktok-signer tokens, 405->GET fallback, im/fetch WS route, and blocks Euler fallback', async () => {
  const http = await import('node:http');
  const tlc = await import('../relay-server/node_modules/tiktok-live-connector/dist/index.js');
  const protoV3 = await import('../relay-server/node_modules/tiktok-live-proto/dist/node/v3.js');
  const { configureTikTokConnectorRoutes, resolveSignerConfiguration } = await import(
    '../relay-server/signingProvider.mjs'
  );

  const imFetchBytes = Buffer.from(
    protoV3.ProtoMessageFetchResult.encode({
      messages: [],
      cursor: 'im_fetch_cursor_99',
      fetchInterval: '1000',
      now: '1795347720999',
      internalExt: 'ext',
      fetchType: 1,
      heartbeatDuration: '10000',
      needAck: true,
      pushServer: 'wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/',
      routeParams: { route_key: 'val' },
      isFirst: true,
    }).finish()
  );

  const methodsSeen = [];
  const signerServer = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    if (reqUrl.pathname === '/sign') {
      methodsSeen.push(req.method);
      if (req.method === 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }
      // GET /sign?url=... returning nglmercer/tiktok-signer token-only JSON
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          'X-Bogus': 'DFSzsw_nglmercer_bogus',
          'X-Gnarly': 'gnarly_tok_123',
          msToken: 'ms_tok_xyz',
          navigator: { user_agent: 'NglmercerUA/2.0' },
        })
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => signerServer.listen(0, '127.0.0.1', resolve));
  const addr = signerServer.address();

  try {
    // 1. Validate provider modes
    const noneCfg = resolveSignerConfiguration({ TIKTOK_SIGNER_PROVIDER: 'none' });
    assert.equal(noneCfg.activeSignerProvider, 'none');
    assert.equal(noneCfg.eulerFallbackDisabled, true);

    assert.throws(() => resolveSignerConfiguration({ TIKTOK_SIGNER_PROVIDER: 'invalid_mode' }));

    // 2. Configure tiktok_signer using base SIGN_SERVER_URL -> resolves to /sign
    const tsCfg = configureTikTokConnectorRoutes(tlc, {
      TIKTOK_SIGNER_PROVIDER: 'tiktok_signer',
      SIGN_SERVER_URL: `http://127.0.0.1:${addr.port}`,
    });
    assert.equal(tsCfg.activeSignerProvider, 'tiktok_signer');
    assert.equal(tsCfg.eulerFallbackDisabled, true);
    assert.equal(tsCfg.httpSignUrl, `http://127.0.0.1:${addr.port}/sign`);
    assert.equal(tlc.RoomIdRouteConfig.skipFetchRoomIdFromEulerRoute, true);

    // 3. POST returns 405 -> auto retries with GET and rebuilds signedUrl from token-only JSON
    const sigRes = await tlc.RouteConfig.fetchWebcastSignatureFromProvider({
      url: 'https://webcast.tiktok.com/webcast/im/fetch/?aid=1988',
      method: 'GET',
      userAgent: 'InitialUA',
    });
    assert.deepEqual(methodsSeen, ['POST', 'GET']);
    assert.match(sigRes.response.signedUrl, /X-Bogus=DFSzsw_nglmercer_bogus/);
    assert.match(sigRes.response.signedUrl, /X-Gnarly=gnarly_tok_123/);
    assert.match(sigRes.response.signedUrl, /msToken=ms_tok_xyz/);
    assert.equal(sigRes.response.userAgent, 'NglmercerUA/2.0');

    // 4. WebSocket handshake uses direct HTTP-signed webcast/im/fetch/ instead of Euler
    let capturedRequestArgs = null;
    const mockWebClient = {
      clientParams: { aid: '1988' },
      clientHeaders: { 'User-Agent': 'InitialUA' },
      cookieJar: {
        getCookieString: async () => 'ttwid=1%7Cmimic_cookie',
      },
      request: async (args) => {
        capturedRequestArgs = args;
        return {
          body: imFetchBytes,
          headers: { 'set-cookie': ['ttwid=1%7Cmimic_cookie'] },
        };
      },
    };
    const wsRes = await tlc.RouteConfig.fetchSignedWebSocketFromProvider({
      roomId: '7710999',
      cursor: '',
      webClient: mockWebClient,
    });
    assert.equal(capturedRequestArgs.path, 'webcast/im/fetch/');
    assert.equal(capturedRequestArgs.signRequest, true);
    assert.equal(wsRes.fetchResult.cursor, 'im_fetch_cursor_99');
    assert.match(wsRes.fetchResultCookieHeader, /ttwid=/);
  } finally {
    configureTikTokConnectorRoutes(tlc, {});
    await new Promise((resolve) => signerServer.close(() => resolve()));
  }
});

test('TikTok v2.5.0 7: Relay enforces per-handle connect mutex, non-bypassable 429 Retry-After cooldown, listener cleanup, and client jitter backoff', async () => {
  let factoryCalls = 0;
  let disconnectCalls = 0;
  let removedListenersCount = 0;
  let mode = 'slow_rate_limit';
  const createdEmitters = [];

  const relay = createRelayServer({
    simulationEnabled: false,
    connectionFactory: async () => {
      factoryCalls += 1;
      const emitter = new EventEmitter();
      const origRemoveAll = emitter.removeAllListeners.bind(emitter);
      emitter.removeAllListeners = () => {
        removedListenersCount += 1;
        return origRemoveAll();
      };
      emitter.disconnect = async () => {
        disconnectCalls += 1;
      };
      emitter.connect = async () => {
        await new Promise((r) => setTimeout(r, 35));
        if (mode === 'slow_rate_limit') {
          const err = new Error('[Rate Limited] (rate_limit_account_day) Too many connections started, try again later.');
          err.name = 'SignatureRateLimitError';
          err.retryAfter = 1;
          throw err;
        }
        return {
          roomId: 'room_recovered_777',
          roomInfo: { user_count: 19 },
        };
      };
      createdEmitters.push(emitter);
      return emitter;
    },
  });

  await new Promise((resolve) => relay.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${relay.server.address().port}`;

  try {
    // 1. Two concurrent POST /connect calls share ONE handshake via per-handle mutex
    const [rA, rB] = await Promise.all([
      fetch(`${baseUrl}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'fcproplayer7' }),
      }),
      fetch(`${baseUrl}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'fcproplayer7' }),
      }),
    ]);
    assert.equal(factoryCalls, 1, 'Concurrent /connect requests must share a single handshake');
    assert.equal(rA.status, 429);
    assert.equal(rB.status, 429);
    assert.equal(rA.headers.get('retry-after'), '1');
    const bodyA = await rA.json();
    assert.equal(bodyA.lastErrorCategory, 'rate_limited');
    assert.equal(bodyA.retryAfterSec, 1);
    assert.ok(removedListenersCount >= 1 && disconnectCalls >= 1, 'Failed connection must clean listeners & disconnect');

    // 2. Neither POST /connect (even force:true) nor POST /reconnect may bypass active upstream cooldown
    mode = 'healthy';
    const rCooldownConnect = await fetch(`${baseUrl}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fcproplayer7', force: true }),
    });
    assert.equal(rCooldownConnect.status, 429);
    assert.equal(factoryCalls, 1, 'force:true must NOT bypass upstream 429 cooldown');

    const rCooldownReconnect = await fetch(`${baseUrl}/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fcproplayer7' }),
    });
    assert.equal(rCooldownReconnect.status, 429);
    assert.equal(factoryCalls, 1, 'POST /reconnect must NOT bypass active upstream 429 cooldown');

    // 3. Once the upstream Retry-After window expires naturally, POST /reconnect succeeds
    await new Promise((r) => setTimeout(r, 1100));
    const rReconnect = await fetch(`${baseUrl}/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fcproplayer7' }),
    });
    assert.equal(rReconnect.status, 200);
    const bodyReconn = await rReconnect.json();
    assert.equal(bodyReconn.ok, true);
    assert.equal(bodyReconn.roomId, 'room_recovered_777');
    assert.equal(factoryCalls, 2);

    // Stale emitter #0 events must be completely ignored
    const prevGifts = createdEmitters[0].listenerCount('gift');
    assert.equal(prevGifts, 0);

    // 4. Client TikTokLiveConnectorService honors rate_limited retryAfterSec & jitter
    const svc = new TikTokLiveConnectorService(
      {
        ...buildBaseConfig(baseUrl),
        autoReconnect: true,
        maxRetries: 3,
        retryDelaySec: 5,
      },
      {},
      { maxBackoffMs: 60_000, rng: () => 0.5 }
    );
    // rng=0.5 => jitter factor = 1.0
    const delayNormal = svc.computeReconnectDelayMs(2, 'connection_error', null);
    assert.equal(delayNormal, 10_000);
    const delayRateLimited = svc.computeReconnectDelayMs(1, 'rate_limited', 45);
    assert.equal(delayRateLimited, 45_000);

    const svcMinJitter = new TikTokLiveConnectorService(
      { ...buildBaseConfig(baseUrl), retryDelaySec: 10 },
      {},
      { maxBackoffMs: 60_000, rng: () => 0 }
    );
    assert.equal(svcMinJitter.computeReconnectDelayMs(1, 'connection_error', null), 8_000);
  } finally {
    await relay.shutdown();
  }
});

test('TikTok v2.5.0 8: Relay & Client verify comment (chat), follow, gift, and viewer (roomUser) events distinctly', async () => {
  const emitter = new EventEmitter();
  emitter.disconnect = async () => {};
  emitter.connect = async () => ({
    roomId: 'room_events_888',
    roomInfo: { user_count: 14 },
  });

  const relay = createRelayServer({
    simulationEnabled: false,
    connectionFactory: async () => emitter,
  });

  await new Promise((resolve) => relay.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${relay.server.address().port}`;
  const seenStatuses = [];
  const seenGifts = [];
  const seenFollows = [];
  const seenChats = [];

  const svc = new TikTokLiveConnectorService(buildBaseConfig(baseUrl), {
    onStatusChange: (s) => seenStatuses.push(s),
    onFinalizedGift: (g) => seenGifts.push(g),
    onFollowEvent: (f) => seenFollows.push(f),
    onChatEvent: (c) => seenChats.push(c),
  });

  const origEventSource = globalThis.EventSource;
  globalThis.EventSource = class extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.controller = new AbortController();
      void (async () => {
        const res = await fetch(url, { signal: this.controller.signal });
        this.onopen?.({});
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let id = '';
            let evName = 'message';
            const dataLines = [];
            for (const line of block.split('\n')) {
              if (line.startsWith('id:')) id = line.slice(3).trim();
              else if (line.startsWith('event:')) evName = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            if (dataLines.length > 0) {
              const ev = new MessageEvent(evName, { data: dataLines.join('\n'), lastEventId: id });
              this.dispatchEvent(ev);
            }
          }
        }
      })().catch(() => {});
    }
    close() {
      this.controller.abort();
    }
  };

  try {
    const res = await svc.connect('fcproplayer7');
    assert.equal(res.ok, true);
    await new Promise((r) => setTimeout(r, 40));

    // Emit 4 distinct TikTok live event kinds: roomUser, chat, follow, gift
    emitter.emit('roomUser', { total: 42 });
    emitter.emit('chat', {
      user: { idStr: 'u_chat_1', displayId: 'ahmet_yorum', nickname: 'Ahmet' },
      comment: 'Hayırlı yayınlar hocam',
      msgId: 'msg_chat_1',
    });
    emitter.emit('follow', {
      user: { idStr: 'u_flw_1', displayId: 'fatma_takip', nickname: 'Fatma' },
      msgId: 'msg_flw_1',
    });
    emitter.emit('gift', {
      user: { idStr: 'u_gft_1', displayId: 'mehmet_hediye', nickname: 'Mehmet' },
      giftId: 5655,
      giftName: 'Rose',
      giftType: 0,
      repeatCount: 2,
      repeatEnd: true,
      transactionId: 'tx_ev_1',
      extendedGiftInfo: { diamond_count: 15 },
    });

    await new Promise((r) => setTimeout(r, 80));

    assert.ok(seenStatuses.some((s) => s.viewerCount === 42), 'roomUser viewerCount update must reach client');
    assert.equal(seenChats.length, 1);
    assert.equal(seenChats[0].username, 'ahmet_yorum');
    assert.equal(seenChats[0].comment, 'Hayırlı yayınlar hocam');
    assert.equal(seenFollows.length, 1);
    assert.equal(seenFollows[0].username, 'fatma_takip');
    assert.equal(seenGifts.length, 1);
    assert.equal(seenGifts[0].username, 'mehmet_hediye');
    assert.equal(seenGifts[0].unitCoins, 15);
    assert.equal(seenGifts[0].quantity, 2);

    // Confirm duplicate chat msgId is ignored
    emitter.emit('chat', {
      user: { idStr: 'u_chat_1', displayId: 'ahmet_yorum' },
      comment: 'Hayırlı yayınlar hocam',
      msgId: 'msg_chat_1',
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(seenChats.length, 1);
  } finally {
    globalThis.EventSource = origEventSource;
    await svc.disconnect();
    await relay.shutdown();
  }
});

