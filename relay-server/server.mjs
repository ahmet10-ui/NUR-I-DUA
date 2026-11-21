import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_PORT = Number(process.env.PORT || 8080);
const DEFAULT_HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_RING_BUFFER_SIZE = 500;
const DEFAULT_STREAK_TIMEOUT_MS = 4500;
const DEFAULT_STREAK_GC_MS = 60_000;

const SIM_SAMPLE_USERS = [
  'ahmet_yilmaz',
  'fatma_nur',
  'mehmet_can',
  'zeynep_kaya',
  'omer_faruk',
  'ayse_demir',
  'ibrahim_oz',
  'hatice_gul',
];

export function sanitizeHandle(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9._]/g, '')
    .slice(0, 40)
    .toLowerCase();
}

export function sanitizeDisplayText(raw, fallback) {
  const cleaned = String(raw || '')
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function toPositiveFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

export function isSocialFollowEvent(data) {
  const displayType = String(
    data?.displayType || data?.common?.displayText?.key || ''
  ).toLowerCase();
  const label = String(data?.label || '').toLowerCase();
  const action = Number(data?.action);

  if (displayType.includes('follow') || label.includes('follow')) {
    return true;
  }
  // Explicitly reject known non-follow social actions (share, like, join, enter, chat, subscribe)
  if (
    displayType &&
    /(share|like|join|enter|chat|comment|subscribe|gift|welcome_member)/i.test(displayType)
  ) {
    return false;
  }
  return action === 1;
}

export function parseLastEventId(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const sep = value.lastIndexOf(':');
  if (sep <= 0) return null;
  const instanceId = value.slice(0, sep).trim();
  const seqStr = value.slice(sep + 1).trim();
  if (!instanceId || !/^\d+$/.test(seqStr)) return null;
  const seq = Number(seqStr);
  if (!Number.isSafeInteger(seq) || seq < 0) return null;
  return { instanceId, seq };
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Cache-Control, X-Requested-With, Last-Event-ID'
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

function pruneTimestampMap(map, maxSize, maxAgeMs) {
  if (map.size <= maxSize) return;
  const cutoff = Date.now() - maxAgeMs;
  for (const [key, ts] of map.entries()) {
    if (ts < cutoff) {
      map.delete(key);
    }
  }
  while (map.size > maxSize) {
    const firstKey = map.keys().next().value;
    if (firstKey === undefined) break;
    map.delete(firstKey);
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

function formatSseFrame(sseId, eventName, payload) {
  return `id: ${sseId}\nevent: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function createRelayServer(options = {}) {
  const defaultUsername =
    sanitizeHandle(options.defaultUsername || process.env.TIKTOK_USERNAME || 'fcproplayer7') ||
    'fcproplayer7';
  const ringBufferSize = Math.max(
    10,
    Number(options.ringBufferSize ?? process.env.SSE_RING_BUFFER_SIZE ?? DEFAULT_RING_BUFFER_SIZE) ||
      DEFAULT_RING_BUFFER_SIZE
  );
  const streakTimeoutMs = Math.max(
    50,
    Number(options.streakTimeoutMs ?? process.env.STREAK_TIMEOUT_MS ?? DEFAULT_STREAK_TIMEOUT_MS) ||
      DEFAULT_STREAK_TIMEOUT_MS
  );
  const streakGarbageCollectMs = Math.max(
    200,
    Number(options.streakGarbageCollectMs ?? DEFAULT_STREAK_GC_MS) || DEFAULT_STREAK_GC_MS
  );
  const simulationEnabled =
    options.simulationEnabled !== undefined
      ? Boolean(options.simulationEnabled)
      : process.env.SIMULATION_ENABLED === 'true';
  const relayInstanceId =
    options.instanceId ||
    `rly_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const connectionFactory =
    options.connectionFactory ||
    (async (username) => {
      const { TikTokLiveConnection } = await import('tiktok-live-connector');
return new TikTokLiveConnection(username, {
  processInitialData: false,
  enableExtendedGiftInfo: true,
  ...(process.env.SIGN_API_KEY
    ? { signApiKey: process.env.SIGN_API_KEY }
    : {}),
});
    });

  /**
   * Active sessions keyed by lowercase public TikTok handle (no passwords or cookies).
   */
  const sessions = new Map();

  function getOrCreateSession(username) {
    const handle = sanitizeHandle(username) || defaultUsername;
    let session = sessions.get(handle);
    if (!session) {
      session = {
        username: handle,
        instanceId: relayInstanceId,
        state: 'disconnected',
        roomId: null,
        viewerCount: null,
        lastError: null,
        connection: null,
        clients: new Set(),
        nextSeq: 0,
        evictedUpToSeq: 0,
        eventBuffer: [],
        streakSeq: 0,
        pendingStreaks: new Map(),
        activeStreakKeys: new Map(),
        finalizedStreaks: new Map(),
        seenFollowKeys: new Map(),
        seenFollowMsgIds: new Map(),
      };
      sessions.set(handle, session);
    }
    return session;
  }

  function clearPendingStreaks(session) {
    for (const entry of session.pendingStreaks.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.gcTimer) clearTimeout(entry.gcTimer);
    }
    session.pendingStreaks.clear();
    session.activeStreakKeys.clear();
  }

  function nextSseId(session) {
    session.nextSeq += 1;
    const seq = session.nextSeq;
    return {
      seq,
      sseId: `${session.instanceId}:${seq}`,
    };
  }

  function broadcastSse(session, eventName, payload, opts = {}) {
    const { bufferable = false } = opts;
    const { seq, sseId } = nextSseId(session);
    const enriched = {
      ...payload,
      sseEventId: sseId,
    };

    if (bufferable) {
      session.eventBuffer.push({
        seq,
        sseId,
        eventName,
        payload: enriched,
      });
      while (session.eventBuffer.length > ringBufferSize) {
        const evicted = session.eventBuffer.shift();
        if (evicted && evicted.seq > session.evictedUpToSeq) {
          session.evictedUpToSeq = evicted.seq;
        }
      }
    }

    const frame = formatSseFrame(sseId, eventName, enriched);
    for (const res of session.clients) {
      try {
        res.write(frame);
      } catch {
        session.clients.delete(res);
      }
    }
    return enriched;
  }

  function broadcastStatus(session) {
    return broadcastSse(session, 'status', {
      state: session.state,
      username: session.username,
      roomId: session.roomId,
      viewerCount: session.viewerCount,
      error: session.lastError,
      instanceId: session.instanceId,
      simulationEnabled,
      updatedAt: new Date().toISOString(),
    });
  }

  function finalizeRelayGift(session, payload) {
    return broadcastSse(session, 'gift', payload, { bufferable: true });
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
    // Any streakable gift without explicit `repeatEnd === true` must remain buffered/incomplete.
    const isStreakIncomplete = isStreakable && repeatEnd !== true;

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

    const userBucket = userId ? `uid_${userId}` : username.toLowerCase();
    const comboBucket = `${userBucket}:${giftId}`;
    const explicitGroupId =
      data?.groupId !== undefined && data?.groupId !== null && String(data.groupId).trim()
        ? String(data.groupId).trim()
        : '';

    let streakKey = '';
    if (explicitGroupId) {
      streakKey = `${comboBucket}:${explicitGroupId}`;
    } else {
      const existingKey = session.activeStreakKeys.get(comboBucket);
      if (existingKey) {
        const pendingForExisting = session.pendingStreaks.get(existingKey);
        // If previous incomplete streak already timed out AND the incoming count dropped
        // below its maxQty, the user started a brand-new streak — discard the stale one.
        if (pendingForExisting && pendingForExisting.timedOut && repeatCount < pendingForExisting.maxQty) {
          if (pendingForExisting.timer) clearTimeout(pendingForExisting.timer);
          if (pendingForExisting.gcTimer) clearTimeout(pendingForExisting.gcTimer);
          session.pendingStreaks.delete(existingKey);
          session.activeStreakKeys.delete(comboBucket);
        } else {
          streakKey = existingKey;
        }
      }
      if (!streakKey) {
        session.streakSeq += 1;
        const msgSuffix = data?.msgId ? String(data.msgId) : `${Date.now()}`;
        streakKey = `${comboBucket}:s${session.streakSeq}_${msgSuffix}`;
        if (isStreakIncomplete) {
          session.activeStreakKeys.set(comboBucket, streakKey);
        }
      }
    }

    // Prevent late or replayed events from colliding with an already-finalized streakKey
    if (session.finalizedStreaks.has(streakKey)) {
      return { accepted: false, buffered: false, reason: 'already_finalized', streakKey };
    }

    const payload = {
      eventId: String(data?.msgId || `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      streakKey,
      isSimulated: data?.isSimulated ? true : undefined,
      userId,
      username,
      nickname,
      giftId,
      giftName,
      quantity: repeatCount,
      unitCoins: unitCoins > 0 ? unitCoins : undefined,
      unitCoinsSource,
      diamondCount:
        unitCoins > 0
          ? unitCoins
          : typeof data?.diamondCount === 'number'
          ? data.diamondCount
          : undefined,
      giftType,
      repeatCount,
      repeatEnd,
      rawMeta: {
        hasExtendedGiftInfo: Boolean(data?.extendedGiftInfo),
        extendedDiamondCount: extendedDiamondCount || undefined,
        giftDiamondCount: giftDiamondCount || undefined,
        rawDiamondCount: typeof data?.diamondCount === 'number' ? data.diamondCount : undefined,
        groupId: explicitGroupId || undefined,
        msgId: data?.msgId ? String(data.msgId) : undefined,
      },
      timestamp: new Date().toISOString(),
    };

    if (isStreakIncomplete) {
      const existing = session.pendingStreaks.get(streakKey);
      if (existing?.timer) clearTimeout(existing.timer);
      if (existing?.gcTimer) clearTimeout(existing.gcTimer);

      const bestQty = existing ? Math.max(existing.maxQty, payload.quantity) : payload.quantity;
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

      const entry = {
        payload: updatedPayload,
        comboBucket,
        maxQty: bestQty,
        timedOut: false,
        timer: null,
        gcTimer: null,
      };

      // IMPORTANT: At timeout, NEVER synthesize `repeatEnd: true` or finalize an unconfirmed streak.
      // Mark as timedOut and retain safely until GC so if TikTok sends a delayed `repeatEnd: true`,
      // it merges once without double-counting, and if abandoned, nothing enters the prayer queue.
      entry.timer = setTimeout(() => {
        const pending = session.pendingStreaks.get(streakKey);
        if (!pending) return;
        pending.timedOut = true;
        pending.timer = null;
        pending.gcTimer = setTimeout(() => {
          const current = session.pendingStreaks.get(streakKey);
          if (current === pending) {
            session.pendingStreaks.delete(streakKey);
            if (session.activeStreakKeys.get(comboBucket) === streakKey) {
              session.activeStreakKeys.delete(comboBucket);
            }
          }
        }, streakGarbageCollectMs);
        pending.gcTimer.unref?.();
      }, streakTimeoutMs);
      entry.timer.unref?.();

      session.pendingStreaks.set(streakKey, entry);
      return { accepted: true, buffered: true, streakKey };
    }

    // Completed streak (`repeatEnd === true`) or non-streakable single gift
    if (session.activeStreakKeys.get(comboBucket) === streakKey) {
      session.activeStreakKeys.delete(comboBucket);
    }

    const existing = session.pendingStreaks.get(streakKey);
    let finalPayload = payload;
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer);
      if (existing.gcTimer) clearTimeout(existing.gcTimer);
      session.pendingStreaks.delete(streakKey);
      const finalQty = Math.max(existing.maxQty, payload.quantity);
      const finalUnitCoins =
        payload.unitCoins && payload.unitCoins > 0
          ? payload.unitCoins
          : existing.payload.unitCoins;
      const finalUnitSource =
        payload.unitCoins && payload.unitCoins > 0
          ? payload.unitCoinsSource
          : existing.payload.unitCoinsSource || 'none';
      finalPayload = {
        ...payload,
        quantity: finalQty,
        repeatCount: finalQty,
        unitCoins: finalUnitCoins,
        unitCoinsSource: finalUnitSource,
        diamondCount: finalUnitCoins ?? payload.diamondCount,
        repeatEnd: true,
      };
    }

    session.finalizedStreaks.set(streakKey, Date.now());
    pruneTimestampMap(session.finalizedStreaks, 2000, 30 * 60 * 1000);

    const emitted = finalizeRelayGift(session, finalPayload);
    return { accepted: true, buffered: false, streakKey, payload: emitted };
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
      return { accepted: false, reason: 'missing_identity' };
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
      return { accepted: false, reason: 'duplicate_msg_id' };
    }

    const dedupeKey = userId ? `uid:${userId}` : `uname:${effectiveUsername.toLowerCase()}`;
    if (session.seenFollowKeys.has(dedupeKey)) {
      return { accepted: false, reason: 'duplicate_follower' };
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
      isSimulated: data?.isSimulated ? true : undefined,
      userId,
      username: effectiveUsername,
      nickname,
      rawEventType,
      displayType: data?.displayType ? sanitizeDisplayText(String(data.displayType), '') : undefined,
      msgId: cleanMsgId,
      timestamp: new Date().toISOString(),
    };

    const emitted = broadcastSse(session, 'follow', payload, { bufferable: true });
    return { accepted: true, payload: emitted };
  }

  async function disconnectSession(session, opts = {}) {
    // Drop incomplete streaks safely without falsely marking them as repeatEnd: true
    clearPendingStreaks(session);
    if (opts.clearDedupeCaches) {
      session.seenFollowKeys.clear();
      session.seenFollowMsgIds.clear();
    }

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
        instanceId: session.instanceId,
      };
    }

    await disconnectSession(session);
    const connectStartSeq = session.nextSeq;

    session.state = 'connecting';
    session.lastError = null;
    broadcastStatus(session);

    let connection;
    try {
      connection = await connectionFactory(session.username);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      session.state = 'error';
      session.lastError = `tiktok-live-connector yüklenemedi: ${errMsg}`;
      session.connection = null;
      broadcastStatus(session);
      return {
        ok: false,
        state: 'error',
        username: session.username,
        error: session.lastError,
      };
    }
    session.connection = connection;

    connection.on('gift', (event) => {
  const user = event?.user || {};
  const gift = event?.gift || {};

  handleRawTikTokGift(session, {
    ...event,
    userId: user.id,
    uniqueId: user.displayId,
    nickname: user.nickname,
    giftId: event?.giftId ?? gift.id,
    giftName: gift.name ?? event?.extendedGiftInfo?.name,
    giftType: gift.type,
    diamondCount: gift.diamondCount,
    repeatCount: event?.repeatCount,
    repeatEnd: event?.repeatEnd === 1 || event?.repeatEnd === true,
    groupId: event?.groupId,
    msgId: event?.common?.msgId,
    extendedGiftInfo: event?.extendedGiftInfo,
  });
});

    connection.on('follow', (event) => {
  const user = event?.user || {};
  handleRawTikTokFollow(session, {
    ...event,
    userId: user.id,
    uniqueId: user.displayId,
    nickname: user.nickname,
    msgId: event?.common?.msgId,
  }, 'follow');
});

connection.on('social', (event) => {
  if (isSocialFollowEvent(event)) {
    const user = event?.user || {};
    handleRawTikTokFollow(session, {
      ...event,
      userId: user.id,
      uniqueId: user.displayId,
      nickname: user.nickname,
      msgId: event?.common?.msgId,
    }, 'social');
  }
});

connection.on('roomUser', (event) => {
  const viewerCount = Number(event?.total ?? event?.totalUser);
  if (Number.isFinite(viewerCount) && viewerCount >= 0) {
    session.viewerCount = viewerCount;
    broadcastStatus(session);
  }
});

    connection.on('streamEnd', () => {
      clearPendingStreaks(session);
      session.state = 'disconnected';
      session.lastError = `TikTok canlı yayını sona erdi (@${session.username}).`;
      session.roomId = null;
      session.viewerCount = null;
      session.connection = null;
      broadcastStatus(session);
    });

    connection.on('disconnected', () => {
      clearPendingStreaks(session);
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
      session.state = 'connected';session.roomId = roomState?.roomId ? String(roomState.roomId) : null;
const initialViewerCount = Number(
  roomState?.roomInfo?.user_count ?? roomState?.roomInfo?.userCount
);
session.viewerCount = Number.isFinite(initialViewerCount)
  ? initialViewerCount
  : null;
      session.lastError = null;
      broadcastStatus(session);
      return {
        ok: true,
        state: 'connected',
        username: session.username,
        roomId: session.roomId,
        viewerCount: session.viewerCount,
        instanceId: session.instanceId,
        initialEventCursor: `${session.instanceId}:${connectStartSeq}`,
      };
    } catch (err) {
      clearPendingStreaks(session);
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

  function pickRandomSimSender(explicitSender) {
    if (explicitSender && String(explicitSender).trim()) {
      return sanitizeHandle(explicitSender) || 'test_izleyici';
    }
    const base = SIM_SAMPLE_USERS[Math.floor(Math.random() * SIM_SAMPLE_USERS.length)];
    const suffix = Math.floor(100 + Math.random() * 899);
    return `${base}_${suffix}`;
  }

  async function runSimulationScenario(session, body) {
    const scenario = String(body?.scenario || 'small_gift').trim().toLowerCase();
    const sender = pickRandomSimSender(body?.senderUsername || body?.sender);
    const simUid = `sim_uid_${sender}_${Math.floor(1000 + Math.random() * 8999)}`;
    const now = Date.now();
    const stepDelayMs = Math.max(0, Math.min(1000, Number(body?.stepDelayMs) || 0));

    if (scenario === 'follower' || scenario === 'follow') {
      const res = handleRawTikTokFollow(
        session,
        {
          isSimulated: true,
          userId: simUid,
          uniqueId: sender,
          nickname: sender,
          action: 1,
          displayType: body?.displayType || 'pm_mt_msg_viewer_followed',
          msgId: `sim_flw_${now}_${Math.random().toString(36).slice(2, 6)}`,
        },
        'social'
      );
      return {
        scenario: 'follower',
        emittedCount: res.accepted ? 1 : 0,
        bufferedCount: 0,
        events: res.payload ? [res.payload] : [],
      };
    }

    if (scenario === 'streak' || scenario === 'incomplete_streak') {
      const unitCoins = Math.max(1, Math.floor(Number(body?.unitCoins) || 10));
      const giftName = sanitizeDisplayText(body?.giftName, 'Simülasyon Gülü');
      const giftId = String(body?.giftId || 'sim_streak_gift');
      const groupId = String(body?.groupId || `sim_grp_${now}_${Math.random().toString(36).slice(2, 6)}`);
      const steps =
        Array.isArray(body?.steps) && body.steps.length > 0
          ? body.steps.map((n) => Math.max(1, Math.floor(Number(n) || 1)))
          : [1, 3, 5];
      const includeRepeatEnd =
        scenario === 'incomplete_streak'
          ? false
          : body?.includeRepeatEnd !== undefined
          ? Boolean(body.includeRepeatEnd)
          : true;

      const emitted = [];
      let bufferedCount = 0;

      for (let i = 0; i < steps.length; i += 1) {
        const isLast = i === steps.length - 1;
        const repeatEnd = includeRepeatEnd && isLast ? true : false;
        const r = handleRawTikTokGift(session, {
          isSimulated: true,
          userId: simUid,
          uniqueId: sender,
          nickname: sender,
          giftId,
          giftName,
          giftType: 1,
          repeatCount: steps[i],
          repeatEnd,
          groupId,
          msgId: `sim_stk_${now}_${i}`,
          extendedGiftInfo: {
            id: giftId,
            name: giftName,
            diamond_count: unitCoins,
          },
        });
        if (r.buffered) bufferedCount += 1;
        if (r.payload) emitted.push(r.payload);
        if (stepDelayMs > 0 && !isLast) {
          await new Promise((resolve) => setTimeout(resolve, stepDelayMs));
        }
      }

      return {
        scenario,
        emittedCount: emitted.length,
        bufferedCount,
        events: emitted,
      };
    }

    // Single gift scenarios: small_gift | mid_gift | high_gift | yasin_300
    const defaultsByScenario = {
      small_gift: { unitCoins: 1, giftId: '5655', giftName: 'Çay (Simülasyon)' },
      mid_gift: { unitCoins: 75, giftId: '5660', giftName: 'Kalp Kutusu (Simülasyon)' },
      high_gift: { unitCoins: 200, giftId: '5760', giftName: 'Altın Taç (Simülasyon)' },
      yasin_300: { unitCoins: 300, giftId: '6001', giftName: 'Nurlu Taç (300+ Simülasyon)' },
    };

    const chosen = defaultsByScenario[scenario] || defaultsByScenario.small_gift;
    const unitCoins = Math.max(1, Math.floor(Number(body?.unitCoins) || chosen.unitCoins));
    const repeatCount = Math.max(1, Math.min(999, Math.floor(Number(body?.repeatCount) || 1)));
    const giftName = sanitizeDisplayText(body?.giftName, chosen.giftName);
    const giftId = String(body?.giftId || chosen.giftId);

    const r = handleRawTikTokGift(session, {
      isSimulated: true,
      userId: simUid,
      uniqueId: sender,
      nickname: sender,
      giftId,
      giftName,
      giftType: 0,
      repeatCount,
      repeatEnd: true,
      msgId: `sim_gft_${now}_${Math.random().toString(36).slice(2, 6)}`,
      extendedGiftInfo: {
        id: giftId,
        name: giftName,
        diamond_count: unitCoins,
      },
    });

    return {
      scenario,
      emittedCount: r.payload ? 1 : 0,
      bufferedCount: r.buffered ? 1 : 0,
      events: r.payload ? [r.payload] : [],
    };
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

    if ((method === 'GET' || method === 'HEAD') && (pathname === '/' || pathname === '/health')) {
      const active = Array.from(sessions.values()).filter((s) => s.state === 'connected').length;
      if (method === 'HEAD') {
        setCorsHeaders(res);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end();
        return;
      }
      const endpoints = ['GET /health', 'POST /connect', 'POST /disconnect', 'GET /events'];
      if (simulationEnabled) endpoints.push('POST /simulate');
      sendJson(res, 200, {
        ok: true,
        service: 'nur-i-dua-tiktok-relay',
        instanceId: relayInstanceId,
        defaultUsername,
        connectedSessions: active,
        ringBufferSize,
        simulationEnabled,
        endpoints,
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
        const target = sanitizeHandle(body.username || defaultUsername) || defaultUsername;
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
        const target = sanitizeHandle(body.username || defaultUsername) || defaultUsername;
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

    if (pathname === '/simulate') {
      // Strictly disabled (404) unless SIMULATION_ENABLED=true is explicitly set
      if (!simulationEnabled) {
        sendJson(res, 404, { ok: false, error: `Not found: ${method} ${pathname}` });
        return;
      }
      if (method !== 'POST') {
        sendJson(res, 405, {
          ok: false,
          error: `Method ${method} not allowed. Use POST /simulate with JSON body.`,
        });
        return;
      }
      try {
        const body = await readJsonBody(req);
        const target = sanitizeHandle(body.username || defaultUsername) || defaultUsername;
        const session = getOrCreateSession(target);
        const result = await runSimulationScenario(session, body);
        sendJson(res, 200, {
          ok: true,
          simulated: true,
          username: session.username,
          instanceId: session.instanceId,
          ...result,
        });
      } catch (err) {
        sendJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : 'Bad request',
        });
      }
      return;
    }

    if (method === 'GET' && pathname === '/events') {
      const target = sanitizeHandle(searchParams.get('username') || defaultUsername) || defaultUsername;
      const session = getOrCreateSession(target);

      const rawLastEventId =
        String(req.headers['last-event-id'] || '').trim() ||
        String(searchParams.get('lastEventId') || '').trim();

      setCorsHeaders(res);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      session.clients.add(res);

      // Replay missed buffered events or report explicit recovery_gap
      if (rawLastEventId) {
        const parsed = parseLastEventId(rawLastEventId);
        if (!parsed || parsed.instanceId !== session.instanceId || parsed.seq > session.nextSeq) {
          const { sseId } = nextSseId(session);
          res.write(
            formatSseFrame(sseId, 'recovery_gap', {
              reason: !parsed || parsed.instanceId !== session.instanceId
                ? 'relay_restarted'
                : 'sequence_mismatch',
              message:
                'Relay sunucusu yeniden başlatıldığı için bellek içi olay tamponu sıfırlandı; kesinti sırasındaki olaylar tekrar gönderilemedi.',
              instanceId: session.instanceId,
              previousInstanceId: parsed?.instanceId,
              lastReceivedSeq: parsed?.seq,
              oldestAvailableSeq: session.eventBuffer[0]?.seq ?? null,
              currentSeq: session.nextSeq,
              sseEventId: sseId,
              timestamp: new Date().toISOString(),
            })
          );
        } else {
          if (parsed.seq < session.evictedUpToSeq) {
            const { sseId } = nextSseId(session);
            res.write(
              formatSseFrame(sseId, 'recovery_gap', {
                reason: 'buffer_evicted',
                message: `Bağlantı kesintisi sırasında ${session.evictedUpToSeq - parsed.seq} olay bellek tamponu (${ringBufferSize}) sınırını aştığı için kısmen kaybedildi.`,
                instanceId: session.instanceId,
                lastReceivedSeq: parsed.seq,
                oldestAvailableSeq: session.eventBuffer[0]?.seq ?? null,
                currentSeq: session.nextSeq,
                missedEstimate: session.evictedUpToSeq - parsed.seq,
                sseEventId: sseId,
                timestamp: new Date().toISOString(),
              })
            );
          }
          for (const entry of session.eventBuffer) {
            if (entry.seq > parsed.seq) {
              res.write(
                formatSseFrame(entry.sseId, entry.eventName, {
                  ...entry.payload,
                  replayed: true,
                })
              );
            }
          }
        }
      }

      // Always send current live connection status with a fresh monotonic SSE id
      const statusId = nextSseId(session);
      res.write(
        formatSseFrame(statusId.sseId, 'status', {
          state: session.state,
          username: session.username,
          roomId: session.roomId,
          viewerCount: session.viewerCount,
          error: session.lastError,
          instanceId: session.instanceId,
          simulationEnabled,
          sseEventId: statusId.sseId,
          updatedAt: new Date().toISOString(),
        })
      );

      const keepAlive = setInterval(() => {
        try {
          res.write(': keep-alive\n\n');
        } catch {
          clearInterval(keepAlive);
        }
      }, 20_000);
      keepAlive.unref?.();

      req.on('close', () => {
        clearInterval(keepAlive);
        session.clients.delete(res);
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: `Not found: ${method} ${pathname}` });
  });

  async function shutdown() {
    for (const session of sessions.values()) {
      await disconnectSession(session);
    }
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return {
    server,
    sessions,
    instanceId: relayInstanceId,
    simulationEnabled,
    ringBufferSize,
    getOrCreateSession,
    connectSession,
    disconnectSession,
    handleRawTikTokGift,
    handleRawTikTokFollow,
    shutdown,
  };
}

const isCliEntrypoint =
  typeof process.argv[1] === 'string' && path.resolve(process.argv[1]) === __filename;

if (isCliEntrypoint) {
  const relay = createRelayServer();
  relay.server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
    console.log(`[NUR-I DUA Relay] Entry file: ${__filename}`);
    console.log(`[NUR-I DUA Relay] Working directory: ${process.cwd()}`);
    console.log(
      `[NUR-I DUA Relay] Listening on http://${DEFAULT_HOST}:${DEFAULT_PORT} (simulation=${relay.simulationEnabled})`
    );
  });

  process.on('SIGINT', () => {
    void relay.shutdown().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void relay.shutdown().then(() => process.exit(0));
  });
}
