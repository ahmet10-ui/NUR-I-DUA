import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createDefaultAppState, PRAYER_CATEGORIES, SAMPLE_TIKTOK_USERNAMES } from '../data/defaults';
import {
  clearLocalState,
  fetchServerState,
  loadLocalState,
  notifyLocalChannelState,
  pushLivePlayback,
  pushServerState,
  saveLocalState,
  subscribeToStudioSync,
} from '../services/syncClient';
import { TikTokLiveConnectorService } from '../services/tiktokLiveConnectorService';
import {
  AvailableVoice,
  browserTTSProvider,
  getAvailableSpeechVoices,
  getScholarProsody,
  resolveScholarVoiceURI,
  serverNeuralTTSProvider,
  studioTTSRouter,
} from '../services/ttsService';
import {
  AppState,
  BroadcastSettingsConfig,
  EventSource,
  GiftRule,
  PrayerCategoryId,
  PrayerTemplate,
  QueueEvent,
  ScholarId,
  ScholarSettingsConfig,
  SystemLogEntry,
  TikTokConnectionConfig,
  VoiceSettingsConfig,
} from '../types/nuridua';
import {
  createUniqueId,
  renderPersonalizedPrayer,
  sanitizeGiftName,
  sanitizePrayerTemplate,
  sanitizeTikTokHandle,
  sanitizeUsername,
} from '../utils/sanitize';

type MouthListener = (level: number) => void;

interface EnqueueResult {
  ok: boolean;
  reason?: string;
  event?: QueueEvent;
}

interface StudioContextValue {
  state: AppState;
  activeEvent: QueueEvent | null;
  speakingState: 'idle' | 'speaking' | 'holding';
  isSpeechPaused: boolean;
  availableVoices: AvailableVoice[];
  voiceLoadStatus: 'loading' | 'ready' | 'empty' | 'unsupported';
  voiceLoadError: string | null;
  lastSpeechError: string | null;
  hasUserGesture: boolean;
  unlockAudioByGesture: () => void;
  refreshVoices: () => void;
  subscribeMouthLevel: (fn: MouthListener) => () => void;

  // Prayer CRUD
  addPrayer: (input: { title: string; category: PrayerCategoryId; template: string; isActive: boolean }) => void;
  updatePrayer: (id: string, patch: Partial<Omit<PrayerTemplate, 'id' | 'createdAt'>>) => void;
  deletePrayer: (id: string) => void;
  togglePrayerActive: (id: string) => void;
  pickRandomPrayer: (category: PrayerCategoryId) => PrayerTemplate | null;

  // Gift CRUD
  addGift: (input: Omit<GiftRule, 'id' | 'updatedAt'>) => void;
  updateGift: (id: string, patch: Partial<Omit<GiftRule, 'id'>>) => void;
  deleteGift: (id: string) => void;
  toggleGiftEnabled: (id: string) => void;

  // Queue & Playback
  enqueueGiftEvent: (params: {
    source: EventSource;
    username?: string;
    giftIdOrName?: string;
    displayGiftName?: string;
    quantity?: number;
    externalDedupeKey?: string;
  }) => EnqueueResult;
  simulateSampleCayGift: () => EnqueueResult;
  toggleQueuePause: () => void;
  pauseSpeech: () => void;
  resumeSpeech: () => void;
  stopCurrentSpeech: () => void;
  removeQueueItem: (id: string) => void;
  retryQueueItem: (id: string) => void;
  clearQueue: () => void;
  clearHistory: () => void;

  // Settings updates
  updateScholarsConfig: (patch: Partial<ScholarSettingsConfig>) => void;
  updateScholarProfile: (id: ScholarId, patch: Partial<ScholarSettingsConfig['profiles'][ScholarId]>) => void;
  updateVoiceConfig: (patch: Partial<VoiceSettingsConfig>) => void;
  testVoicePlayback: (sampleText: string, scholarId?: ScholarId) => void;
  testSystemTurkishSpeech: (scholarId?: ScholarId) => void;
  testServerNeuralPlayback: (
    sampleText: string,
    scholarId?: ScholarId
  ) => Promise<{ ok: boolean; message: string }>;
  updateTikTokConfig: (patch: Partial<TikTokConnectionConfig>) => void;
  attemptTikTokConnect: () => Promise<{ ok: boolean; error?: string }>;
  disconnectTikTok: () => void | Promise<void>;
  updateBroadcastConfig: (patch: Partial<BroadcastSettingsConfig>) => void;
  addLog: (level: SystemLogEntry['level'], source: SystemLogEntry['source'], message: string) => void;
  resetAllDefaults: () => void;
  importStateJson: (jsonText: string) => { ok: boolean; error?: string };
}

const StudioContext = createContext<StudioContextValue | null>(null);

function dedupeEventsById(events: QueueEvent[]): QueueEvent[] {
  const seen = new Set<string>();
  const unique: QueueEvent[] = [];
  for (const ev of events) {
    if (!ev || !ev.id || seen.has(ev.id)) continue;
    seen.add(ev.id);
    unique.push(ev);
  }
  return unique;
}

function recoverInitialState(): AppState {
  const defaults = createDefaultAppState();
  const saved = loadLocalState();
  if (!saved) return defaults;

  const uniqueHistory = Array.isArray(saved.history) ? dedupeEventsById(saved.history) : [];
  const historyIds = new Set(uniqueHistory.map((h) => h.id));

  // Recover any interrupted 'speaking' queue items back to 'pending' so events are never lost,
  // while excluding any IDs already finalized in history.
  const recoveredQueue = Array.isArray(saved.queue)
    ? dedupeEventsById(
        saved.queue
          .filter((item) => item && !historyIds.has(item.id))
          .map((item) =>
            item.status === 'speaking' ? { ...item, status: 'pending' as const } : item
          )
      )
    : [];

  return {
    ...defaults,
    ...saved,
    prayers: Array.isArray(saved.prayers) && saved.prayers.length > 0 ? saved.prayers : defaults.prayers,
    gifts: Array.isArray(saved.gifts) && saved.gifts.length > 0 ? saved.gifts : defaults.gifts,
    queue: recoveredQueue,
    history: uniqueHistory,
    scholars: {
      ...defaults.scholars,
      ...(saved.scholars || {}),
      profiles: {
        scholar_1: { ...defaults.scholars.profiles.scholar_1, ...(saved.scholars?.profiles?.scholar_1 || {}) },
        scholar_2: { ...defaults.scholars.profiles.scholar_2, ...(saved.scholars?.profiles?.scholar_2 || {}) },
      },
    },
    voice: { ...defaults.voice, ...(saved.voice || {}) },
    tiktok: {
      ...defaults.tiktok,
      ...(saved.tiktok || {}),
      username: sanitizeTikTokHandle(saved.tiktok?.username || '') || defaults.tiktok.username,
      // Never auto-claim connected state from stale cache
      connectionState: saved.tiktok?.connectorEndpoint?.trim() ? 'disconnected' : 'unconfigured',
      roomId: null,
      viewerCount: null,
    },
    broadcast: { ...defaults.broadcast, ...(saved.broadcast || {}) },
    logs: Array.isArray(saved.logs) ? saved.logs : defaults.logs,
    stats: { ...defaults.stats, ...(saved.stats || {}) },
  };
}

