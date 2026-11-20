import http from 'node:http';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';
import { WebcastPushConnection } from 'tiktok-live-connector';

const __filename = fileURLToPath(import.meta.url);
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_USERNAME = sanitizeHandle(process.env.TIKTOK_USERNAME || 'fcproplayer7') || 'fcproplayer7';

/**
 * Active sessions keyed by lowercase public TikTok handle (no passwords or cookies).
 */
const sessions = new Map();

function sanitizeHandle(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9._]/g, '')
    .slice(0, 40)
    .toLowerCase();
}

function sanitizeDisplayText(raw, fallback) {
  const cleaned = String(raw || '')
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Cache-Control, X-Requested-With'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function toPositiveFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function getOrCreateSession(username) {
  const handle = sanitizeHandle(username) || DEFAULT_USERNAME;
  let session = sessions.get(handle);
  if (!session) {
    session = {
      username: handle,
      state: 'disconnected',
      roomId: null,
      viewerCount: null,
      lastError: null,
      connection: null,
      clients: new Set(),
      pendingStreaks: new Map(),
      activeStreakKeys: new Map(),
      seenFollowKeys: new Map(),
      seenFollowMsgIds: new Map(),
    };
    sessions.set(handle, session);
  }
  return session;
}

function pruneTimestampMap(map, maxSize, maxAgeMs) {
  if (map.size <= maxSize) return;
  const cutoff = Date.now() - maxAgeMs;
  for (const [key, ts] of map.entries()) {
    if (ts < cutoff) {
      map.delete(key);
    }
  }
  // If still oversized, evict oldest entries
  while (map.size > maxSize) {
    const firstKey = map.keys().next().value;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
}

function broadcastSse(session, eventName, payload) {
  const dataLine = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of session.clients) {
    try {
      res.write(dataLine);
    } catch {
      session.clients.delete(res);
    }
  }
}

function broadcastStatus(session) {
  broadcastSse(session, 'status', {
    state: session.state,
    username: session.username,
    roomId: session.roomId,
    viewerCount: session.viewerCount,
    error: session.lastError,
    updatedAt: new Date().toISOString(),
  });
}

function finalizeRelayGift(session, payload) {
  broadcastSse(session, 'gift', payload);
}

