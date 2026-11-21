import {
  ITikTokGiftAdapter,
  TikTokConnectionConfig,
  TikTokConnectionState,
  TikTokConnectorStatusPayload,
  TikTokRecoveryGapInfo,
  TikTokRelayFollowPayload,
  TikTokRelayGiftPayload,
} from '../types/nuridua';
import { sanitizeGiftName, sanitizeTikTokHandle, sanitizeUsername } from '../utils/sanitize';

export interface TikTokConnectorCallbacks {
  onStatusChange?: (payload: TikTokConnectorStatusPayload) => void;
  onFinalizedGift?: (gift: TikTokRelayGiftPayload) => void;
  onFollowEvent?: (follow: TikTokRelayFollowPayload) => void;
  onRecoveryGap?: (gap: TikTokRecoveryGapInfo) => void;
  onLog?: (level: 'info' | 'warning' | 'error', message: string) => void;
}

export interface TikTokServiceOptions {
  streakTimeoutMs?: number;
  streakGcMs?: number;
  stabilityResetMs?: number;
  maxBackoffMs?: number;
  connectTimeoutMs?: number;
  disconnectTimeoutMs?: number;
}

export interface RawGiftInput extends Partial<TikTokRelayGiftPayload> {
  uniqueId?: string;
  groupId?: string;
  user?: {
    uniqueId?: string;
    nickname?: string;
    userId?: string | number;
  };
}

export interface RawFollowInput extends Partial<TikTokRelayFollowPayload> {
  uniqueId?: string;
  user?: {
    uniqueId?: string;
    nickname?: string;
    userId?: string | number;
  };
}

interface PendingStreakEntry {
  gift: TikTokRelayGiftPayload;
  comboBucket: string;
  timedOut: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
  gcTimer: ReturnType<typeof setTimeout> | null;
}

const LAST_EVENT_ID_STORAGE_KEY = 'nur_i_dua_sse_last_id_v1';

function readStoredLastEventId(storageKey: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LAST_EVENT_ID_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return typeof parsed[storageKey] === 'string' && parsed[storageKey].trim()
      ? parsed[storageKey].trim()
      : null;
  } catch {
    return null;
  }
}

function writeStoredLastEventId(storageKey: string, eventId: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(LAST_EVENT_ID_STORAGE_KEY);
    const parsed: Record<string, string> = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    if (eventId) {
      parsed[storageKey] = eventId;
    } else {
      delete parsed[storageKey];
    }
    const keys = Object.keys(parsed);
    if (keys.length > 20) {
      delete parsed[keys[0]];
    }
    localStorage.setItem(LAST_EVENT_ID_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore storage errors
  }
}

export function getTikTokStateLabel(state: TikTokConnectionState): string {
  switch (state) {
    case 'unconfigured':
      return 'Not Configured';
    case 'connected':
      return 'Bağlı';
    case 'connecting':
      return 'Bağlanıyor';
    case 'disconnected':
      return 'Çevrimdışı';
    case 'error':
      return 'Hata';
    default:
      return 'Not Configured';
  }
}

