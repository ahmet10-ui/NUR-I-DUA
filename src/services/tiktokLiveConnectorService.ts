import {
  ITikTokGiftAdapter,
  TikTokConnectionConfig,
  TikTokConnectionState,
  TikTokConnectorStatusPayload,
  TikTokRelayGiftPayload,
} from '../types/nuridua';
import { sanitizeGiftName, sanitizeTikTokHandle, sanitizeUsername } from '../utils/sanitize';

export interface TikTokConnectorCallbacks {
  onStatusChange?: (payload: TikTokConnectorStatusPayload) => void;
  onFinalizedGift?: (gift: TikTokRelayGiftPayload) => void;
  onLog?: (level: 'info' | 'warning' | 'error', message: string) => void;
}

interface PendingStreakEntry {
  gift: TikTokRelayGiftPayload;
  flushTimer: ReturnType<typeof setTimeout>;
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
        .replace(/\/(connect|disconnect|events|health|tiktok-connect|status)$/i, '')
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
  private status: TikTokConnectionState = 'unconfigured';
  private roomId: string | null = null;
  private viewerCount: number | null = null;
  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private manualDisconnect = false;

  // Streak aggregation & duplicate protection
  private pendingStreaks = new Map<string, PendingStreakEntry>();
  private finalizedStreakKeys = new Map<string, number>();

  constructor(config: TikTokConnectionConfig, callbacks: TikTokConnectorCallbacks = {}) {
    this.config = { ...config };
    this.callbacks = callbacks;
    this.status = this.isConfigured ? 'disconnected' : 'unconfigured';
  }