function handleRawTikTokGift(session, data) {
  const rawUserId = data?.userId ?? data?.user?.userId;
  const userId =
    rawUserId !== undefined && rawUserId !== null && String(rawUserId).trim()
      ? sanitizeDisplayText(String(rawUserId), '')
      : undefined;
  const username = sanitizeDisplayText(
    data?.uniqueId || data?.user?.uniqueId || data?.nickname || data?.user?.nickname,
    'tiktok_izleyici'
  );
  const nickname = sanitizeDisplayText(
    data?.nickname || data?.user?.nickname || data?.uniqueId || data?.user?.uniqueId,
    username
  );
  const giftId = String(data?.giftId ?? data?.gift?.gift_id ?? 'unknown');
  const giftName = sanitizeDisplayText(
    data?.giftName || data?.extendedGiftInfo?.name || data?.gift?.name,
    `Gift #${giftId}`
  );
  const repeatCount = Math.max(1, Math.min(999, Math.floor(Number(data?.repeatCount) || 1)));
  const giftType = typeof data?.giftType === 'number' ? data.giftType : undefined;
  const repeatEnd = typeof data?.repeatEnd === 'boolean' ? data.repeatEnd : undefined;
  const isStreakable = giftType === 1;

  // Prioritize extendedGiftInfo.diamond_count (unit catalog cost), then fall back safely
  const extendedDiamondCount = toPositiveFiniteNumber(
    data?.extendedGiftInfo?.diamond_count ?? data?.extendedGiftInfo?.diamondCount
  );
  const giftDiamondCount = toPositiveFiniteNumber(
    data?.gift?.diamond_count ?? data?.gift?.diamondCount
  );
  const rawDiamondCount = toPositiveFiniteNumber(data?.diamondCount);

  let unitCoins = 0;
  let unitCoinsSource = 'none';
  if (extendedDiamondCount > 0) {
    unitCoins = extendedDiamondCount;
    unitCoinsSource = 'extendedGiftInfo.diamond_count';
  } else if (giftDiamondCount > 0) {
    unitCoins = giftDiamondCount;
    unitCoinsSource = 'gift.diamond_count';
  } else if (rawDiamondCount > 0) {
    unitCoins = rawDiamondCount;
    unitCoinsSource = 'diamondCount';
  }

  // Map ongoing streak bursts for (user + giftId) to a single deterministic streakKey
  const userBucket = userId ? `uid_${userId}` : username.toLowerCase();
  const comboBucket = `${userBucket}:${giftId}`;
  let streakKey = data?.groupId
    ? `${comboBucket}:${data.groupId}`
    : session.activeStreakKeys.get(comboBucket);
  if (!streakKey) {
    streakKey = `${comboBucket}:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    if (isStreakable && repeatEnd === false) {
      session.activeStreakKeys.set(comboBucket, streakKey);
    }
  }

  const payload = {
    eventId: String(data?.msgId || `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
    streakKey,
    userId,
    username,
    nickname,
    giftId,
    giftName,
    quantity: repeatCount,
    unitCoins: unitCoins > 0 ? unitCoins : undefined,
    unitCoinsSource,
    diamondCount: unitCoins > 0 ? unitCoins : typeof data?.diamondCount === 'number' ? data.diamondCount : undefined,
    giftType,
    repeatCount,
    repeatEnd,
    rawMeta: {
      hasExtendedGiftInfo: Boolean(data?.extendedGiftInfo),
      extendedDiamondCount: extendedDiamondCount || undefined,
      giftDiamondCount: giftDiamondCount || undefined,
      rawDiamondCount: typeof data?.diamondCount === 'number' ? data.diamondCount : undefined,
      groupId: data?.groupId ? String(data.groupId) : undefined,
      msgId: data?.msgId ? String(data.msgId) : undefined,
    },
    timestamp: new Date().toISOString(),
  };

  if (isStreakable && repeatEnd === false) {
    const existing = session.pendingStreaks.get(streakKey);
    if (existing) clearTimeout(existing.timer);

    const bestQty = existing ? Math.max(existing.payload.quantity, payload.quantity) : payload.quantity;
    const bestUnitCoins =
      payload.unitCoins && payload.unitCoins > 0
        ? payload.unitCoins
        : existing?.payload?.unitCoins;
    const bestUnitSource =
      payload.unitCoins && payload.unitCoins > 0
        ? payload.unitCoinsSource
        : existing?.payload?.unitCoinsSource || 'none';

    const updatedPayload = {
      ...payload,
      quantity: bestQty,
      repeatCount: bestQty,
      unitCoins: bestUnitCoins,
      unitCoinsSource: bestUnitSource,
      diamondCount: bestUnitCoins ?? payload.diamondCount,
    };

    const timer = setTimeout(() => {
      const pending = session.pendingStreaks.get(streakKey);
      if (!pending) return;
      session.pendingStreaks.delete(streakKey);
      session.activeStreakKeys.delete(comboBucket);
      finalizeRelayGift(session, { ...pending.payload, repeatEnd: true });
    }, 4500);

    session.pendingStreaks.set(streakKey, { payload: updatedPayload, timer });
    return;
  }

  // Streak finished (`repeatEnd === true`) or single non-streakable gift
  session.activeStreakKeys.delete(comboBucket);
  const existing = session.pendingStreaks.get(streakKey);
  if (existing) {
    clearTimeout(existing.timer);
    session.pendingStreaks.delete(streakKey);
    const finalQty = Math.max(existing.payload.quantity, payload.quantity);
    const finalUnitCoins =
      payload.unitCoins && payload.unitCoins > 0
        ? payload.unitCoins
        : existing.payload.unitCoins;
    const finalUnitSource =
      payload.unitCoins && payload.unitCoins > 0
        ? payload.unitCoinsSource
        : existing.payload.unitCoinsSource || 'none';
    finalizeRelayGift(session, {
      ...payload,
      quantity: finalQty,
      repeatCount: finalQty,
      unitCoins: finalUnitCoins,
      unitCoinsSource: finalUnitSource,
      diamondCount: finalUnitCoins ?? payload.diamondCount,
      repeatEnd: true,
    });
    return;
  }

  finalizeRelayGift(session, payload);
}

function isSocialFollowEvent(data) {
  const displayType = String(
    data?.displayType || data?.common?.displayText?.key || ''
  ).toLowerCase();
  const label = String(data?.label || '').toLowerCase();
  const action = Number(data?.action);

  if (displayType.includes('follow') || label.includes('follow')) {
    return true;
  }
  // Do not classify explicit share/like/join displayTypes as follow
  if (displayType) {
    return false;
  }
  return action === 1;
}