export function normalizeRelayBaseUrl(rawUrl: string): string {
  let trimmed = rawUrl.trim();
  if (!trimmed) return '';

  // Upgrade insecure http:// to https:// on hosted Render/Koyeb/Fly domains so CORS preflight isn't broken by 307 redirects
  if (/^http:\/\/[a-z0-9.-]+\.(onrender\.com|koyeb\.app|fly\.dev)/i.test(trimmed)) {
    trimmed = trimmed.replace(/^http:\/\//i, 'https://');
  }

  const stripEndpointSuffixes = (pathValue: string): string => {
    let cleaned = pathValue.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    let prev = '';
    while (cleaned !== prev) {
      prev = cleaned;
      cleaned = cleaned
        .replace(/\/(connect|disconnect|events|health|tiktok-connect|status|simulate)$/i, '')
        .replace(/\/+$/, '');
    }
    return cleaned;
  };

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const basePath = stripEndpointSuffixes(parsed.pathname);
      return `${parsed.protocol}//${parsed.host}${basePath}`;
    } catch {
      // Fall back to string normalization below
    }
  }

  return stripEndpointSuffixes(trimmed.split(/[?#]/)[0]);
}

/**
 * Dedicated TikTok LIVE Connector client service.
 *
 * Architectural note: Android/Capacitor WebView & browsers cannot run Node.js `tiktok-live-connector`
 * directly. This service communicates over standard HTTPS + Server-Sent Events (SSE) with a
 * separate free-host-compatible Node.js relay server (public @username only — never passwords/cookies).
 */
export class TikTokLiveConnectorService implements ITikTokGiftAdapter {
  readonly mode = 'real' as const;

  private config: TikTokConnectionConfig;
  private callbacks: TikTokConnectorCallbacks;
  private options: Required<TikTokServiceOptions>;
  private status: TikTokConnectionState = 'unconfigured';
  private roomId: string | null = null;
  private viewerCount: number | null = null;
  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stableConnectionTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private manualDisconnect = false;
  private simulationStreamMode = false;
  private activeHandle = '';
  private hadConnectedSession = false;
  private lastEventIds = new Map<string, string>();

  // Streak aggregation & idempotent duplicate protection
  private pendingStreaks = new Map<string, PendingStreakEntry>();
  private activeStreakKeys = new Map<string, string>();
  private finalizedStreakKeys = new Map<string, number>();
  private finalizedGiftEventIds = new Map<string, number>();
  private seenSseEventIds = new Map<string, number>();
  private seenFollowKeys = new Map<string, number>();
  private seenFollowEventIds = new Map<string, number>();
  private localStreakSeq = 0;

  constructor(
    config: TikTokConnectionConfig,
    callbacks: TikTokConnectorCallbacks = {},
    options: TikTokServiceOptions = {}
  ) {
    this.config = { ...config };
    this.callbacks = callbacks;
    this.options = {
      streakTimeoutMs: Math.max(50, options.streakTimeoutMs ?? 4500),
      streakGcMs: Math.max(200, options.streakGcMs ?? 60_000),
      stabilityResetMs: Math.max(0, options.stabilityResetMs ?? 1500),
      maxBackoffMs: Math.max(1000, options.maxBackoffMs ?? 60_000),
      connectTimeoutMs: Math.max(1000, options.connectTimeoutMs ?? 45_000),
      disconnectTimeoutMs: Math.max(500, options.disconnectTimeoutMs ?? 8_000),
    };
    this.status = this.isConfigured ? 'disconnected' : 'unconfigured';
  }

  get isConfigured(): boolean {
    return normalizeRelayBaseUrl(this.config.connectorEndpoint).length > 0;
  }

  get isSimulationStreamActive(): boolean {
    return this.simulationStreamMode && this.eventSource !== null;
  }

  getRetryCount(): number {
    return this.retryCount;
  }

  getLastEventId(baseUrl?: string, handle?: string): string | null {
    const base = normalizeRelayBaseUrl(baseUrl || this.config.connectorEndpoint);
    const cleanHandle = sanitizeTikTokHandle(handle || this.config.username) || 'fcproplayer7';
    if (!base) return null;
    const key = `${base}::${cleanHandle}`;
    return this.lastEventIds.get(key) ?? readStoredLastEventId(key);
  }

  private rememberLastEventId(baseUrl: string, cleanHandle: string, eventId?: string | null): void {
    const trimmed = String(eventId || '').trim();
    if (!trimmed) return;
    const key = `${baseUrl}::${cleanHandle}`;
    this.lastEventIds.set(key, trimmed);
    writeStoredLastEventId(key, trimmed);
  }

  private markSseEventSeen(sseId?: string | null): boolean {
    const clean = String(sseId || '').trim();
    if (!clean) return false;
    if (this.seenSseEventIds.has(clean)) {
      return true;
    }
    this.seenSseEventIds.set(clean, Date.now());
    if (this.seenSseEventIds.size > 2000) {
      const cutoff = Date.now() - 30 * 60 * 1000;
      for (const [k, ts] of this.seenSseEventIds.entries()) {
        if (ts < cutoff) this.seenSseEventIds.delete(k);
      }
      while (this.seenSseEventIds.size > 2000) {
        const firstKey = this.seenSseEventIds.keys().next().value;
        if (firstKey === undefined) break;
        this.seenSseEventIds.delete(firstKey);
      }
    }
    return false;
  }

  getStatus(): TikTokConnectionState {
    return this.status;
  }

  updateCallbacks(callbacks: TikTokConnectorCallbacks): void {
    this.callbacks = callbacks;
  }

  updateConfig(next: Partial<TikTokConnectionConfig>): void {
    this.config = { ...this.config, ...next };
    if (
      !this.isConfigured &&
      this.status !== 'connected' &&
      this.status !== 'connecting' &&
      this.status !== 'unconfigured'
    ) {
      this.emitStatus('unconfigured', null);
    } else if (this.isConfigured && this.status === 'unconfigured') {
      this.emitStatus('disconnected', null);
    }
  }

  private emitStatus(
    nextState: TikTokConnectionState,
    error: string | null = null,
    meta?: { roomId?: string | null; viewerCount?: number | null }
  ): void {
    this.status = nextState;
    if (meta?.roomId !== undefined) this.roomId = meta.roomId;
    if (meta?.viewerCount !== undefined) this.viewerCount = meta.viewerCount;

    this.callbacks.onStatusChange?.({
      state: nextState,
      username: sanitizeTikTokHandle(this.config.username) || 'fcproplayer7',
      roomId: this.roomId,
      viewerCount: this.viewerCount,
      error,
      updatedAt: new Date().toISOString(),
    });
  }

  private clearTimersAndStreams(): void {
    if (this.reconnectTimer !== null) {
      globalThis.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.stableConnectionTimer !== null) {
      globalThis.clearTimeout(this.stableConnectionTimer);
      this.stableConnectionTimer = null;
    }
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
    }
  }

  private clearPendingStreaks(): void {
    for (const [key, entry] of this.pendingStreaks.entries()) {
      if (entry.flushTimer !== null) globalThis.clearTimeout(entry.flushTimer);
      if (entry.gcTimer !== null) globalThis.clearTimeout(entry.gcTimer);
      this.pendingStreaks.delete(key);
    }
    this.activeStreakKeys.clear();
  }

  private pruneFinalizedCache(): void {
    if (this.finalizedStreakKeys.size <= 1500) return;
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [k, ts] of this.finalizedStreakKeys.entries()) {
      if (ts < cutoff) this.finalizedStreakKeys.delete(k);
    }
    while (this.finalizedStreakKeys.size > 1500) {
      const firstKey = this.finalizedStreakKeys.keys().next().value;
      if (firstKey === undefined) break;
      this.finalizedStreakKeys.delete(firstKey);
    }
    if (this.finalizedGiftEventIds.size > 1500) {
      const cutoff = Date.now() - 30 * 60 * 1000;
      for (const [k, ts] of this.finalizedGiftEventIds.entries()) {
        if (ts < cutoff) this.finalizedGiftEventIds.delete(k);
      }
      while (this.finalizedGiftEventIds.size > 1500) {
        const firstKey = this.finalizedGiftEventIds.keys().next().value;
        if (firstKey === undefined) break;
        this.finalizedGiftEventIds.delete(firstKey);
      }
    }
  }

  private finalizeGift(gift: TikTokRelayGiftPayload, explicitEventId?: string): void {
    if (this.finalizedStreakKeys.has(gift.streakKey)) {
      return;
    }
    if (explicitEventId && this.finalizedGiftEventIds.has(explicitEventId)) {
      return;
    }
    const now = Date.now();
    this.finalizedStreakKeys.set(gift.streakKey, now);
    if (explicitEventId) {
      this.finalizedGiftEventIds.set(explicitEventId, now);
    }
    this.pruneFinalizedCache();
    this.callbacks.onFinalizedGift?.(gift);
  }

  private pruneFollowCaches(): void {
    if (this.seenFollowKeys.size > 2000) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const [k, ts] of this.seenFollowKeys.entries()) {
        if (ts < cutoff) this.seenFollowKeys.delete(k);
      }
      while (this.seenFollowKeys.size > 2000) {
        const firstKey = this.seenFollowKeys.keys().next().value;
        if (firstKey === undefined) break;
        this.seenFollowKeys.delete(firstKey);
      }
    }
    if (this.seenFollowEventIds.size > 2000) {
      const cutoff = Date.now() - 60 * 60 * 1000;
      for (const [k, ts] of this.seenFollowEventIds.entries()) {
        if (ts < cutoff) this.seenFollowEventIds.delete(k);
      }
    }
  }

  /**
   * Normalizes and deduplicates incoming TikTok follow / social-follow events.
   */
  ingestRawFollowEvent(raw: RawFollowInput): {
    accepted: boolean;
    follow?: TikTokRelayFollowPayload;
  } {
    const cleanSseId = raw.sseEventId ? String(raw.sseEventId).trim() : '';
    if (cleanSseId && this.markSseEventSeen(cleanSseId)) {
      return { accepted: false };
    }

    const cleanUser = sanitizeUsername(
      raw.username ||
        raw.uniqueId ||
        raw.user?.uniqueId ||
        raw.nickname ||
        raw.user?.nickname ||
        'tiktok_takipci'
    );
    const rawUid = raw.userId ?? raw.user?.userId;
    const cleanUserId =
      rawUid !== undefined && rawUid !== null && String(rawUid).trim()
        ? String(rawUid).trim().slice(0, 64)
        : undefined;
    const cleanMsgId =
      raw.msgId !== undefined && raw.msgId !== null && String(raw.msgId).trim()
        ? String(raw.msgId).trim().slice(0, 80)
        : undefined;
    const eventId = String(
      raw.eventId || cleanMsgId || `flw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    );
    const dedupeKey =
      (raw.dedupeKey && String(raw.dedupeKey).trim()) ||
      (cleanUserId ? `uid:${cleanUserId}` : `uname:${cleanUser.toLowerCase()}`);

    if (this.seenFollowEventIds.has(eventId) || (cleanMsgId && this.seenFollowEventIds.has(cleanMsgId))) {
      return { accepted: false };
    }
    if (this.seenFollowKeys.has(dedupeKey)) {
      return { accepted: false };
    }

    const nowMs = Date.now();
    this.seenFollowKeys.set(dedupeKey, nowMs);
    this.seenFollowEventIds.set(eventId, nowMs);
    if (cleanMsgId) {
      this.seenFollowEventIds.set(cleanMsgId, nowMs);
    }
    this.pruneFollowCaches();

    const normalized: TikTokRelayFollowPayload = {
      eventId,
      sseEventId: raw.sseEventId,
      isSimulated: raw.isSimulated,
      replayed: raw.replayed,
      dedupeKey,
      userId: cleanUserId,
      username: cleanUser,
      nickname: raw.nickname
        ? String(raw.nickname).slice(0, 60)
        : raw.user?.nickname
        ? String(raw.user.nickname).slice(0, 60)
        : undefined,
      rawEventType: raw.rawEventType,
      displayType: raw.displayType ? String(raw.displayType).slice(0, 80) : undefined,
      msgId: cleanMsgId,
      timestamp: raw.timestamp || new Date().toISOString(),
    };

    this.callbacks.onFollowEvent?.(normalized);
    return { accepted: true, follow: normalized };
  }

  /**
   * Normalizes incoming gift payloads from the Node.js relay server and guarantees
   * that rapid TikTok gift streaks (`giftType === 1 && repeatEnd !== true`) only emit a single
   * finalized prayer event once `repeatEnd === true` confirms completion with the accurate
   * final quantity and unit coin value.
   */
  ingestRawGiftEvent(raw: RawGiftInput): {
    accepted: boolean;
    buffered: boolean;
    finalized?: TikTokRelayGiftPayload;
  } {
    const cleanSseId = raw.sseEventId ? String(raw.sseEventId).trim() : '';
    if (cleanSseId && this.markSseEventSeen(cleanSseId)) {
      return { accepted: false, buffered: false };
    }

    const cleanUser = sanitizeUsername(
      raw.username ||
        raw.uniqueId ||
        raw.user?.uniqueId ||
        raw.nickname ||
        raw.user?.nickname ||
        'tiktok_izleyici'
    );
    const rawUid = raw.userId ?? raw.user?.userId;
    const cleanUserId =
      rawUid !== undefined && rawUid !== null && String(rawUid).trim()
        ? String(rawUid).trim().slice(0, 64)
        : undefined;
    const cleanGiftName = sanitizeGiftName(raw.giftName || 'Hediye');
    const cleanGiftId = String(raw.giftId || cleanGiftName.toLowerCase()).slice(0, 64);
    const qty = Math.max(
      1,
      Math.min(999, Math.floor(Number(raw.repeatCount ?? raw.quantity ?? 1) || 1))
    );

    const giftType = typeof raw.giftType === 'number' ? raw.giftType : undefined;
    const repeatEnd = raw.repeatEnd;
    const isStreakable = giftType === 1;
    const isStreakInProgress = isStreakable && repeatEnd !== true;

    const explicitEventId =
      raw.eventId !== undefined && raw.eventId !== null && String(raw.eventId).trim()
        ? String(raw.eventId).trim()
        : undefined;
    if (!isStreakInProgress && explicitEventId && this.finalizedGiftEventIds.has(explicitEventId)) {
      return { accepted: false, buffered: false };
    }

    const userBucket = cleanUserId ? `uid_${cleanUserId}` : cleanUser.toLowerCase();
    const comboBucket = `${userBucket}:${cleanGiftId}`;

    let streakKey = raw.streakKey && String(raw.streakKey).trim() ? String(raw.streakKey).trim() : '';
    if (!streakKey && raw.groupId) {
      streakKey = `${comboBucket}:${String(raw.groupId).trim()}`;
    }
    if (!streakKey) {
      const existingComboKey = this.activeStreakKeys.get(comboBucket);
      if (existingComboKey) {
        const pendingExisting = this.pendingStreaks.get(existingComboKey);
        if (pendingExisting && pendingExisting.timedOut && qty < pendingExisting.gift.quantity) {
          if (pendingExisting.flushTimer !== null) globalThis.clearTimeout(pendingExisting.flushTimer);
          if (pendingExisting.gcTimer !== null) globalThis.clearTimeout(pendingExisting.gcTimer);
          this.pendingStreaks.delete(existingComboKey);
          this.activeStreakKeys.delete(comboBucket);
        } else {
          streakKey = existingComboKey;
        }
      }
      if (!streakKey) {
        this.localStreakSeq += 1;
        streakKey = `${comboBucket}:c${this.localStreakSeq}_${raw.eventId || Date.now()}`;
        if (isStreakInProgress) {
          this.activeStreakKeys.set(comboBucket, streakKey);
        }
      }
    }

    if (this.finalizedStreakKeys.has(streakKey)) {
      return { accepted: false, buffered: false };
    }

    const rawUnit = Number(raw.unitCoins);
    const rawDiamond = Number(raw.diamondCount);
    const resolvedUnitCoins =
      Number.isFinite(rawUnit) && rawUnit > 0
        ? rawUnit
        : Number.isFinite(rawDiamond) && rawDiamond > 0
        ? rawDiamond
        : undefined;

    const normalized: TikTokRelayGiftPayload = {
      eventId: String(raw.eventId || `tk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      sseEventId: raw.sseEventId,
      isSimulated: raw.isSimulated,
      replayed: raw.replayed,
      streakKey,
      userId: cleanUserId,
      username: cleanUser,
      nickname: raw.nickname
        ? String(raw.nickname).slice(0, 60)
        : raw.user?.nickname
        ? String(raw.user.nickname).slice(0, 60)
        : undefined,
      giftId: cleanGiftId,
      giftName: cleanGiftName,
      quantity: qty,
      unitCoins: resolvedUnitCoins,
      unitCoinsSource: raw.unitCoinsSource,
      diamondCount: resolvedUnitCoins ?? (typeof raw.diamondCount === 'number' ? raw.diamondCount : undefined),
      giftType,
      repeatCount: qty,
      repeatEnd,
      rawMeta: raw.rawMeta,
      timestamp: raw.timestamp || new Date().toISOString(),
    };

    if (isStreakInProgress) {
      const existing = this.pendingStreaks.get(streakKey);
      if (existing) {
        if (existing.flushTimer !== null) globalThis.clearTimeout(existing.flushTimer);
        if (existing.gcTimer !== null) globalThis.clearTimeout(existing.gcTimer);
      }
      const bestUnitCoins = normalized.unitCoins ?? existing?.gift.unitCoins;
      const nextGift: TikTokRelayGiftPayload = existing
        ? {
            ...normalized,
            userId: normalized.userId || existing.gift.userId,
            unitCoins: bestUnitCoins,
            unitCoinsSource: normalized.unitCoins ? normalized.unitCoinsSource : existing.gift.unitCoinsSource,
            diamondCount: bestUnitCoins ?? normalized.diamondCount,
            quantity: Math.max(existing.gift.quantity, normalized.quantity),
            repeatCount: Math.max(existing.gift.quantity, normalized.quantity),
          }
        : normalized;

      const entry: PendingStreakEntry = {
        gift: nextGift,
        comboBucket,
        timedOut: false,
        flushTimer: null,
        gcTimer: null,
      };

      // IMPORTANT: Never emit an unconfirmed incomplete streak as repeatEnd: true on timeout.
      entry.flushTimer = globalThis.setTimeout(() => {
        const pending = this.pendingStreaks.get(streakKey);
        if (!pending) return;
        pending.timedOut = true;
        pending.flushTimer = null;
        pending.gcTimer = globalThis.setTimeout(() => {
          const current = this.pendingStreaks.get(streakKey);
          if (current === pending) {
            this.pendingStreaks.delete(streakKey);
            if (this.activeStreakKeys.get(comboBucket) === streakKey) {
              this.activeStreakKeys.delete(comboBucket);
            }
          }
        }, this.options.streakGcMs);
        (pending.gcTimer as { unref?: () => void })?.unref?.();
      }, this.options.streakTimeoutMs);
      (entry.flushTimer as { unref?: () => void })?.unref?.();

      this.pendingStreaks.set(streakKey, entry);
      return { accepted: true, buffered: true };
    }

    // Completed streak (`repeatEnd === true`) or non-streakable single gift
    if (this.activeStreakKeys.get(comboBucket) === streakKey) {
      this.activeStreakKeys.delete(comboBucket);
    }

    const existing = this.pendingStreaks.get(streakKey);
    if (existing) {
      if (existing.flushTimer !== null) globalThis.clearTimeout(existing.flushTimer);
      if (existing.gcTimer !== null) globalThis.clearTimeout(existing.gcTimer);
      this.pendingStreaks.delete(streakKey);
      const finalQty = Math.max(existing.gift.quantity, normalized.quantity);
      const bestUnitCoins = normalized.unitCoins ?? existing.gift.unitCoins;
      const finalized: TikTokRelayGiftPayload = {
        ...normalized,
        userId: normalized.userId || existing.gift.userId,
        unitCoins: bestUnitCoins,
        unitCoinsSource: normalized.unitCoins ? normalized.unitCoinsSource : existing.gift.unitCoinsSource,
        diamondCount: bestUnitCoins ?? normalized.diamondCount,
        quantity: finalQty,
        repeatCount: finalQty,
        repeatEnd: true,
      };
      this.finalizeGift(finalized, explicitEventId);
      return { accepted: true, buffered: false, finalized };
    }

    this.finalizeGift(normalized, explicitEventId);
    return { accepted: true, buffered: false, finalized: normalized };
  }

  private scheduleReconnect(cleanHandle: string, reason: string): void {
    if (this.manualDisconnect) return;
    if (this.reconnectTimer !== null) return;

    if (!this.config.autoReconnect || this.retryCount >= this.config.maxRetries) {
      const exhaustedMsg =
        this.config.maxRetries > 0 && this.retryCount >= this.config.maxRetries
          ? `${reason} (Maksimum ${this.config.maxRetries} yeniden deneme sınırına ulaşıldı.)`
          : `${reason}.`;
      this.emitStatus('error', exhaustedMsg);
      this.callbacks.onLog?.('error', exhaustedMsg);
      return;
    }

    this.retryCount += 1;
    const baseMs = Math.max(2, this.config.retryDelaySec || 5) * 1000;
    const delayMs = Math.min(this.options.maxBackoffMs, baseMs * Math.pow(2, this.retryCount - 1));
    const msg = `${reason}. ${Math.round(delayMs / 1000)} sn sonra yeniden deneniyor (${this.retryCount}/${this.config.maxRetries})...`;

    this.emitStatus('connecting', msg);
    this.callbacks.onLog?.('warning', msg);

    const useSimStream = this.simulationStreamMode;
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualDisconnect) return;
      if (useSimStream) {
        this.connectSimulationStream(cleanHandle);
      } else {
        void this.connect(cleanHandle);
      }
    }, delayMs);
    (this.reconnectTimer as { unref?: () => void })?.unref?.();
  }

  private openRelayEventStream(baseUrl: string, cleanHandle: string, isSimulationOnly = false): void {
    if (typeof EventSource === 'undefined') {
      this.emitStatus('error', 'Bu ortam EventSource (SSE) akışını desteklemiyor.');
      return;
    }

    const lastId = this.getLastEventId(baseUrl, cleanHandle);
    const streamUrl =
      `${baseUrl}/events?username=${encodeURIComponent(cleanHandle)}` +
      (lastId ? `&lastEventId=${encodeURIComponent(lastId)}` : '');

    const es = new EventSource(streamUrl);
    this.eventSource = es;
    let sseOpened = false;

    const armStabilityReset = () => {
      if (this.stableConnectionTimer !== null) return;
      if (this.options.stabilityResetMs <= 0) {
        this.retryCount = 0;
        return;
      }
      this.stableConnectionTimer = globalThis.setTimeout(() => {
        this.stableConnectionTimer = null;
        if (this.eventSource === es && !this.manualDisconnect && sseOpened) {
          this.retryCount = 0;
        }
      }, this.options.stabilityResetMs);
      (this.stableConnectionTimer as { unref?: () => void })?.unref?.();
    };

    es.onopen = () => {
      if (this.eventSource !== es || this.manualDisconnect) return;
      sseOpened = true;
      armStabilityReset();
    };

    es.addEventListener('recovery_gap', (ev) => {
      const msgEv = ev as MessageEvent;
      if (msgEv.lastEventId) {
        this.rememberLastEventId(baseUrl, cleanHandle, msgEv.lastEventId);
      }
      try {
        const gap = JSON.parse(msgEv.data) as TikTokRecoveryGapInfo;
        const resolvedId = msgEv.lastEventId || gap.sseEventId;
        if (resolvedId) {
          this.rememberLastEventId(baseUrl, cleanHandle, resolvedId);
        }
        this.callbacks.onRecoveryGap?.({
          ...gap,
          sseEventId: resolvedId,
        });
        this.callbacks.onLog?.('warning', gap.message);
      } catch {
        // ignore malformed recovery_gap frame
      }
    });

    es.addEventListener('status', (ev) => {
      const msgEv = ev as MessageEvent;
      if (msgEv.lastEventId) {
        this.rememberLastEventId(baseUrl, cleanHandle, msgEv.lastEventId);
      }
      try {
        const data = JSON.parse(msgEv.data) as Partial<TikTokConnectorStatusPayload>;
        if (data.sseEventId) {
          this.rememberLastEventId(baseUrl, cleanHandle, data.sseEventId);
        }
        const nextState = data.state || 'disconnected';
        if (nextState === 'connected') {
          this.hadConnectedSession = true;
          sseOpened = true;
          armStabilityReset();
        }

        if (!isSimulationOnly) {
          this.emitStatus(nextState, data.error || null, {
            roomId: data.roomId ?? null,
            viewerCount: typeof data.viewerCount === 'number' ? data.viewerCount : null,
          });

          // Controlled reconnect when an active TikTok stream drops/ends cleanly via status event
          if (
            !this.manualDisconnect &&
            this.config.autoReconnect &&
            this.hadConnectedSession &&
            (nextState === 'disconnected' || nextState === 'error')
          ) {
            this.hadConnectedSession = false;
            if (this.stableConnectionTimer !== null) {
              globalThis.clearTimeout(this.stableConnectionTimer);
              this.stableConnectionTimer = null;
            }
            es.close();
            if (this.eventSource === es) {
              this.eventSource = null;
            }
            this.scheduleReconnect(cleanHandle, data.error || 'TikTok canlı yayını kesildi');
          }
        }
      } catch {
        // ignore malformed status frames
      }
    });

    es.addEventListener('gift', (ev) => {
      const msgEv = ev as MessageEvent;
      try {
        const rawGift = JSON.parse(msgEv.data) as RawGiftInput;
        const resolvedSseId = msgEv.lastEventId || rawGift.sseEventId;
        if (resolvedSseId) {
          this.rememberLastEventId(baseUrl, cleanHandle, resolvedSseId);
        }
        if (sseOpened) {
          this.retryCount = 0;
        }
        this.ingestRawGiftEvent({
          ...rawGift,
          sseEventId: resolvedSseId,
        });
      } catch {
        this.callbacks.onLog?.('warning', 'Relay sunucusundan geçersiz hediye verisi alındı.');
      }
    });

    es.addEventListener('follow', (ev) => {
      const msgEv = ev as MessageEvent;
      try {
        const rawFollow = JSON.parse(msgEv.data) as RawFollowInput;
        const resolvedSseId = msgEv.lastEventId || rawFollow.sseEventId;
        if (resolvedSseId) {
          this.rememberLastEventId(baseUrl, cleanHandle, resolvedSseId);
        }
        if (sseOpened) {
          this.retryCount = 0;
        }
        this.ingestRawFollowEvent({
          ...rawFollow,
          sseEventId: resolvedSseId,
        });
      } catch {
        this.callbacks.onLog?.('warning', 'Relay sunucusundan geçersiz takipçi verisi alındı.');
      }
    });

    es.onerror = () => {
      if (this.manualDisconnect) return;
      if (this.stableConnectionTimer !== null) {
        globalThis.clearTimeout(this.stableConnectionTimer);
        this.stableConnectionTimer = null;
      }
      es.close();
      if (this.eventSource === es) {
        this.eventSource = null;
      }
      this.scheduleReconnect(cleanHandle, 'TikTok relay SSE bağlantısı koptu');
    };
  }

  /**
   * Opens only the SSE event listener (without calling POST /connect to TikTok WebCast)
   * for isolated Relay POST /simulate testing when no real live stream is running.
   */
  connectSimulationStream(username: string): { ok: boolean; error?: string } {
    this.manualDisconnect = false;
    this.simulationStreamMode = true;
    this.hadConnectedSession = false;
    this.clearTimersAndStreams();

    const cleanHandle = sanitizeTikTokHandle(username || this.config.username) || 'fcproplayer7';
    this.activeHandle = cleanHandle;
    const baseUrl = normalizeRelayBaseUrl(this.config.connectorEndpoint);
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      const msg = 'Simülasyon SSE akışı için geçerli bir Relay URL (http:// veya https://) gereklidir.';
      return { ok: false, error: msg };
    }

    this.openRelayEventStream(baseUrl, cleanHandle, true);
    this.callbacks.onLog?.(
      'info',
      `Simülasyon SSE test akışı başlatıldı (@${cleanHandle} — gerçek TikTok bağlantısı açılmadı).`
    );
    return { ok: true };
  }

  stopSimulationStream(): void {
    this.manualDisconnect = true;
    this.simulationStreamMode = false;
    this.retryCount = 0;
    this.clearTimersAndStreams();
    this.clearPendingStreaks();
  }

  async connect(username: string): Promise<{ ok: boolean; error?: string }> {
    this.manualDisconnect = false;
    this.simulationStreamMode = false;
    this.hadConnectedSession = false;
    this.clearTimersAndStreams();

    const cleanHandle = sanitizeTikTokHandle(username || this.config.username);
    this.activeHandle = cleanHandle;
    if (!cleanHandle) {
      const msg = 'Bağlantı denemesi için geçerli bir TikTok @kullanıcıadı girin (örn. fcproplayer7).';
      this.emitStatus('error', msg, { roomId: null, viewerCount: null });
      return { ok: false, error: msg };
    }

    const baseUrl = normalizeRelayBaseUrl(this.config.connectorEndpoint);
    if (!baseUrl) {
      const msg =
        'TikTok LIVE Relay Sunucusu henüz yapılandırılmadı (Not Configured). Gerçek bağlantı için harici Node.js relay URL adresini girin.';
      this.emitStatus('unconfigured', msg, { roomId: null, viewerCount: null });
      return { ok: false, error: msg };
    }

    if (!/^https?:\/\//i.test(baseUrl)) {
      const msg = 'Relay URL http:// veya https:// ile başlamalıdır.';
      this.emitStatus('error', msg, { roomId: null, viewerCount: null });
      return { ok: false, error: msg };
    }

    this.emitStatus('connecting', null, { roomId: null, viewerCount: null });

    const connectUrl = `${baseUrl}/connect`;

    try {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), this.options.connectTimeoutMs);
      const response = await fetch(connectUrl, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ username: cleanHandle }),
        signal: controller.signal,
      });
      globalThis.clearTimeout(timeout);

      const rawText = await response.text();
      let payload: {
        ok?: boolean;
        state?: TikTokConnectionState;
        roomId?: string | null;
        viewerCount?: number | null;
        initialEventCursor?: string;
        error?: string;
      } = {};
      if (rawText.trim()) {
        try {
          payload = JSON.parse(rawText) as typeof payload;
        } catch {
          // non-JSON response handled below
        }
      }

      if (!response.ok || !payload.ok) {
        const errMsg =
          response.status === 404
            ? `Relay sunucusu HTTP 404 döndürdü (İstek: POST ${connectUrl}${payload.error ? ` — ${payload.error}` : ''}). Relay URL alanında yalnızca ana adresi (örn. https://nur-i-dua.onrender.com) girdiğinizden ve sunucuda POST /connect uç noktasının yayında olduğundan emin olun.`
            : payload.error ||
              `Relay sunucusu HTTP ${response.status} döndürdü (${connectUrl}). Yayın (@${cleanHandle}) çevrimdışı veya ulaşılamıyor.`;
        this.emitStatus(payload.state === 'disconnected' ? 'disconnected' : 'error', errMsg, {
          roomId: null,
          viewerCount: null,
        });
        return { ok: false, error: errMsg };
      }

      if (payload.state !== 'connected') {
        const errMsg =
          payload.error ||
          'Relay sunucusu gerçek TikTok canlı oda el sıkışmasını doğrulamadı.';
        this.emitStatus(payload.state || 'disconnected', errMsg);
        return { ok: false, error: errMsg };
      }

      // Seed initial SSE cursor from /connect if client has no prior Last-Event-ID,
      // guaranteeing events arriving during the short handshake-to-SSE window are replayed.
      if (!this.getLastEventId(baseUrl, cleanHandle) && payload.initialEventCursor) {
        this.rememberLastEventId(baseUrl, cleanHandle, payload.initialEventCursor);
      }

      // Note: Do NOT reset `this.retryCount = 0` here; reset only once SSE stream opens and stabilizes.
      this.hadConnectedSession = true;
      this.emitStatus('connected', null, {
        roomId: payload.roomId ?? null,
        viewerCount: typeof payload.viewerCount === 'number' ? payload.viewerCount : null,
      });
      this.openRelayEventStream(baseUrl, cleanHandle, false);
      this.callbacks.onLog?.(
        'info',
        `TikTok LIVE bağlantısı kuruldu: @${cleanHandle}${payload.roomId ? ` (Oda: ${payload.roomId})` : ''}.`
      );
      return { ok: true };
    } catch (err) {
      const msg =
        err instanceof Error
          ? `Node.js TikTok relay sunucusuna ulaşılamadı (${connectUrl}): ${err.message}`
          : `Node.js TikTok relay sunucusuna ulaşılamadı (${connectUrl}).`;
      this.emitStatus('error', msg, { roomId: null, viewerCount: null });
      return { ok: false, error: msg };
    }
  }

  async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    this.simulationStreamMode = false;
    this.hadConnectedSession = false;
    this.retryCount = 0;
    this.clearTimersAndStreams();
    // Never finalize incomplete pending streaks as completed on disconnect!
    this.clearPendingStreaks();

    const baseUrl = normalizeRelayBaseUrl(this.config.connectorEndpoint);
    if (baseUrl) {
      try {
        const controller = new AbortController();
        const timeout = globalThis.setTimeout(() => controller.abort(), this.options.disconnectTimeoutMs);
        await fetch(`${baseUrl}/disconnect`, {
          method: 'POST',
          mode: 'cors',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            username: sanitizeTikTokHandle(this.config.username) || this.activeHandle || 'fcproplayer7',
          }),
          signal: controller.signal,
        });
        globalThis.clearTimeout(timeout);
      } catch {
        // Ignore network failure during explicit local disconnect
      }
      this.emitStatus('disconnected', null, { roomId: null, viewerCount: null });
    } else {
      this.emitStatus('unconfigured', null, { roomId: null, viewerCount: null });
    }
  }

  dispose(): void {
    this.manualDisconnect = true;
    this.simulationStreamMode = false;
    this.hadConnectedSession = false;
    this.clearTimersAndStreams();
    this.clearPendingStreaks();
  }
}