export const StudioProvider: React.FC<{ children: React.ReactNode; isBroadcastView?: boolean }> = ({
  children,
  isBroadcastView = false,
}) => {
  const [state, setState] = useState<AppState>(() => recoverInitialState());
  const [activeEvent, setActiveEvent] = useState<QueueEvent | null>(null);
  const [speakingState, setSpeakingState] = useState<'idle' | 'speaking' | 'holding'>('idle');
  const [isSpeechPaused, setIsSpeechPaused] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<AvailableVoice[]>(() => getAvailableSpeechVoices());
  const [voiceLoadStatus, setVoiceLoadStatus] = useState<'loading' | 'ready' | 'empty' | 'unsupported'>(() => {
    if (!browserTTSProvider.isSupported()) return 'unsupported';
    return getAvailableSpeechVoices().length > 0 ? 'ready' : 'loading';
  });
  const [voiceLoadError, setVoiceLoadError] = useState<string | null>(() =>
    browserTTSProvider.isSupported()
      ? null
      : 'Bu tarayıcı veya Android WebView Web Speech API (speechSynthesis) desteğini sunmuyor.'
  );
  const [lastSpeechError, setLastSpeechError] = useState<string | null>(null);
  const [hasUserGesture, setHasUserGesture] = useState<boolean>(false);

  const stateRef = useRef(state);
  stateRef.current = state;

  const activeEventRef = useRef<QueueEvent | null>(activeEvent);
  activeEventRef.current = activeEvent;

  const mouthListenersRef = useRef<Set<MouthListener>>(new Set());
  const recentDedupeRef = useRef<Map<string, number>>(new Map());
  const holdTimeoutRef = useRef<number | null>(null);
  const lastBroadcastSyncRef = useRef<number>(0);
  const tiktokConnectorRef = useRef<TikTokLiveConnectorService | null>(null);

  const unlockAudioByGesture = useCallback(() => {
    setHasUserGesture(true);
  }, []);

  const emitMouthLevel = useCallback((level: number) => {
    mouthListenersRef.current.forEach((fn) => fn(level));
  }, []);

  const subscribeMouthLevel = useCallback((fn: MouthListener) => {
    mouthListenersRef.current.add(fn);
    return () => {
      mouthListenersRef.current.delete(fn);
    };
  }, []);

  const refreshVoices = useCallback(() => {
    if (!browserTTSProvider.isSupported()) {
      setAvailableVoices([]);
      setVoiceLoadStatus('unsupported');
      setVoiceLoadError(
        'Bu tarayıcı veya WebView Web Speech API (speechSynthesis) desteğini sunmuyor.'
      );
      return;
    }
    const list = getAvailableSpeechVoices();
    setAvailableVoices(list);
    if (list.length > 0) {
      setVoiceLoadStatus('ready');
      setVoiceLoadError(null);
    }
  }, []);

  useEffect(() => {
    refreshVoices();
    if (typeof window === 'undefined') return;

    const markGesture = () => setHasUserGesture(true);
    window.addEventListener('pointerdown', markGesture, { passive: true });
    window.addEventListener('keydown', markGesture, { passive: true });

    let retryTimers: number[] = [];
    let handleVoicesChanged: (() => void) | null = null;

    if (browserTTSProvider.isSupported()) {
      const synth = window.speechSynthesis;
      handleVoicesChanged = () => refreshVoices();
      if (typeof synth.addEventListener === 'function') {
        synth.addEventListener('voiceschanged', handleVoicesChanged);
      } else {
        synth.onvoiceschanged = handleVoicesChanged;
      }

      // Android Chrome/WebView sometimes populates voices asynchronously without firing voiceschanged reliably
      const retryDelays = [250, 800, 1800];
      retryTimers = retryDelays.map((delay, idx) =>
        window.setTimeout(() => {
          const list = getAvailableSpeechVoices();
          setAvailableVoices(list);
          if (list.length > 0) {
            setVoiceLoadStatus('ready');
            setVoiceLoadError(null);
          } else if (idx === retryDelays.length - 1) {
            setVoiceLoadStatus('empty');
            setVoiceLoadError(
              'Cihazdan ses listesi (speechSynthesis.getVoices()) yüklenemedi. Android Ayarlar > Erişilebilirlik / Sistem > Metin-konuşma çıktısı bölümünde tercih edilen motorun seçili ve Türkçe ses verisinin yüklü olduğundan emin olun.'
            );
          }
        }, delay)
      );
    }

    return () => {
      window.removeEventListener('pointerdown', markGesture);
      window.removeEventListener('keydown', markGesture);
      retryTimers.forEach((t) => window.clearTimeout(t));
      if (holdTimeoutRef.current !== null) {
        window.clearTimeout(holdTimeoutRef.current);
        holdTimeoutRef.current = null;
      }
      studioTTSRouter.stop();
      if (browserTTSProvider.isSupported() && handleVoicesChanged) {
        const synth = window.speechSynthesis;
        if (typeof synth.removeEventListener === 'function') {
          synth.removeEventListener('voiceschanged', handleVoicesChanged);
        }
        if (synth.onvoiceschanged === handleVoicesChanged) {
          synth.onvoiceschanged = null;
        }
      }
    };
  }, [refreshVoices]);

  // Persist & sync state across server/tabs (only Admin writes canonical state unless empty)
  useEffect(() => {
    if (isBroadcastView) return;
    saveLocalState(state);
    notifyLocalChannelState(state);
    const timer = window.setTimeout(() => {
      pushServerState(state);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [state, isBroadcastView]);

  // Initial server sync & SSE listener (crucial for OBS Broadcast View & remote mobile admin)
  useEffect(() => {
    let mounted = true;
    fetchServerState().then((res) => {
      if (!mounted || !res) return;
      if (isBroadcastView && res.appState) {
        setState((prev) => ({ ...prev, ...res.appState }));
      }
      if (isBroadcastView && res.livePlayback) {
        setActiveEvent(res.livePlayback.activeEvent);
        setSpeakingState(res.livePlayback.speakingState);
      }
    });

    const unsub = subscribeToStudioSync({
      onState: (incoming) => {
        if (!mounted) return;
        if (isBroadcastView) {
          setState(incoming);
        }
      },
      onLivePlayback: (payload) => {
        if (!mounted || !isBroadcastView) return;
        setActiveEvent(payload.activeEvent);
        setSpeakingState(payload.speakingState);
        emitMouthLevel(payload.mouthLevel || 0);
      },
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, [isBroadcastView, emitMouthLevel]);

  const appendLog = useCallback(
    (level: SystemLogEntry['level'], source: SystemLogEntry['source'], message: string) => {
      const entry: SystemLogEntry = {
        id: createUniqueId('log'),
        timestamp: new Date().toISOString(),
        level,
        source,
        message,
      };
      setState((prev) => ({
        ...prev,
        logs: [entry, ...prev.logs].slice(0, 120),
        lastUpdatedAt: new Date().toISOString(),
      }));
    },
    []
  );

  // Prayer CRUD
  const addPrayer = useCallback(
    (input: { title: string; category: PrayerCategoryId; template: string; isActive: boolean }) => {
      const now = new Date().toISOString();
      const newPrayer: PrayerTemplate = {
        id: createUniqueId('prayer'),
        title: input.title.trim().slice(0, 80) || 'Yeni Dua',
        category: input.category,
        template: sanitizePrayerTemplate(input.template),
        isActive: input.isActive,
        createdAt: now,
        updatedAt: now,
      };
      setState((prev) => ({
        ...prev,
        prayers: [newPrayer, ...prev.prayers],
        lastUpdatedAt: now,
      }));
      appendLog('info', 'system', `Prayer template added: "${newPrayer.title}".`);
    },
    [appendLog]
  );

  const updatePrayer = useCallback(
    (id: string, patch: Partial<Omit<PrayerTemplate, 'id' | 'createdAt'>>) => {
      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        prayers: prev.prayers.map((p) =>
          p.id === id
            ? {
                ...p,
                ...patch,
                title: patch.title !== undefined ? patch.title.trim().slice(0, 80) : p.title,
                template: patch.template !== undefined ? sanitizePrayerTemplate(patch.template) : p.template,
                updatedAt: now,
              }
            : p
        ),
        lastUpdatedAt: now,
      }));
    },
    []
  );

  const deletePrayer = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        prayers: prev.prayers.filter((p) => p.id !== id),
        lastUpdatedAt: new Date().toISOString(),
      }));
      appendLog('info', 'system', `Prayer template removed (${id}).`);
    },
    [appendLog]
  );

  const togglePrayerActive = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      prayers: prev.prayers.map((p) =>
        p.id === id ? { ...p, isActive: !p.isActive, updatedAt: new Date().toISOString() } : p
      ),
      lastUpdatedAt: new Date().toISOString(),
    }));
  }, []);

  const pickRandomPrayer = useCallback((category: PrayerCategoryId): PrayerTemplate | null => {
    const allActive = stateRef.current.prayers.filter((p) => p.isActive);
    if (allActive.length === 0) return null;
    const categoryPool = allActive.filter((p) => p.category === category);
    const pool = categoryPool.length > 0 ? categoryPool : allActive;
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }, []);

  // Gift CRUD
  const addGift = useCallback(
    (input: Omit<GiftRule, 'id' | 'updatedAt'>) => {
      const now = new Date().toISOString();
      const newGift: GiftRule = {
        ...input,
        id: createUniqueId('gift'),
        name: sanitizeGiftName(input.name) || 'Hediye',
        tiktokGiftId: sanitizeGiftName(input.tiktokGiftId).toLowerCase().replace(/\s+/g, '_') || 'custom_gift',
        quantityMultiplier: Math.max(1, Math.min(20, Number(input.quantityMultiplier) || 1)),
        minCoins: Math.max(1, Number(input.minCoins) || 1),
        updatedAt: now,
      };
      setState((prev) => ({
        ...prev,
        gifts: [newGift, ...prev.gifts],
        lastUpdatedAt: now,
      }));
      appendLog('info', 'system', `Gift rule added: "${newGift.name}".`);
    },
    [appendLog]
  );

  const updateGift = useCallback((id: string, patch: Partial<Omit<GiftRule, 'id'>>) => {
    const now = new Date().toISOString();
    setState((prev) => ({
      ...prev,
      gifts: prev.gifts.map((g) =>
        g.id === id
          ? {
              ...g,
              ...patch,
              name: patch.name !== undefined ? sanitizeGiftName(patch.name) : g.name,
              updatedAt: now,
            }
          : g
      ),
      lastUpdatedAt: now,
    }));
  }, []);

  const deleteGift = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        gifts: prev.gifts.filter((g) => g.id !== id),
        lastUpdatedAt: new Date().toISOString(),
      }));
      appendLog('info', 'system', `Gift rule removed (${id}).`);
    },
    [appendLog]
  );

  const toggleGiftEnabled = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      gifts: prev.gifts.map((g) =>
        g.id === id ? { ...g, enabled: !g.enabled, updatedAt: new Date().toISOString() } : g
      ),
      lastUpdatedAt: new Date().toISOString(),
    }));
  }, []);

  // Smart Queue Enqueue with Duplicate Protection & Priority Ordering
  const enqueueGiftEvent = useCallback(
    (params: {
      source: EventSource;
      username?: string;
      giftIdOrName?: string;
      displayGiftName?: string;
      quantity?: number;
      externalDedupeKey?: string;
    }): EnqueueResult => {
      setHasUserGesture(true);
      const current = stateRef.current;
      const rawUser =
        params.username && params.username.trim()
          ? params.username
          : SAMPLE_TIKTOK_USERNAMES[Math.floor(Math.random() * SAMPLE_TIKTOK_USERNAMES.length)];
      const safeUser = sanitizeUsername(rawUser);
      const qty = Math.max(1, Math.min(999, Math.floor(Number(params.quantity) || 1)));

      // Identify gift rule
      const query = (params.giftIdOrName || 'Çay').trim().toLowerCase();
      const explicitMatch = current.gifts.find(
        (g) => g.id === params.giftIdOrName || g.tiktokGiftId.toLowerCase() === query || g.name.toLowerCase() === query
      );

      let matchedGift = explicitMatch;
      if (!matchedGift) {
        if (params.source === 'real') {
          matchedGift =
            current.gifts.find((g) => g.enabled && g.category === 'general_blessings') ||
            current.gifts.find((g) => g.enabled) ||
            current.gifts[0];
        } else {
          matchedGift = current.gifts[0];
        }
      }

      if (!matchedGift) {
        appendLog('warning', 'queue', 'No gift rules configured.');
        return { ok: false, reason: 'No gift rules configured.' };
      }

      if (!matchedGift.enabled) {
        appendLog('warning', 'queue', `Gift "${matchedGift.name}" is currently disabled.`);
        return { ok: false, reason: `Gift rule "${matchedGift.name}" is disabled.` };
      }

      const effectiveGiftName = params.displayGiftName
        ? sanitizeGiftName(params.displayGiftName) || matchedGift.name
        : explicitMatch
        ? matchedGift.name
        : sanitizeGiftName(params.giftIdOrName || matchedGift.name) || matchedGift.name;

      // Duplicate protection window (real streams also pass unique streakKey so distinct combos are never dropped)
      const dedupeKey = params.externalDedupeKey
        ? `${params.source}:${params.externalDedupeKey}`
        : `${params.source}:${safeUser.toLowerCase()}:${matchedGift.id}:${qty}`;
      const nowMs = Date.now();
      const windowMs = params.externalDedupeKey
        ? 120_000
        : Math.max(2, current.tiktok.duplicateWindowSec) * 1000;
      const lastSeen = recentDedupeRef.current.get(dedupeKey);
      if (lastSeen && nowMs - lastSeen < windowMs) {
        appendLog(
          'warning',
          'queue',
          `Duplicate event prevented for @${safeUser} (${effectiveGiftName} x${qty}).`
        );
        return {
          ok: false,
          reason: `Duplicate gift from @${safeUser} blocked.`,
        };
      }
      recentDedupeRef.current.set(dedupeKey, nowMs);
      if (recentDedupeRef.current.size > 500) {
        const cutoff = nowMs - 120_000;
        for (const [k, ts] of recentDedupeRef.current.entries()) {
          if (ts < cutoff) recentDedupeRef.current.delete(k);
        }
      }

      const selectedPrayer = pickRandomPrayer(matchedGift.category);
      if (!selectedPrayer) {
        appendLog('error', 'queue', 'No active prayer templates available in Prayer Library.');
        return { ok: false, reason: 'No active prayer templates found. Activate at least one prayer.' };
      }

      const renderedPrayer = renderPersonalizedPrayer(selectedPrayer.template, safeUser);

      // Determine scholar assignment
      let chosenScholar: ScholarId = 'scholar_1';
      if (current.scholars.activeMode === 'scholar_1') chosenScholar = 'scholar_1';
      else if (current.scholars.activeMode === 'scholar_2') chosenScholar = 'scholar_2';
      else {
        const lastQueued = current.queue[current.queue.length - 1] || current.history[0];
        const refSpeaker = lastQueued?.scholarId || current.scholars.currentSpeaker;
        chosenScholar = refSpeaker === 'scholar_1' ? 'scholar_2' : 'scholar_1';
      }

      // Real finalized streaks should produce 1 prayer with accurate final quantity unless an explicit rule repeats
      const repeatCount =
        params.source === 'real'
          ? explicitMatch?.repeatPerQuantity
            ? Math.min(5, qty * matchedGift.quantityMultiplier)
            : 1
          : matchedGift.repeatPerQuantity
          ? Math.min(5, qty * matchedGift.quantityMultiplier)
          : 1;

      const createdEvents: QueueEvent[] = [];
      for (let i = 0; i < repeatCount; i++) {
        createdEvents.push({
          id: createUniqueId('evt'),
          dedupeKey: `${dedupeKey}:${i}`,
          source: params.source,
          username: safeUser,
          displayUsername: `@${safeUser}`,
          giftId: matchedGift.id,
          giftName: effectiveGiftName,
          quantity: qty,
          priority: matchedGift.priority,
          category: selectedPrayer.category,
          prayerId: selectedPrayer.id,
          prayerTitle: selectedPrayer.title,
          renderedPrayer,
          scholarId: i % 2 === 0 ? chosenScholar : chosenScholar === 'scholar_1' ? 'scholar_2' : 'scholar_1',
          status: 'pending',
          attempts: 0,
          createdAt: new Date().toISOString(),
        });
      }

      const priorityRank: Record<GiftRule['priority'], number> = {
        urgent: 3,
        high: 2,
        normal: 1,
      };

      setState((prev) => {
        const merged = dedupeEventsById([...prev.queue, ...createdEvents]).sort((a, b) => {
          if (a.status === 'speaking' && b.status !== 'speaking') return -1;
          if (b.status === 'speaking' && a.status !== 'speaking') return 1;
          return priorityRank[b.priority] - priorityRank[a.priority];
        });
        return {
          ...prev,
          queue: merged,
          stats: {
            ...prev.stats,
            totalGifts: prev.stats.totalGifts + qty,
            simulatedGifts: prev.stats.simulatedGifts + (params.source === 'simulation' ? qty : 0),
            realGifts: prev.stats.realGifts + (params.source === 'real' ? qty : 0),
          },
          lastUpdatedAt: new Date().toISOString(),
        };
      });

      const catLabel = PRAYER_CATEGORIES.find((c) => c.id === selectedPrayer.category)?.labelTr || selectedPrayer.category;
      appendLog(
        'info',
        'queue',
        `[${params.source.toUpperCase()}] Queued ${effectiveGiftName} x${qty} from @${safeUser} (${catLabel}).`
      );

      return { ok: true, event: createdEvents[0] };
    },
    [appendLog, pickRandomPrayer]
  );

  const simulateSampleCayGift = useCallback(() => {
    const cayGift =
      stateRef.current.gifts.find((g) => g.name.toLowerCase() === 'çay' || g.tiktokGiftId === 'cay') ||
      stateRef.current.gifts[0];
    return enqueueGiftEvent({
      source: 'simulation',
      giftIdOrName: cayGift?.id || 'Çay',
      quantity: 1,
    });
  }, [enqueueGiftEvent]);

  // Sequential Queue Playback Engine (runs in Admin view; waits for user gesture on Android Chrome/WebView)
  useEffect(() => {
    if (isBroadcastView) return;
    if (!hasUserGesture) return;
    if (state.queuePaused || activeEvent !== null) return;

    const nextPending = state.queue.find((q) => q.status === 'pending');
    if (!nextPending) return;

    // Mark event as speaking
    const startedEvent: QueueEvent = {
      ...nextPending,
      status: 'speaking',
      attempts: nextPending.attempts + 1,
      startedAt: new Date().toISOString(),
    };

    setActiveEvent(startedEvent);
    setSpeakingState('speaking');
    setIsSpeechPaused(false);

    setState((prev) => ({
      ...prev,
      scholars: {
        ...prev.scholars,
        currentSpeaker: startedEvent.scholarId,
      },
      queue: prev.queue.map((item) => (item.id === startedEvent.id ? startedEvent : item)),
    }));

    pushLivePlayback({
      activeEvent: startedEvent,
      speakingState: 'speaking',
      activeScholar: startedEvent.scholarId,
      mouthLevel: 0.4,
    });

    const voiceCfg = stateRef.current.voice;
    const chosenVoiceURI = resolveScholarVoiceURI(voiceCfg, startedEvent.scholarId);
    const chosenNeuralVoiceId =
      startedEvent.scholarId === 'scholar_2' && voiceCfg.neuralScholar2VoiceId
        ? voiceCfg.neuralScholar2VoiceId
        : voiceCfg.neuralVoiceId;
    const prosody = getScholarProsody(voiceCfg.rate, voiceCfg.pitch, startedEvent.scholarId, {
      enabled: voiceCfg.scholar1IndependentEnabled,
      rate: voiceCfg.scholar1Rate,
      pitch: voiceCfg.scholar1Pitch,
    });

    setLastSpeechError(null);
    studioTTSRouter.speak(startedEvent.renderedPrayer, {
      preferredEngine: voiceCfg.provider,
      voiceURI: chosenVoiceURI,
      neuralProviderId: voiceCfg.neuralProviderId,
      neuralVoiceId: chosenNeuralVoiceId,
      tone: voiceCfg.narrationTone,
      fallbackToBrowser: voiceCfg.fallbackToBrowser,
      lang: voiceCfg.language || 'tr-TR',
      rate: prosody.rate,
      pitch: prosody.pitch,
      volume: voiceCfg.volume,
      onStart: () => {
        setSpeakingState('speaking');
      },
      onFallbackNotice: (reason) => {
        appendLog('warning', 'tts', reason);
      },
      onMouthLevel: (level) => {
        emitMouthLevel(level);
        const now = performance.now();
        if (now - lastBroadcastSyncRef.current > 120) {
          lastBroadcastSyncRef.current = now;
          pushLivePlayback({
            activeEvent: startedEvent,
            speakingState: 'speaking',
            activeScholar: startedEvent.scholarId,
            mouthLevel: level,
          });
        }
      },
      onEnd: () => {
        emitMouthLevel(0);
        setSpeakingState('holding');
        pushLivePlayback({
          activeEvent: startedEvent,
          speakingState: 'holding',
          activeScholar: startedEvent.scholarId,
          mouthLevel: 0,
        });

        if (holdTimeoutRef.current !== null) {
          window.clearTimeout(holdTimeoutRef.current);
        }
        const holdMs = Math.max(500, (stateRef.current.broadcast.postSpeechHoldSec || 2.5) * 1000);
        holdTimeoutRef.current = window.setTimeout(() => {
          holdTimeoutRef.current = null;
          const completed: QueueEvent = {
            ...startedEvent,
            status: 'completed',
            completedAt: new Date().toISOString(),
          };
          setState((prev) => ({
            ...prev,
            queue: prev.queue.filter((item) => item.id !== startedEvent.id),
            history: dedupeEventsById([completed, ...prev.history]).slice(0, 200),
            stats: {
              ...prev.stats,
              totalPrayers: prev.stats.totalPrayers + 1,
            },
            lastUpdatedAt: new Date().toISOString(),
          }));
          setActiveEvent(null);
          setSpeakingState('idle');
          pushLivePlayback({
            activeEvent: null,
            speakingState: 'idle',
            activeScholar: startedEvent.scholarId,
            mouthLevel: 0,
          });
        }, holdMs);
      },
      onError: (reason) => {
        emitMouthLevel(0);
        setLastSpeechError(reason);
        const failedEvent: QueueEvent = {
          ...startedEvent,
          status: 'failed',
          errorMessage: reason,
        };
        setState((prev) => ({
          ...prev,
          queue: prev.queue.map((item) => (item.id === startedEvent.id ? failedEvent : item)),
          logs: [
            {
              id: createUniqueId('log'),
              timestamp: new Date().toISOString(),
              level: 'error' as const,
              source: 'tts' as const,
              message: `Playback error for ${startedEvent.displayUsername}: ${reason}`,
            },
            ...prev.logs,
          ].slice(0, 120),
        }));
        setActiveEvent(null);
        setSpeakingState('idle');
        pushLivePlayback({
          activeEvent: null,
          speakingState: 'idle',
          activeScholar: startedEvent.scholarId,
          mouthLevel: 0,
        });
      },
    });
  }, [state.queue, state.queuePaused, activeEvent, isBroadcastView, hasUserGesture, emitMouthLevel, appendLog]);

  const toggleQueuePause = useCallback(() => {
    setState((prev) => {
      const nextPaused = !prev.queuePaused;
      return {
        ...prev,
        queuePaused: nextPaused,
        lastUpdatedAt: new Date().toISOString(),
      };
    });
  }, []);

  const pauseSpeech = useCallback(() => {
    studioTTSRouter.pause();
    setIsSpeechPaused(true);
    emitMouthLevel(0);
  }, [emitMouthLevel]);

  const resumeSpeech = useCallback(() => {
    studioTTSRouter.resume();
    setIsSpeechPaused(false);
  }, []);

  const stopCurrentSpeech = useCallback(() => {
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    studioTTSRouter.stop();
    emitMouthLevel(0);
    setIsSpeechPaused(false);

    const currentActive = activeEventRef.current;
    activeEventRef.current = null;
    if (currentActive) {
      const cancelled: QueueEvent = {
        ...currentActive,
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      };
      setState((prev) => ({
        ...prev,
        queue: prev.queue.filter((item) => item.id !== currentActive.id),
        history: dedupeEventsById([cancelled, ...prev.history]).slice(0, 200),
      }));
    }
    setActiveEvent(null);
    setSpeakingState('idle');
    pushLivePlayback({
      activeEvent: null,
      speakingState: 'idle',
      activeScholar: stateRef.current.scholars.currentSpeaker,
      mouthLevel: 0,
    });
  }, [emitMouthLevel]);

  const removeQueueItem = useCallback(
    (id: string) => {
      if (activeEventRef.current?.id === id) {
        stopCurrentSpeech();
        return;
      }
      setState((prev) => ({
        ...prev,
        queue: prev.queue.filter((item) => item.id !== id),
        lastUpdatedAt: new Date().toISOString(),
      }));
    },
    [stopCurrentSpeech]
  );

  const retryQueueItem = useCallback((id: string) => {
    setState((prev) => {
      const inQueue = prev.queue.find((q) => q.id === id);
      if (inQueue) {
        return {
          ...prev,
          queue: prev.queue.map((q) => (q.id === id ? { ...q, status: 'pending', errorMessage: undefined } : q)),
        };
      }
      const inHistory = prev.history.find((h) => h.id === id);
      if (inHistory) {
        const retried: QueueEvent = {
          ...inHistory,
          id: createUniqueId('evt'),
          status: 'pending',
          errorMessage: undefined,
          createdAt: new Date().toISOString(),
          startedAt: undefined,
          completedAt: undefined,
        };
        return {
          ...prev,
          queue: [...prev.queue, retried],
        };
      }
      return prev;
    });
  }, []);

  const clearQueue = useCallback(() => {
    stopCurrentSpeech();
    setState((prev) => ({
      ...prev,
      queue: [],
      lastUpdatedAt: new Date().toISOString(),
    }));
  }, [stopCurrentSpeech]);

  const clearHistory = useCallback(() => {
    setState((prev) => ({
      ...prev,
      history: [],
      lastUpdatedAt: new Date().toISOString(),
    }));
  }, []);

  // Settings updates
  const updateScholarsConfig = useCallback((patch: Partial<ScholarSettingsConfig>) => {
    setState((prev) => ({
      ...prev,
      scholars: { ...prev.scholars, ...patch },
      lastUpdatedAt: new Date().toISOString(),
    }));
  }, []);

  const updateScholarProfile = useCallback(
    (id: ScholarId, patch: Partial<ScholarSettingsConfig['profiles'][ScholarId]>) => {
      setState((prev) => ({
        ...prev,
        scholars: {
          ...prev.scholars,
          profiles: {
            ...prev.scholars.profiles,
            [id]: { ...prev.scholars.profiles[id], ...patch },
          },
        },
        lastUpdatedAt: new Date().toISOString(),
      }));
    },
    []
  );

  const updateVoiceConfig = useCallback((patch: Partial<VoiceSettingsConfig>) => {
    setState((prev) => ({
      ...prev,
      voice: { ...prev.voice, ...patch },
      lastUpdatedAt: new Date().toISOString(),
    }));
  }, []);

  const testVoicePlayback = useCallback(
    (sampleText: string, scholarId: ScholarId = 'scholar_1') => {
      setHasUserGesture(true);
      if (activeEventRef.current) return; // Don't clobber active queue playback
      const voiceCfg = stateRef.current.voice;
      const chosenVoiceURI = resolveScholarVoiceURI(voiceCfg, scholarId);
      const chosenNeuralVoiceId =
        scholarId === 'scholar_2' && voiceCfg.neuralScholar2VoiceId
          ? voiceCfg.neuralScholar2VoiceId
          : voiceCfg.neuralVoiceId;
      const prosody = getScholarProsody(voiceCfg.rate, voiceCfg.pitch, scholarId, {
        enabled: voiceCfg.scholar1IndependentEnabled,
        rate: voiceCfg.scholar1Rate,
        pitch: voiceCfg.scholar1Pitch,
      });

      setLastSpeechError(null);
      setState((prev) => ({
        ...prev,
        scholars: { ...prev.scholars, currentSpeaker: scholarId },
      }));
      setSpeakingState('speaking');
      studioTTSRouter.speak(sampleText, {
        preferredEngine: voiceCfg.provider,
        voiceURI: chosenVoiceURI,
        neuralProviderId: voiceCfg.neuralProviderId,
        neuralVoiceId: chosenNeuralVoiceId,
        tone: voiceCfg.narrationTone,
        fallbackToBrowser: voiceCfg.fallbackToBrowser,
        lang: voiceCfg.language || 'tr-TR',
        rate: prosody.rate,
        pitch: prosody.pitch,
        volume: voiceCfg.volume,
        onFallbackNotice: (reason) => {
          appendLog('warning', 'tts', reason);
        },
        onMouthLevel: (lvl) => emitMouthLevel(lvl),
        onEnd: () => {
          emitMouthLevel(0);
          setSpeakingState('idle');
        },
        onError: (msg) => {
          emitMouthLevel(0);
          setSpeakingState('idle');
          setLastSpeechError(msg);
          appendLog('warning', 'tts', msg);
        },
      });
    },
    [appendLog, emitMouthLevel]
  );

  const testSystemTurkishSpeech = useCallback(
    (scholarId: ScholarId = 'scholar_1') => {
      setHasUserGesture(true);
      if (activeEventRef.current) return;
      const voiceCfg = stateRef.current.voice;
      const chosenVoiceURI = resolveScholarVoiceURI(voiceCfg, scholarId);
      const prosody = getScholarProsody(voiceCfg.rate, voiceCfg.pitch, scholarId, {
        enabled: voiceCfg.scholar1IndependentEnabled,
        rate: voiceCfg.scholar1Rate,
        pitch: voiceCfg.scholar1Pitch,
      });

      studioTTSRouter.stop();
      setLastSpeechError(null);
      setState((prev) => ({
        ...prev,
        scholars: { ...prev.scholars, currentSpeaker: scholarId },
      }));
      setSpeakingState('speaking');

      studioTTSRouter.speak('Esselâmü aleyküm. Allah dualarımızı kabul eylesin.', {
        preferredEngine: 'browser_speech_synthesis',
        voiceURI: chosenVoiceURI,
        lang: 'tr-TR',
        rate: prosody.rate,
        pitch: prosody.pitch,
        volume: voiceCfg.volume,
        onMouthLevel: (lvl) => emitMouthLevel(lvl),
        onEnd: () => {
          emitMouthLevel(0);
          setSpeakingState('idle');
        },
        onError: (msg) => {
          emitMouthLevel(0);
          setSpeakingState('idle');
          setLastSpeechError(msg);
          appendLog('warning', 'tts', msg);
        },
      });
    },
    [appendLog, emitMouthLevel]
  );

  const testServerNeuralPlayback = useCallback(
    (sampleText: string, scholarId: ScholarId = 'scholar_1') => {
      if (activeEventRef.current) {
        return Promise.resolve({
          ok: false,
          message: 'A queued prayer is currently speaking. Wait for it to finish or stop it first.',
        });
      }

      const voiceCfg = stateRef.current.voice;
      const chosenNeuralVoiceId =
        scholarId === 'scholar_2' && voiceCfg.neuralScholar2VoiceId
          ? voiceCfg.neuralScholar2VoiceId
          : voiceCfg.neuralVoiceId;

      studioTTSRouter.stop();
      setState((prev) => ({
        ...prev,
        scholars: { ...prev.scholars, currentSpeaker: scholarId },
      }));
      setSpeakingState('speaking');

      return new Promise<{ ok: boolean; message: string }>((resolve) => {
        let settled = false;
        serverNeuralTTSProvider.speak(sampleText, {
          neuralProviderId: voiceCfg.neuralProviderId,
          neuralVoiceId: chosenNeuralVoiceId,
          tone: voiceCfg.narrationTone,
          lang: voiceCfg.language || 'tr-TR',
          rate: voiceCfg.rate,
          pitch: voiceCfg.pitch,
          volume: voiceCfg.volume,
          onStart: () => {
            if (!settled) {
              settled = true;
              resolve({
                ok: true,
                message: `Playing server neural Turkish audio via ${voiceCfg.neuralProviderId} (${chosenNeuralVoiceId}).`,
              });
            }
          },
          onMouthLevel: (lvl) => emitMouthLevel(lvl),
          onEnd: () => {
            emitMouthLevel(0);
            setSpeakingState('idle');
            if (!settled) {
              settled = true;
              resolve({ ok: true, message: 'Server neural audio playback completed.' });
            }
          },
          onError: (reason) => {
            emitMouthLevel(0);
            setSpeakingState('idle');
            appendLog('warning', 'tts', `Server neural TTS test: ${reason}`);
            if (!settled) {
              settled = true;
              resolve({ ok: false, message: reason });
            }
          },
        });
      });
    },
    [appendLog, emitMouthLevel]
  );

  // Persistent TikTokLiveConnectorService lifecycle (Admin view only)
  useEffect(() => {
    if (isBroadcastView) return;

    const connector = new TikTokLiveConnectorService(stateRef.current.tiktok, {
      onStatusChange: (payload) => {
        setState((prev) => {
          const nextRoomId = payload.roomId !== undefined ? payload.roomId : prev.tiktok.roomId;
          const nextViewerCount =
            payload.viewerCount !== undefined ? payload.viewerCount : prev.tiktok.viewerCount;
          const nextError = payload.error !== undefined ? payload.error : prev.tiktok.lastError;
          if (
            prev.tiktok.connectionState === payload.state &&
            prev.tiktok.roomId === nextRoomId &&
            prev.tiktok.viewerCount === nextViewerCount &&
            prev.tiktok.lastError === nextError
          ) {
            return prev;
          }
          return {
            ...prev,
            tiktok: {
              ...prev.tiktok,
              connectionState: payload.state,
              roomId: nextRoomId,
              viewerCount: nextViewerCount,
              lastError: nextError,
              lastCheckedAt: payload.updatedAt,
            },
          };
        });
      },
      onFinalizedGift: (gift) => {
        enqueueGiftEvent({
          source: 'real',
          username: gift.username,
          giftIdOrName: gift.giftName || gift.giftId,
          displayGiftName: gift.giftName,
          quantity: gift.quantity,
          externalDedupeKey: gift.streakKey,
        });
      },
      onLog: (level, message) => {
        appendLog(level, 'tiktok', message);
      },
    });

    tiktokConnectorRef.current = connector;
    return () => {
      connector.dispose();
      if (tiktokConnectorRef.current === connector) {
        tiktokConnectorRef.current = null;
      }
    };
  }, [isBroadcastView, enqueueGiftEvent, appendLog]);

  useEffect(() => {
    if (isBroadcastView) return;
    tiktokConnectorRef.current?.updateConfig({
      username: state.tiktok.username,
      connectorEndpoint: state.tiktok.connectorEndpoint,
      autoReconnect: state.tiktok.autoReconnect,
      maxRetries: state.tiktok.maxRetries,
      retryDelaySec: state.tiktok.retryDelaySec,
      duplicateWindowSec: state.tiktok.duplicateWindowSec,
    });
  }, [
    isBroadcastView,
    state.tiktok.username,
    state.tiktok.connectorEndpoint,
    state.tiktok.autoReconnect,
    state.tiktok.maxRetries,
    state.tiktok.retryDelaySec,
    state.tiktok.duplicateWindowSec,
  ]);

  const updateTikTokConfig = useCallback((patch: Partial<TikTokConnectionConfig>) => {
    setState((prev) => {
      const nextEndpoint =
        patch.connectorEndpoint !== undefined ? patch.connectorEndpoint.trim() : prev.tiktok.connectorEndpoint;
      const nextUsername =
        patch.username !== undefined ? sanitizeTikTokHandle(patch.username) : prev.tiktok.username;
      const nextState =
        !nextEndpoint
          ? 'unconfigured'
          : prev.tiktok.connectionState === 'unconfigured'
          ? 'disconnected'
          : prev.tiktok.connectionState;
      return {
        ...prev,
        tiktok: {
          ...prev.tiktok,
          ...patch,
          username: nextUsername,
          connectorEndpoint: nextEndpoint,
          connectionState: nextState,
        },
        lastUpdatedAt: new Date().toISOString(),
      };
    });
  }, []);

  const attemptTikTokConnect = useCallback(async () => {
    const tk = stateRef.current.tiktok;
    const connector =
      tiktokConnectorRef.current ||
      new TikTokLiveConnectorService(tk, {
        onFinalizedGift: (gift) => {
          enqueueGiftEvent({
            source: 'real',
            username: gift.username,
            giftIdOrName: gift.giftName || gift.giftId,
            displayGiftName: gift.giftName,
            quantity: gift.quantity,
            externalDedupeKey: gift.streakKey,
          });
        },
        onLog: (level, message) => appendLog(level, 'tiktok', message),
      });

    if (!tiktokConnectorRef.current) {
      tiktokConnectorRef.current = connector;
    }

    connector.updateConfig(tk);
    const result = await connector.connect(tk.username);
    if (!result.ok && result.error) {
      appendLog('warning', 'tiktok', result.error);
    }
    return result;
  }, [appendLog, enqueueGiftEvent]);

  const disconnectTikTok = useCallback(async () => {
    const connector = tiktokConnectorRef.current;
    if (connector) {
      await connector.disconnect();
    } else {
      setState((prev) => ({
        ...prev,
        tiktok: {
          ...prev.tiktok,
          connectionState: prev.tiktok.connectorEndpoint ? 'disconnected' : 'unconfigured',
          roomId: null,
          viewerCount: null,
          lastError: null,
        },
      }));
    }
    appendLog('info', 'tiktok', 'TikTok LIVE connector disconnected.');
  }, [appendLog]);

  const updateBroadcastConfig = useCallback((patch: Partial<BroadcastSettingsConfig>) => {
    setState((prev) => ({
      ...prev,
      broadcast: { ...prev.broadcast, ...patch },
      lastUpdatedAt: new Date().toISOString(),
    }));
  }, []);

  const resetAllDefaults = useCallback(() => {
    stopCurrentSpeech();
    clearLocalState();
    const fresh = createDefaultAppState();
    setState(fresh);
    appendLog('info', 'system', 'Studio configuration reset to initial defaults.');
  }, [stopCurrentSpeech, appendLog]);

  const importStateJson = useCallback(
    (jsonText: string): { ok: boolean; error?: string } => {
      try {
        const parsed = JSON.parse(jsonText);
        if (!parsed || !Array.isArray(parsed.prayers) || !Array.isArray(parsed.gifts)) {
          return { ok: false, error: 'Backup JSON must contain valid prayers and gifts arrays.' };
        }
        const defaults = createDefaultAppState();
        const uniqueHistory = Array.isArray(parsed.history) ? dedupeEventsById(parsed.history) : [];
        const historyIds = new Set(uniqueHistory.map((h) => h.id));
        const uniqueQueue = Array.isArray(parsed.queue)
          ? dedupeEventsById(parsed.queue).filter((q) => !historyIds.has(q.id))
          : [];
        setState({
          ...defaults,
          ...parsed,
          queue: uniqueQueue,
          history: uniqueHistory,
          tiktok: {
            ...defaults.tiktok,
            ...(parsed.tiktok || {}),
            connectionState: parsed.tiktok?.connectorEndpoint ? 'disconnected' : 'unconfigured',
          },
          lastUpdatedAt: new Date().toISOString(),
        });
        appendLog('info', 'system', 'Studio configuration restored from JSON backup.');
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON format' };
      }
    },
    [appendLog]
  );

  const value = useMemo<StudioContextValue>(
    () => ({
      state,
      activeEvent,
      speakingState,
      isSpeechPaused,
      availableVoices,
      voiceLoadStatus,
      voiceLoadError,
      lastSpeechError,
      hasUserGesture,
      unlockAudioByGesture,
      refreshVoices,
      subscribeMouthLevel,
      addPrayer,
      updatePrayer,
      deletePrayer,
      togglePrayerActive,
      pickRandomPrayer,
      addGift,
      updateGift,
      deleteGift,
      toggleGiftEnabled,
      enqueueGiftEvent,
      simulateSampleCayGift,
      toggleQueuePause,
      pauseSpeech,
      resumeSpeech,
      stopCurrentSpeech,
      removeQueueItem,
      retryQueueItem,
      clearQueue,
      clearHistory,
      updateScholarsConfig,
      updateScholarProfile,
      updateVoiceConfig,
      testVoicePlayback,
      testSystemTurkishSpeech,
      testServerNeuralPlayback,
      updateTikTokConfig,
      attemptTikTokConnect,
      disconnectTikTok,
      updateBroadcastConfig,
      addLog: appendLog,
      resetAllDefaults,
      importStateJson,
    }),
    [
      state,
      activeEvent,
      speakingState,
      isSpeechPaused,
      availableVoices,
      voiceLoadStatus,
      voiceLoadError,
      lastSpeechError,
      hasUserGesture,
      unlockAudioByGesture,
      refreshVoices,
      subscribeMouthLevel,
      addPrayer,
      updatePrayer,
      deletePrayer,
      togglePrayerActive,
      pickRandomPrayer,
      addGift,
      updateGift,
      deleteGift,
      toggleGiftEnabled,
      enqueueGiftEvent,
      simulateSampleCayGift,
      toggleQueuePause,
      pauseSpeech,
      resumeSpeech,
      stopCurrentSpeech,
      removeQueueItem,
      retryQueueItem,
      clearQueue,
      clearHistory,
      updateScholarsConfig,
      updateScholarProfile,
      updateVoiceConfig,
      testVoicePlayback,
      testSystemTurkishSpeech,
      testServerNeuralPlayback,
      updateTikTokConfig,
      attemptTikTokConnect,
      disconnectTikTok,
      updateBroadcastConfig,
      appendLog,
      resetAllDefaults,
      importStateJson,
    ]
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
};

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio must be used inside StudioProvider');
  return ctx;
}