function handleRawTikTokFollow(session, data, rawEventType) {
  const rawUserId = data?.userId ?? data?.user?.userId;
  const userId =
    rawUserId !== undefined && rawUserId !== null && String(rawUserId).trim()
      ? sanitizeDisplayText(String(rawUserId), '')
      : undefined;
  const username = sanitizeDisplayText(
    data?.uniqueId || data?.user?.uniqueId || data?.nickname || data?.user?.nickname,
    ''
  );
  if (!userId && !username) {
    return;
  }

  const effectiveUsername = username || `kullanici_${userId}`;
  const nickname = sanitizeDisplayText(
    data?.nickname || data?.user?.nickname || data?.uniqueId || data?.user?.uniqueId,
    effectiveUsername
  );
  const msgId = data?.msgId ?? data?.common?.msgId;
  const cleanMsgId = msgId ? sanitizeDisplayText(String(msgId), '') : undefined;

  const nowMs = Date.now();
  if (cleanMsgId && session.seenFollowMsgIds.has(cleanMsgId)) {
    return;
  }

  const dedupeKey = userId ? `uid:${userId}` : `uname:${effectiveUsername.toLowerCase()}`;
  if (session.seenFollowKeys.has(dedupeKey)) {
    return;
  }

  session.seenFollowKeys.set(dedupeKey, nowMs);
  pruneTimestampMap(session.seenFollowKeys, 5000, 24 * 60 * 60 * 1000);
  if (cleanMsgId) {
    session.seenFollowMsgIds.set(cleanMsgId, nowMs);
    pruneTimestampMap(session.seenFollowMsgIds, 5000, 60 * 60 * 1000);
  }

  const payload = {
    eventId: cleanMsgId || `flw_${nowMs}_${Math.random().toString(36).slice(2, 7)}`,
    dedupeKey,
    userId,
    username: effectiveUsername,
    nickname,
    rawEventType,
    displayType: data?.displayType ? sanitizeDisplayText(String(data.displayType), '') : undefined,
    msgId: cleanMsgId,
    timestamp: new Date().toISOString(),
  };

  broadcastSse(session, 'follow', payload);
}

async function disconnectSession(session) {
  for (const entry of session.pendingStreaks.values()) {
    clearTimeout(entry.timer);
    finalizeRelayGift(session, { ...entry.payload, repeatEnd: true });
  }
  session.pendingStreaks.clear();
  session.activeStreakKeys.clear();
  session.seenFollowKeys.clear();
  session.seenFollowMsgIds.clear();

  if (session.connection) {
    try {
      session.connection.disconnect();
    } catch {
      // ignore close errors
    }
    session.connection = null;
  }

  session.state = 'disconnected';
  session.roomId = null;
  session.viewerCount = null;
  session.lastError = null;
  broadcastStatus(session);
}