  get isConfigured(): boolean {
    return normalizeRelayBaseUrl(this.config.connectorEndpoint).length > 0;
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
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
    }
  }

  private flushAllPendingStreaks(): void {
    for (const [key, entry] of this.pendingStreaks.entries()) {
      globalThis.clearTimeout(entry.flushTimer);
      this.pendingStreaks.delete(key);
      this.finalizeGift(entry.gift);
    }
  }

  private pruneFinalizedCache(): void {
    if (this.finalizedStreakKeys.size <= 400) return;
    const cutoff = Date.now() - 120_000;
    for (const [k, ts] of this.finalizedStreakKeys.entries()) {
      if (ts < cutoff) this.finalizedStreakKeys.delete(k);
    }
  }

  private finalizeGift(gift: TikTokRelayGiftPayload): void {
    if (this.finalizedStreakKeys.has(gift.streakKey)) {
      return;
    }
    this.finalizedStreakKeys.set(gift.streakKey, Date.now());
    this.pruneFinalizedCache();
    this.callbacks.onFinalizedGift?.(gift);
  }

  /**
   * Normalizes incoming gift payloads from the Node.js relay server and guarantees
   * that rapid TikTok gift streaks (`giftType === 1 && !repeatEnd`) only emit a single
   * finalized prayer event once the streak completes with the accurate final quantity.
   */
  ingestRawGiftEvent(raw: Partial<TikTokRelayGiftPayload>): {
    accepted: boolean;
    buffered: boolean;
    finalized?: TikTokRelayGiftPayload;
  } {
    const cleanUser = sanitizeUsername(raw.username || raw.nickname || 'tiktok_izleyici');
    const cleanGiftName = sanitizeGiftName(raw.giftName || 'Hediye');
    const cleanGiftId = String(raw.giftId || cleanGiftName.toLowerCase()).slice(0, 64);
    const qty = Math.max(
      1,
      Math.min(999, Math.floor(Number(raw.repeatCount ?? raw.quantity ?? 1) || 1))
    );
    const streakKey =
      (raw.streakKey && String(raw.streakKey).trim()) ||
      `${cleanUser.toLowerCase()}:${cleanGiftId}:${raw.eventId || Date.now()}`;

    if (this.finalizedStreakKeys.has(streakKey)) {
      return { accepted: false, buffered: false };
    }

    const normalized: TikTokRelayGiftPayload = {
      eventId: String(raw.eventId || `tk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      streakKey,
      username: cleanUser,
      nickname: raw.nickname ? String(raw.nickname).slice(0, 60) : undefined,
      giftId: cleanGiftId,
      giftName: cleanGiftName,
      quantity: qty,
      diamondCount: typeof raw.diamondCount === 'number' ? raw.diamondCount : undefined,
      giftType: typeof raw.giftType === 'number' ? raw.giftType : undefined,
      repeatCount: qty,
      repeatEnd: raw.repeatEnd,
      timestamp: raw.timestamp || new Date().toISOString(),
    };

    const isStreakable = normalized.giftType === 1;
    const isStreakInProgress = isStreakable && normalized.repeatEnd === false;

    if (isStreakInProgress) {
      const existing = this.pendingStreaks.get(streakKey);
      if (existing) {
        globalThis.clearTimeout(existing.flushTimer);
      }
      const nextGift: TikTokRelayGiftPayload = existing
        ? {
            ...normalized,
            quantity: Math.max(existing.gift.quantity, normalized.quantity),
            repeatCount: Math.max(existing.gift.quantity, normalized.quantity),
          }
        : normalized;

      const flushTimer = globalThis.setTimeout(() => {
        const pending = this.pendingStreaks.get(streakKey);
        if (!pending) return;
        this.pendingStreaks.delete(streakKey);
        this.finalizeGift({ ...pending.gift, repeatEnd: true });
      }, 4500);

      this.pendingStreaks.set(streakKey, { gift: nextGift, flushTimer });
      return { accepted: true, buffered: true };
    }

    // Either streak finished (`repeatEnd === true`) or non-streakable single gift
    const existing = this.pendingStreaks.get(streakKey);
    if (existing) {
      globalThis.clearTimeout(existing.flushTimer);
      this.pendingStreaks.delete(streakKey);
      const finalQty = Math.max(existing.gift.quantity, normalized.quantity);
      const finalized = {
        ...normalized,
        quantity: finalQty,
        repeatCount: finalQty,
        repeatEnd: true,
      };
      this.finalizeGift(finalized);
      return { accepted: true, buffered: false, finalized };
    }

    this.finalizeGift(normalized);
    return { accepted: true, buffered: false, finalized: normalized };
  }

  private openRelayEventStream(baseUrl: string, cleanHandle: string): void {
    if (typeof EventSource === 'undefined') {
      this.emitStatus('error', 'Bu ortam EventSource (SSE) akışını desteklemiyor.');
      return;
    }

    const streamUrl = `${baseUrl}/events?username=${encodeURIComponent(cleanHandle)}`;
    const es = new EventSource(streamUrl);
    this.eventSource = es;

    es.addEventListener('status', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as Partial<TikTokConnectorStatusPayload>;
        const nextState = data.state || 'disconnected';
        if (nextState === 'connected') {
          this.retryCount = 0;
        }
        this.emitStatus(nextState, data.error || null, {
          roomId: data.roomId ?? null,
          viewerCount: typeof data.viewerCount === 'number' ? data.viewerCount : null,
        });
      } catch {
        // ignore malformed status frames
      }
    });

    es.addEventListener('gift', (ev) => {
      try {
        const rawGift = JSON.parse((ev as MessageEvent).data) as Partial<TikTokRelayGiftPayload>;
        this.ingestRawGiftEvent(rawGift);
      } catch {
        this.callbacks.onLog?.('warning', 'Relay sunucusundan geçersiz hediye verisi alındı.');
      }
    });

    es.onerror = () => {
      if (this.manualDisconnect) return;
      es.close();
      if (this.eventSource === es) {
        this.eventSource = null;
      }

      if (this.config.autoReconnect && this.retryCount < this.config.maxRetries) {
        this.retryCount++;
        const delayMs = Math.max(2, this.config.retryDelaySec || 5) * 1000;
        const msg = `TikTok relay bağlantısı koptu. ${Math.round(delayMs / 1000)} sn sonra yeniden deneniyor (${this.retryCount}/${this.config.maxRetries})...`;
        this.emitStatus('connecting', msg);
        this.callbacks.onLog?.('warning', msg);
        this.reconnectTimer = globalThis.setTimeout(() => {
          void this.connect(cleanHandle);
        }, delayMs);
      } else {
        const msg = 'TikTok LIVE relay akışı kesildi.';
        this.emitStatus('error', msg);
        this.callbacks.onLog?.('error', msg);
      }
    };
  }

  async connect(username: string): Promise<{ ok: boolean; error?: string }> {
    this.manualDisconnect = false;
    this.clearTimersAndStreams();

    const cleanHandle = sanitizeTikTokHandle(username || this.config.username);
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
      const timeout = globalThis.setTimeout(() => controller.abort(), 25000);
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

      this.retryCount = 0;
      this.emitStatus('connected', null, {
        roomId: payload.roomId ?? null,
        viewerCount: typeof payload.viewerCount === 'number' ? payload.viewerCount : null,
      });
      this.openRelayEventStream(baseUrl, cleanHandle);
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
    this.retryCount = 0;
    this.clearTimersAndStreams();
    this.flushAllPendingStreaks();

    const baseUrl = normalizeRelayBaseUrl(this.config.connectorEndpoint);
    if (baseUrl) {
      try {
        await fetch(`${baseUrl}/disconnect`, {
          method: 'POST',
          mode: 'cors',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            username: sanitizeTikTokHandle(this.config.username) || 'fcproplayer7',
          }),
        });
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
    this.clearTimersAndStreams();
    for (const entry of this.pendingStreaks.values()) {
      globalThis.clearTimeout(entry.flushTimer);
    }
    this.pendingStreaks.clear();
  }
}