async function connectSession(username) {
  const session = getOrCreateSession(username);

  if (session.connection && session.state === 'connected') {
    return {
      ok: true,
      state: 'connected',
      username: session.username,
      roomId: session.roomId,
      viewerCount: session.viewerCount,
    };
  }

  await disconnectSession(session);

  session.state = 'connecting';
  session.lastError = null;
  broadcastStatus(session);

  const connection = new WebcastPushConnection(session.username, {
    processInitialData: false,
    enableExtendedGiftInfo: true,
  });
  session.connection = connection;

  connection.on('gift', (data) => {
    handleRawTikTokGift(session, data);
  });

  connection.on('follow', (data) => {
    handleRawTikTokFollow(session, data, 'follow');
  });

  connection.on('social', (data) => {
    if (isSocialFollowEvent(data)) {
      handleRawTikTokFollow(session, data, 'social');
    }
  });

  connection.on('roomUser', (data) => {
    if (typeof data?.viewerCount === 'number') {
      session.viewerCount = data.viewerCount;
      broadcastStatus(session);
    }
  });

  connection.on('streamEnd', () => {
    session.state = 'disconnected';
    session.lastError = `TikTok canlı yayını sona erdi (@${session.username}).`;
    session.roomId = null;
    session.viewerCount = null;
    session.connection = null;
    broadcastStatus(session);
  });

  connection.on('disconnected', () => {
    if (session.state === 'connected') {
      session.state = 'disconnected';
      session.lastError = 'TikTok WebCast akışı kesildi.';
      session.roomId = null;
      session.viewerCount = null;
      session.connection = null;
      broadcastStatus(session);
    }
  });

  connection.on('error', (err) => {
    session.lastError = err?.message || 'TikTok WebCast hata bildirdi.';
    broadcastStatus(session);
  });

  try {
    const roomState = await connection.connect();
    session.state = 'connected';
    session.roomId = roomState?.roomId ? String(roomState.roomId) : null;
    session.viewerCount =
      typeof roomState?.roomInfo?.user_count === 'number' ? roomState.roomInfo.user_count : null;
    session.lastError = null;
    broadcastStatus(session);
    return {
      ok: true,
      state: 'connected',
      username: session.username,
      roomId: session.roomId,
      viewerCount: session.viewerCount,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const offlineLike = /offline|not found|isn't live|live/i.test(errMsg);
    session.state = offlineLike ? 'disconnected' : 'error';
    session.roomId = null;
    session.viewerCount = null;
    session.connection = null;
    session.lastError = `@${session.username} yayınına bağlanılamadı: ${errMsg}`;
    broadcastStatus(session);
    return {
      ok: false,
      state: session.state,
      username: session.username,
      error: session.lastError,
    };
  }
}

function parseRequestPathAndQuery(rawUrl) {
  const raw = String(rawUrl || '/').trim();
  const [pathAndProtocol, queryPart = ''] = raw.split('?');
  let pathOnly = pathAndProtocol.split('#')[0] || '/';

  if (/^https?:\/\//i.test(pathOnly)) {
    try {
      pathOnly = new URL(pathOnly).pathname || '/';
    } catch {
      pathOnly = '/';
    }
  }

  const normalizedPath =
    (pathOnly.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/').toLowerCase();
  const searchParams = new URLSearchParams(queryPart.split('#')[0]);
  return { pathname: normalizedPath, searchParams };
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { ok: false, error: 'Missing URL' });
    return;
  }

  const method = String(req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const { pathname, searchParams } = parseRequestPathAndQuery(req.url);

  // Health & root status routes (evaluated before all other routes and 404 fallback)
  if ((method === 'GET' || method === 'HEAD') && (pathname === '/' || pathname === '/health')) {
    const active = Array.from(sessions.values()).filter((s) => s.state === 'connected').length;
    if (method === 'HEAD') {
      setCorsHeaders(res);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end();
      return;
    }
    sendJson(res, 200, {
      ok: true,
      service: 'nur-i-dua-tiktok-relay',
      defaultUsername: DEFAULT_USERNAME,
      connectedSessions: active,
      endpoints: ['GET /health', 'POST /connect', 'POST /disconnect', 'GET /events'],
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (pathname === '/connect' || pathname === '/tiktok-connect') {
    if (method !== 'POST') {
      sendJson(res, 405, {
        ok: false,
        state: 'error',
        error: `Method ${method} not allowed. Use POST ${pathname} with JSON body { "username": "fcproplayer7" }.`,
      });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const target = sanitizeHandle(body.username || DEFAULT_USERNAME) || DEFAULT_USERNAME;
      const result = await connectSession(target);
      sendJson(res, result.ok ? 200 : 502, result);
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        state: 'error',
        error: err instanceof Error ? err.message : 'Bad request',
      });
    }
    return;
  }

  if (pathname === '/disconnect') {
    if (method !== 'POST') {
      sendJson(res, 405, {
        ok: false,
        state: 'error',
        error: `Method ${method} not allowed. Use POST /disconnect with JSON body.`,
      });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const target = sanitizeHandle(body.username || DEFAULT_USERNAME) || DEFAULT_USERNAME;
      const session = sessions.get(target);
      if (session) {
        await disconnectSession(session);
      }
      sendJson(res, 200, { ok: true, state: 'disconnected', username: target });
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        state: 'error',
        error: err instanceof Error ? err.message : 'Bad request',
      });
    }
    return;
  }

  if (method === 'GET' && pathname === '/events') {
    const target = sanitizeHandle(searchParams.get('username') || DEFAULT_USERNAME) || DEFAULT_USERNAME;
    const session = getOrCreateSession(target);

    setCorsHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    session.clients.add(res);
    res.write(
      `event: status\ndata: ${JSON.stringify({
        state: session.state,
        username: session.username,
        roomId: session.roomId,
        viewerCount: session.viewerCount,
        error: session.lastError,
        updatedAt: new Date().toISOString(),
      })}\n\n`
    );

    const keepAlive = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 20_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      session.clients.delete(res);
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: `Not found: ${method} ${pathname}` });
});

server.listen(PORT, HOST, () => {
  console.log(`[NUR-I DUA Relay] Entry file: ${__filename}`);
  console.log(`[NUR-I DUA Relay] Working directory: ${process.cwd()}`);
  console.log(`[NUR-I DUA Relay] Listening on http://${HOST}:${PORT} (default target: @${DEFAULT_USERNAME})`);
});

async function shutdown() {
  for (const session of sessions.values()) {
    await disconnectSession(session);
  }
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
