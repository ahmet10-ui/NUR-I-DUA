import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDefaultAppState,
  DEFAULT_MID_OPENING_PRAYERS,
  DEFAULT_YASIN_RECITATION,
  PRAYER_CATEGORIES,
  SAMPLE_TIKTOK_USERNAMES,
} from '../data/defaults';
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
import {
  normalizeRelayBaseUrl,
  TikTokLiveConnectorService,
} from '../services/tiktokLiveConnectorService';
import {
  classifyFollowInteraction,
  classifyGiftInteraction,
  resolveTierRules,
} from '../services/interactionClassifier';
import {
  buildHighTierTurkishSpeech,
  buildYasinClosingSpeech,
  buildYasinIntroSpeech,
  executeStage2PlaybackSequence,
  insertQueueEventPreservingActive,
  normalizeFollowSessionKey,
  pickNonConsecutiveHighDua,
  pickNonConsecutiveMidPrayer,
  pickNonConsecutivePrayerByCategory,
  Stage2PlaybackHandle,
  stripTurkishMeaningFromSpeech,
} from '../services/stage2Flow';
import {
  AvailableVoice,
  browserTTSProvider,
  getAvailableSpeechVoices,
  getScholarProsody,
  resolveScholarVoiceURI,
  serverNeuralTTSProvider,
  studioTTSRouter,
  verifiedArabicAudioPlayer,
} from '../services/ttsService';
import { isNativeAndroidEnvironment } from '../services/nativeAndroidTtsBridge';
import {
  AppState,
  BroadcastSettingsConfig,
  EventSource,
  GiftRule,
  HighTierDuaEntry,
  PrayerCategoryId,
  PrayerTemplate,
  QueueEvent,
  ScholarId,
  ScholarSettingsConfig,
  SystemLogEntry,
  TierRuleConfig,
  TikTokConnectionConfig,
  TikTokRecoveryGapInfo,
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
  playbackStarted: boolean;
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

  // High-Tier Arabic + Turkish Duas CRUD (150-299 coins)
  addHighTierDua: (input: Omit<HighTierDuaEntry, 'id' | 'updatedAt'>) => void;
  updateHighTierDua: (id: string, patch: Partial<Omit<HighTierDuaEntry, 'id'>>) => void;
  deleteHighTierDua: (id: string) => void;
  toggleHighTierDuaActive: (id: string) => void;

  // Gift CRUD & Tier Rules
  addGift: (input: Omit<GiftRule, 'id' | 'updatedAt'>) => void;
  updateGift: (id: string, patch: Partial<Omit<GiftRule, 'id'>>) => void;
  deleteGift: (id: string) => void;
  toggleGiftEnabled: (id: string) => void;
  updateTierRules: (patch: Partial<TierRuleConfig>) => void;

  // Queue & Playback
  enqueueGiftEvent: (params: {
    source: EventSource;
    username?: string;
    userId?: string;
    giftIdOrName?: string;
    displayGiftName?: string;
    quantity?: number;
    unitCoins?: number;
    repeatCount?: number;
    giftType?: number;
    repeatEnd?: boolean;
    externalDedupeKey?: string;
  }) => EnqueueResult;
  enqueueFollowEvent: (params: {
    source: EventSource;
    username?: string;
    userId?: string;
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
  reconnectTikTok: () => Promise<{ ok: boolean; error?: string }>;
  checkRelayHealth: (explicitEndpoint?: string) => Promise<{
    ok: boolean;
    latencyMs: number;
    url: string;
    service?: string;
    connectorVersion?: string;
    simulationEnabled?: boolean;
    hasSignApiKey?: boolean;
    endpoints?: string[];
    error?: string;
  }>;
  disconnectTikTok: () => void | Promise<void>;
  recoveryGap: TikTokRecoveryGapInfo | null;
  dismissRecoveryGap: () => void;
  simulationStreamActive: boolean;
  startSimulationSseListener: () => { ok: boolean; error?: string };
  stopSimulationSseListener: () => void;
  triggerRelaySimulation: (
    scenario:
      | 'follower'
      | 'small_gift'
      | 'mid_gift'
      | 'high_gift'
      | 'yasin_300'
      | 'streak'
      | 'incomplete_streak',
    opts?: { unitCoins?: number; steps?: number[]; includeRepeatEnd?: boolean }
  ) => Promise<{ ok: boolean; message: string }>;
  updateBroadcastConfig: (patch: Partial<BroadcastSettingsConfig>) => void;
  addLog: (level: SystemLogEntry['level'], source: SystemLogEntry['source'], message: string) => void;
  resetAllDefaults: () => void;
  importStateJson: (jsonText: string) => { ok: boolean; error?: string };
}

const StudioContext = createContext<StudioContextValue | null>(null);

const SEEN_FOLLOWS_STORAGE_KEY = 'nur_i_dua_seen_follows_v1';
const REAL_DEDUPE_STORAGE_KEY = 'nur_i_dua_real_dedupe_v1';
const PERSISTED_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

function loadPersistedTimestampMap(storageKey: string): Map<string, number> {
  const map = new Map<string, number>();
  try {
    if (typeof localStorage === 'undefined') return map;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return map;
    const parsed = JSON.parse(raw) as Record<string, number>;
    const cutoff = Date.now() - PERSISTED_DEDUPE_TTL_MS;
    for (const [k, ts] of Object.entries(parsed)) {
      if (typeof ts === 'number' && ts >= cutoff) {
        map.set(k, ts);
      }
    }
  } catch {
    // ignore storage errors
  }
  return map;
}

function savePersistedTimestampMap(storageKey: string, map: Map<string, number>, maxEntries = 1000): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const cutoff = Date.now() - PERSISTED_DEDUPE_TTL_MS;
    const entries: Array<[string, number]> = [];
    for (const [k, ts] of map.entries()) {
      if (ts >= cutoff) entries.push([k, ts]);
    }
    const trimmed = entries.slice(-maxEntries);
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // ignore storage errors
  }
}

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
          .map((item) => {
            const resetStatus = item.status === 'speaking' ? { ...item, status: 'pending' as const } : item;
            if (resetStatus.tier === 'yasin_300') {
              const cleanedRendered = resetStatus.turkishMeaning
                ? stripTurkishMeaningFromSpeech(resetStatus.renderedPrayer, resetStatus.turkishMeaning)
                : resetStatus.renderedPrayer;
              const cleanedIntro = resetStatus.yasinIntroSpeech
                ? resetStatus.turkishMeaning
                  ? stripTurkishMeaningFromSpeech(resetStatus.yasinIntroSpeech, resetStatus.turkishMeaning)
                  : resetStatus.yasinIntroSpeech
                : undefined;
              const isDefaultYasin = resetStatus.prayerId === DEFAULT_YASIN_RECITATION.id;
              return {
                ...resetStatus,
                prayerTitle: isDefaultYasin ? DEFAULT_YASIN_RECITATION.title : resetStatus.prayerTitle,
                sourceCitation: isDefaultYasin ? DEFAULT_YASIN_RECITATION.sourceCitation : resetStatus.sourceCitation,
                arabicAudioUrl: isDefaultYasin ? DEFAULT_YASIN_RECITATION.audioUrl : resetStatus.arabicAudioUrl,
                arabicAudioLicense: isDefaultYasin
                  ? DEFAULT_YASIN_RECITATION.audioLicense
                  : resetStatus.arabicAudioLicense,
                arabicAudioAttribution: isDefaultYasin
                  ? DEFAULT_YASIN_RECITATION.audioAttribution
                  : resetStatus.arabicAudioAttribution,
                arabicAudioStatus: isDefaultYasin
                  ? DEFAULT_YASIN_RECITATION.audioStatus
                  : resetStatus.arabicAudioStatus,
                yasinAudioSha256: isDefaultYasin
                  ? DEFAULT_YASIN_RECITATION.audioSha256
                  : resetStatus.yasinAudioSha256,
                turkishMeaning: undefined,
                renderedPrayer: cleanedRendered,
                yasinIntroSpeech: cleanedIntro,
              };
            }
            if (resetStatus.tier === 'high_gift' && resetStatus.turkishMeaning) {
              return {
                ...resetStatus,
                renderedPrayer: stripTurkishMeaningFromSpeech(
                  resetStatus.renderedPrayer,
                  resetStatus.turkishMeaning
                ),
                yasinIntroSpeech: resetStatus.yasinIntroSpeech
                  ? stripTurkishMeaningFromSpeech(
                      resetStatus.yasinIntroSpeech,
                      resetStatus.turkishMeaning
                    )
                  : undefined,
              };
            }
            return resetStatus;
          })
      )
    : [];

  const savedPrayers =
    Array.isArray(saved.prayers) && saved.prayers.length > 0 ? saved.prayers : defaults.prayers;
  const hasMidOpening = savedPrayers.some((p) => p && p.category === 'mid_opening');
  const mergedPrayers = hasMidOpening
    ? savedPrayers
    : [...DEFAULT_MID_OPENING_PRAYERS, ...savedPrayers];

  const savedHighTier =
    Array.isArray(saved.highTierDuas) && saved.highTierDuas.length > 0
      ? saved.highTierDuas
      : defaults.highTierDuas;

  const savedYasin = saved.yasinRecitation;
  const shouldResetDefaultYasin =
    !savedYasin ||
    (savedYasin.id === DEFAULT_YASIN_RECITATION.id &&
      (savedYasin.audioSha256 !== DEFAULT_YASIN_RECITATION.audioSha256 ||
        savedYasin.audioStatus !== DEFAULT_YASIN_RECITATION.audioStatus));
  const mergedYasin = shouldResetDefaultYasin
    ? { ...DEFAULT_YASIN_RECITATION }
    : {
        ...DEFAULT_YASIN_RECITATION,
        ...savedYasin,
        turkishMealNotice: '',
      };

  return {
    ...defaults,
    ...saved,
    prayers: mergedPrayers,
    gifts: Array.isArray(saved.gifts) && saved.gifts.length > 0 ? saved.gifts : defaults.gifts,
    tierRules: resolveTierRules(saved.tierRules),
    highTierDuas: savedHighTier,
    yasinRecitation: mergedYasin,
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
    voice: {
      ...defaults.voice,
      ...(saved.voice || {}),
      scholar1Engine:
        saved.voice?.scholar1Engine === 'ema_lightning'
          ? 'ema_lightning'
          : saved.voice?.scholar1Engine === 'zerre_ses_a'
          ? 'zerre_ses_a'
          : 'seslen_hasan',
      emaLightningRate:
        typeof saved.voice?.emaLightningRate === 'number'
          ? saved.voice.emaLightningRate
          : defaults.voice.emaLightningRate,
      emaLightningFallbackToHasan:
        typeof saved.voice?.emaLightningFallbackToHasan === 'boolean'
          ? saved.voice.emaLightningFallbackToHasan
          : defaults.voice.emaLightningFallbackToHasan,
      emaLightningApproved:
        typeof saved.voice?.emaLightningApproved === 'boolean'
          ? saved.voice.emaLightningApproved
          : defaults.voice.emaLightningApproved,
      zerreSesARate:
        typeof saved.voice?.zerreSesARate === 'number'
          ? saved.voice.zerreSesARate
          : defaults.voice.zerreSesARate,
      zerreSesAFallbackToHasan:
        typeof saved.voice?.zerreSesAFallbackToHasan === 'boolean'
          ? saved.voice.zerreSesAFallbackToHasan
          : defaults.voice.zerreSesAFallbackToHasan,
      zerreSesAApproved:
        typeof saved.voice?.zerreSesAApproved === 'boolean'
          ? saved.voice.zerreSesAApproved
          : defaults.voice.zerreSesAApproved,
    },
    tiktok: {
      ...defaults.tiktok,
      ...(saved.tiktok || {}),
      username: sanitizeTikTokHandle(saved.tiktok?.username || '') || defaults.tiktok.username,
      // Never auto-claim connected state from stale cache
      connectionState: saved.tiktok?.connectorEndpoint?.trim() ? 'disconnected' : 'unconfigured',
      roomId: null,
      viewerCount: null,
      followerCount: null,
      lastEvent: null,
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
  const [playbackStarted, setPlaybackStarted] = useState<boolean>(false);
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
  const [recoveryGap, setRecoveryGap] = useState<TikTokRecoveryGapInfo | null>(null);
  const [simulationStreamActive, setSimulationStreamActive] = useState<boolean>(false);

  const stateRef = useRef(state);
  stateRef.current = state;

  const activeEventRef = useRef<QueueEvent | null>(activeEvent);
  activeEventRef.current = activeEvent;

  const playbackStartedRef = useRef<boolean>(playbackStarted);
  playbackStartedRef.current = playbackStarted;

  const mouthListenersRef = useRef<Set<MouthListener>>(new Set());
  const recentDedupeRef = useRef<Map<string, number>>(loadPersistedTimestampMap(REAL_DEDUPE_STORAGE_KEY));
  const seenFollowerKeysRef = useRef<Set<string>>(
    new Set(loadPersistedTimestampMap(SEEN_FOLLOWS_STORAGE_KEY).keys())
  );
  const seenFollowerTsRef = useRef<Map<string, number>>(loadPersistedTimestampMap(SEEN_FOLLOWS_STORAGE_KEY));
  const lastMidPrayerIdRef = useRef<string | null>(null);
  const lastPrayerIdRef = useRef<string | null>(null);
  const lastHighDuaIdRef = useRef<string | null>(null);
  const playbackHandleRef = useRef<Stage2PlaybackHandle | null>(null);
  const holdTimeoutRef = useRef<number | null>(null);
  const lastBroadcastSyncRef = useRef<number>(0);
  const tiktokConnectorRef = useRef<TikTokLiveConnectorService | null>(null);

  useEffect(() => {
    const existingEvents = [...stateRef.current.queue, ...stateRef.current.history];
    for (const ev of existingEvents) {
      if (ev.eventType === 'follow') {
        const key = normalizeFollowSessionKey({ userId: ev.userId, username: ev.username });
        seenFollowerKeysRef.current.add(key);
      }
      if (ev.dedupeKey) {
        if (!recentDedupeRef.current.has(ev.dedupeKey)) {
          recentDedupeRef.current.set(ev.dedupeKey, Date.parse(ev.createdAt) || Date.now());
        }
      }
    }
  }, []);

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
      playbackHandleRef.current?.cancel();
      playbackHandleRef.current = null;
      verifiedArabicAudioPlayer.stop();
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
        setPlaybackStarted(Boolean(res.livePlayback.playbackStarted));
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
        setPlaybackStarted(Boolean(payload.playbackStarted));
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
    if (category === 'mid_opening') {
      const picked = pickNonConsecutiveMidPrayer(stateRef.current.prayers, lastMidPrayerIdRef.current);
      if (picked) lastMidPrayerIdRef.current = picked.id;
      return picked;
    }
    const picked = pickNonConsecutivePrayerByCategory(
      stateRef.current.prayers,
      category,
      lastPrayerIdRef.current
    );
    if (picked) lastPrayerIdRef.current = picked.id;
    return picked;
  }, []);

  // High-Tier Arabic + Turkish Duas CRUD (150-299 coins)
  const addHighTierDua = useCallback(
    (input: Omit<HighTierDuaEntry, 'id' | 'updatedAt'>) => {
      const now = new Date().toISOString();
      const entry: HighTierDuaEntry = {
        ...input,
        id: createUniqueId('highdua'),
        title: input.title.trim().slice(0, 120) || 'Yeni Yüksek Seviye Dua',
        sourceCitation: input.sourceCitation.trim(),
        arabicHarekeli: sanitizePrayerTemplate(input.arabicHarekeli),
        turkishMeaning: sanitizePrayerTemplate(input.turkishMeaning),
        personalPrayerTemplate: sanitizePrayerTemplate(input.personalPrayerTemplate),
        audioUrl: input.audioUrl.trim(),
        audioLicense: input.audioLicense.trim(),
        audioAttribution: input.audioAttribution.trim(),
        audioStatus:
          input.audioUrl.trim() && input.audioLicense.trim() && input.audioStatus === 'verified_ready'
            ? 'verified_ready'
            : 'pending_license_verification',
        updatedAt: now,
      };
      setState((prev) => ({
        ...prev,
        highTierDuas: [entry, ...(prev.highTierDuas || [])],
        lastUpdatedAt: now,
      }));
      appendLog('info', 'system', `High-tier dua added: "${entry.title}".`);
    },
    [appendLog]
  );

  const updateHighTierDua = useCallback(
    (id: string, patch: Partial<Omit<HighTierDuaEntry, 'id'>>) => {
      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        highTierDuas: (prev.highTierDuas || []).map((d) =>
          d.id === id
            ? {
                ...d,
                ...patch,
                title: patch.title !== undefined ? patch.title.trim().slice(0, 120) : d.title,
                arabicHarekeli:
                  patch.arabicHarekeli !== undefined
                    ? sanitizePrayerTemplate(patch.arabicHarekeli)
                    : d.arabicHarekeli,
                turkishMeaning:
                  patch.turkishMeaning !== undefined
                    ? sanitizePrayerTemplate(patch.turkishMeaning)
                    : d.turkishMeaning,
                personalPrayerTemplate:
                  patch.personalPrayerTemplate !== undefined
                    ? sanitizePrayerTemplate(patch.personalPrayerTemplate)
                    : d.personalPrayerTemplate,
                updatedAt: now,
              }
            : d
        ),
        lastUpdatedAt: now,
      }));
    },
    []
  );

  const deleteHighTierDua = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        highTierDuas: (prev.highTierDuas || []).filter((d) => d.id !== id),
        lastUpdatedAt: new Date().toISOString(),
      }));
      appendLog('info', 'system', `High-tier dua removed (${id}).`);
    },
    [appendLog]
  );

  const toggleHighTierDuaActive = useCallback((id: string) => {
    const now = new Date().toISOString();
    setState((prev) => ({
      ...prev,
      highTierDuas: (prev.highTierDuas || []).map((d) =>
        d.id === id ? { ...d, isActive: !d.isActive, updatedAt: now } : d
      ),
      lastUpdatedAt: now,
    }));
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

  const updateTierRules = useCallback((patch: Partial<TierRuleConfig>) => {
    setState((prev) => ({
      ...prev,
      tierRules: resolveTierRules({ ...resolveTierRules(prev.tierRules), ...patch }),
      lastUpdatedAt: new Date().toISOString(),
    }));
  }, []);

  const pickNextScholar = useCallback((current: AppState): ScholarId => {
    if (current.scholars.activeMode === 'scholar_1') return 'scholar_1';
    if (current.scholars.activeMode === 'scholar_2') return 'scholar_2';
    const lastQueued = current.queue[current.queue.length - 1] || current.history[0];
    const refSpeaker = lastQueued?.scholarId || current.scholars.currentSpeaker;
    return refSpeaker === 'scholar_1' ? 'scholar_2' : 'scholar_1';
  }, []);

  // Follow Queue Enqueue with Session-Persistent Duplicate Protection
  const enqueueFollowEvent = useCallback(
    (params: {
      source: EventSource;
      username?: string;
      userId?: string;
      externalDedupeKey?: string;
    }): EnqueueResult => {
      setHasUserGesture(true);
      const current = stateRef.current;
      const rawUser =
        params.username && params.username.trim()
          ? params.username
          : SAMPLE_TIKTOK_USERNAMES[Math.floor(Math.random() * SAMPLE_TIKTOK_USERNAMES.length)];
      const safeUser = sanitizeUsername(rawUser);

      const sessionFollowKey = normalizeFollowSessionKey({
        userId: params.userId,
        username: safeUser,
      });
      const followDedupeKey = params.externalDedupeKey
        ? `${params.source}:follow:${params.externalDedupeKey}`
        : `${params.source}:follow:${sessionFollowKey}`;

      if (params.externalDedupeKey) {
        const alreadyInQueueOrHistory = [...current.queue, ...current.history].some(
          (ev) => ev.dedupeKey === followDedupeKey
        );
        if (recentDedupeRef.current.has(followDedupeKey) || alreadyInQueueOrHistory) {
          appendLog('info', 'queue', `Replay/duplicate follow filtered idempotently: @${safeUser}`);
          return { ok: false, reason: `Bu takip olayı (@${safeUser}) zaten işlendi.` };
        }
      }

      if (seenFollowerKeysRef.current.has(sessionFollowKey)) {
        appendLog('info', 'queue', `Repeat follower filtered in session: @${safeUser}`);
        return { ok: false, reason: `Bu oturumda @${safeUser} zaten selamlandı.` };
      }

      const classified = classifyFollowInteraction(
        { username: safeUser, userId: params.userId },
        current.tierRules
      );
      if (!classified.shouldEnqueue) {
        appendLog('info', 'queue', `Follower greeting disabled; skipped @${safeUser}.`);
        return { ok: false, reason: 'Takipçi selamlama seviyesi yönetici panelinde devre dışı.' };
      }

      const nowTs = Date.now();
      seenFollowerKeysRef.current.add(sessionFollowKey);
      seenFollowerTsRef.current.set(sessionFollowKey, nowTs);
      savePersistedTimestampMap(SEEN_FOLLOWS_STORAGE_KEY, seenFollowerTsRef.current, 1000);
      if (params.externalDedupeKey) {
        recentDedupeRef.current.set(followDedupeKey, nowTs);
        savePersistedTimestampMap(REAL_DEDUPE_STORAGE_KEY, recentDedupeRef.current, 1000);
      }

      const chosenScholar = pickNextScholar(current);
      const followEvent: QueueEvent = {
        id: createUniqueId('flw'),
        dedupeKey: followDedupeKey,
        source: params.source,
        eventType: 'follow',
        tier: 'follower',
        userId: params.userId,
        username: safeUser,
        displayUsername: `@${safeUser}`,
        giftId: 'follow',
        giftName: 'Yeni Takipçi',
        quantity: 1,
        priority: 'normal',
        category: 'general_blessings',
        prayerId: 'tier-follower-greeting',
        prayerTitle: 'Takipçi Selamlaması',
        renderedPrayer: classified.renderedGreeting,
        scholarId: chosenScholar,
        status: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
      };

      setState((prev) => {
        const next: AppState = {
          ...prev,
          queue: dedupeEventsById([...prev.queue, followEvent]),
          stats: {
            ...prev.stats,
            realFollowers: (prev.stats.realFollowers ?? 0) + (params.source === 'real' ? 1 : 0),
            simulatedFollowers:
              (prev.stats.simulatedFollowers ?? 0) + (params.source === 'simulation' ? 1 : 0),
          },
          tiktok:
            params.source === 'real'
              ? {
                  ...prev.tiktok,
                  lastEvent: {
                    kind: 'follow',
                    username: safeUser,
                    displayUsername: `@${safeUser}`,
                    summary: 'Yeni takipçi',
                    timestamp: followEvent.createdAt,
                    eventId: followEvent.id,
                  },
                }
              : prev.tiktok,
          lastUpdatedAt: new Date().toISOString(),
        };
        saveLocalState(next);
        return next;
      });

      appendLog('info', 'queue', `[${params.source.toUpperCase()}] Takipçi selamlandı: @${safeUser}.`);
      return { ok: true, event: followEvent };
    },
    [appendLog, pickNextScholar]
  );

  // Smart Queue Enqueue with Stage 2 Coin Tier Flows, Duplicate Protection & Priority Ordering
  const enqueueGiftEvent = useCallback(
    (params: {
      source: EventSource;
      username?: string;
      userId?: string;
      giftIdOrName?: string;
      displayGiftName?: string;
      quantity?: number;
      unitCoins?: number;
      repeatCount?: number;
      giftType?: number;
      repeatEnd?: boolean;
      externalDedupeKey?: string;
    }): EnqueueResult => {
      setHasUserGesture(true);
      const current = stateRef.current;
      const rawUser =
        params.username && params.username.trim()
          ? params.username
          : SAMPLE_TIKTOK_USERNAMES[Math.floor(Math.random() * SAMPLE_TIKTOK_USERNAMES.length)];
      const safeUser = sanitizeUsername(rawUser);
      const qty = Math.max(
        1,
        Math.min(999, Math.floor(Number(params.repeatCount ?? params.quantity ?? 1) || 1))
      );

      // Identify legacy gift rule metadata (if configured)
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

      if (explicitMatch && !explicitMatch.enabled && params.unitCoins === undefined) {
        appendLog('warning', 'queue', `Gift "${explicitMatch.name}" is currently disabled.`);
        return { ok: false, reason: `Gift rule "${explicitMatch.name}" is disabled.` };
      }

      const effectiveGiftName = params.displayGiftName
        ? sanitizeGiftName(params.displayGiftName) || matchedGift?.name || 'Hediye'
        : explicitMatch
        ? explicitMatch.name
        : sanitizeGiftName(params.giftIdOrName || matchedGift?.name || 'Hediye') || 'Hediye';

      const effectiveUnitCoins =
        params.unitCoins !== undefined
          ? params.unitCoins
          : params.source === 'simulation'
          ? matchedGift?.minCoins ?? 1
          : undefined;

      const classification = classifyGiftInteraction(
        {
          username: safeUser,
          userId: params.userId,
          unitCoins: effectiveUnitCoins,
          repeatCount: qty,
          quantity: qty,
          giftType: params.giftType,
          repeatEnd: params.repeatEnd,
        },
        current.tierRules
      );

      if (!classification.shouldEnqueue || !classification.tier) {
        const msg =
          classification.reason === 'tier_disabled'
            ? `Hediye seviyesi (${classification.tier}) yönetici panelinde devre dışı bırakıldığı için atlandı (@${safeUser}).`
            : classification.reason === 'streak_incomplete'
            ? `Eksik hediye serisi henüz tamamlanmadı (@${safeUser}).`
            : `Geçersiz veya eşik dışı jeton değeri nedeniyle hediye atlandı (@${safeUser}, birim=${String(effectiveUnitCoins)}).`;
        appendLog('warning', 'queue', msg);
        return { ok: false, reason: msg };
      }

      // Duplicate & SSE-replay idempotent protection (covers small, mid, high, and yasin_300 equally)
      const dedupeKey = params.externalDedupeKey
        ? `${params.source}:${params.externalDedupeKey}`
        : `${params.source}:${safeUser.toLowerCase()}:${matchedGift?.id || effectiveGiftName.toLowerCase()}:${qty}:${classification.eventCoins}`;
      const queuedDedupeKey = `${dedupeKey}:0`;
      const nowMs = Date.now();
      const windowMs = params.externalDedupeKey
        ? PERSISTED_DEDUPE_TTL_MS
        : Math.max(2, current.tiktok.duplicateWindowSec) * 1000;
      const lastSeen = recentDedupeRef.current.get(dedupeKey);
      const alreadyInQueueOrHistory =
        Boolean(params.externalDedupeKey) &&
        [...current.queue, ...current.history].some(
          (ev) => ev.dedupeKey === queuedDedupeKey || ev.dedupeKey === dedupeKey
        );

      if ((lastSeen && nowMs - lastSeen < windowMs) || alreadyInQueueOrHistory) {
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
      if (recentDedupeRef.current.size > 1000) {
        const cutoff = nowMs - PERSISTED_DEDUPE_TTL_MS;
        for (const [k, ts] of recentDedupeRef.current.entries()) {
          if (ts < cutoff) recentDedupeRef.current.delete(k);
        }
      }
      if (params.externalDedupeKey) {
        savePersistedTimestampMap(REAL_DEDUPE_STORAGE_KEY, recentDedupeRef.current, 1000);
      }

      const tier = classification.tier;
      const chosenScholar = tier === 'yasin_300' ? 'scholar_1' : pickNextScholar(current);
      let category: PrayerCategoryId = matchedGift?.category || 'general_blessings';
      let prayerId = '';
      let prayerTitle = '';
      let renderedPrayer = '';
      let arabicHarekeli: string | undefined;
      let turkishMeaning: string | undefined;
      let sourceCitation: string | undefined;
      let arabicAudioUrl: string | undefined;
      let arabicAudioLicense: string | undefined;
      let arabicAudioAttribution: string | undefined;
      let arabicAudioStatus: QueueEvent['arabicAudioStatus'];
      let yasinIntroSpeech: string | undefined;
      let yasinAudioSha256: string | undefined;

      if (tier === 'small_gift') {
        // 1-49 coins: greeting ONLY, strictly no prayer
        category = 'general_blessings';
        prayerId = 'tier-small-greeting';
        prayerTitle = 'Küçük Hediye Selamlaması';
        renderedPrayer =
          classification.renderedGreeting ||
          renderPersonalizedPrayer(resolveTierRules(current.tierRules).smallGiftGreetingTemplate, safeUser);
      } else if (tier === 'mid_gift') {
        // 50-149 coins: random from Başlangıç Duaları pool, never consecutive repeat
        const pickedMid = pickNonConsecutiveMidPrayer(current.prayers, lastMidPrayerIdRef.current);
        if (!pickedMid) {
          appendLog('error', 'queue', 'Başlangıç Duaları havuzunda aktif dua bulunamadı.');
          return { ok: false, reason: 'Başlangıç Duaları havuzunda aktif dua bulunamadı.' };
        }
        lastMidPrayerIdRef.current = pickedMid.id;
        category = pickedMid.category;
        prayerId = pickedMid.id;
        prayerTitle = pickedMid.title;
        renderedPrayer = renderPersonalizedPrayer(pickedMid.template, safeUser);
      } else if (tier === 'high_gift') {
        // 150-299 coins (high_gift): verified Arabic harekeli dua + Qari audio + family/parents/relatives dua
        const pickedHigh = pickNonConsecutiveHighDua(
          current.highTierDuas || [],
          lastHighDuaIdRef.current
        );
        if (!pickedHigh) {
          appendLog('error', 'queue', 'Yüksek seviye (150-299 jeton) aktif dua bulunamadı.');
          return { ok: false, reason: 'Yüksek seviye dua havuzunda aktif kayıt bulunamadı.' };
        }
        lastHighDuaIdRef.current = pickedHigh.id;
        category = 'family_peace';
        prayerId = pickedHigh.id;
        prayerTitle = pickedHigh.title;
        arabicHarekeli = pickedHigh.arabicHarekeli;
        turkishMeaning = pickedHigh.turkishMeaning;
        sourceCitation = pickedHigh.sourceCitation;
        arabicAudioUrl = pickedHigh.audioUrl;
        arabicAudioLicense = pickedHigh.audioLicense;
        arabicAudioAttribution = pickedHigh.audioAttribution;
        arabicAudioStatus = pickedHigh.audioStatus;
        yasinAudioSha256 = pickedHigh.audioSha256;
        renderedPrayer = stripTurkishMeaningFromSpeech(
          buildHighTierTurkishSpeech(pickedHigh, safeUser),
          pickedHigh.turkishMeaning
        );
      } else {
        // 300+ coins (yasin_300): single atomic 3-phase Yâsîn-i Şerîf sequence led by Hacı Ahmet Efendi (scholar_1)
        // Strict rule: NO Turkish meal is ever attached, displayed on screen, or sent to any TTS engine for Yâsîn.
        const yasinCfg = current.yasinRecitation || DEFAULT_YASIN_RECITATION;
        category = 'general_blessings';
        prayerId = yasinCfg.id;
        prayerTitle = yasinCfg.title || 'Yâsîn-i Şerîf okunuyor';
        arabicHarekeli = yasinCfg.arabicHarekeliHeader;
        turkishMeaning = undefined;
        sourceCitation = yasinCfg.sourceCitation;
        arabicAudioUrl = yasinCfg.audioUrl;
        arabicAudioLicense = yasinCfg.audioLicense;
        arabicAudioAttribution = yasinCfg.audioAttribution;
        arabicAudioStatus = yasinCfg.audioStatus;
        yasinAudioSha256 = yasinCfg.audioSha256;
        yasinIntroSpeech = buildYasinIntroSpeech(yasinCfg, safeUser);
        renderedPrayer = buildYasinClosingSpeech(yasinCfg, safeUser);
      }

      const queuedEvent: QueueEvent = {
        id: createUniqueId('evt'),
        dedupeKey: `${dedupeKey}:0`,
        source: params.source,
        eventType: 'gift',
        tier,
        userId: params.userId,
        username: safeUser,
        displayUsername: `@${safeUser}`,
        giftId: matchedGift?.id || effectiveGiftName.toLowerCase().replace(/\s+/g, '_'),
        giftName: effectiveGiftName,
        quantity: qty,
        unitCoins: classification.unitCoins,
        eventCoins: classification.eventCoins,
        priority: classification.priority,
        category,
        prayerId,
        prayerTitle,
        renderedPrayer,
        arabicHarekeli,
        turkishMeaning,
        sourceCitation,
        arabicAudioUrl,
        arabicAudioLicense,
        arabicAudioAttribution,
        arabicAudioStatus,
        yasinIntroSpeech,
        yasinAudioSha256,
        scholarId: chosenScholar,
        status: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
      };

      setState((prev) => {
        const merged = insertQueueEventPreservingActive(prev.queue, queuedEvent);
        const next: AppState = {
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
        saveLocalState(next);
        return next;
      });

      const catLabel = PRAYER_CATEGORIES.find((c) => c.id === category)?.labelTr || category;
      appendLog(
        'info',
        'queue',
        `[${params.source.toUpperCase()} · ${tier}] ${effectiveGiftName} x${qty} (${classification.eventCoins} jeton) @${safeUser} -> ${prayerTitle} (${catLabel}).`
      );

      return { ok: true, event: queuedEvent };
    },
    [appendLog, pickNextScholar]
  );

  const simulateSampleCayGift = useCallback(() => {
    const cayGift =
      stateRef.current.gifts.find((g) => g.name.toLowerCase() === 'çay' || g.tiktokGiftId === 'cay') ||
      stateRef.current.gifts[0];
    return enqueueGiftEvent({
      source: 'simulation',
      giftIdOrName: cayGift?.id || 'Çay',
      quantity: 1,
      unitCoins: cayGift?.minCoins ?? 1,
    });
  }, [enqueueGiftEvent]);

  // Sequential Queue Playback Engine (runs in Admin view; waits for user gesture on Android Chrome/WebView)
  useEffect(() => {
    if (isBroadcastView) return;
    if (!hasUserGesture) return;
    if (state.queuePaused || activeEvent !== null || playbackHandleRef.current?.isLocked()) return;

    const nextPending = state.queue.find((q) => q.status === 'pending');
    if (!nextPending) return;

    // Mark event as speaking
    const startedEvent: QueueEvent = {
      ...nextPending,
      status: 'speaking',
      playbackPhase:
        nextPending.tier === 'yasin_300'
          ? 'yasin_intro'
          : nextPending.tier === 'high_gift' &&
            nextPending.arabicAudioStatus === 'verified_ready' &&
            nextPending.arabicAudioUrl
          ? 'arabic_audio'
          : 'turkish_speech',
      attempts: nextPending.attempts + 1,
      startedAt: new Date().toISOString(),
    };

    playbackStartedRef.current = false;
    setPlaybackStarted(false);
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
      playbackStarted: false,
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
    const isAndroidNative = isNativeAndroidEnvironment();
    const chosenScholar1Engine =
      voiceCfg.scholar1Engine === 'ema_lightning'
        ? 'ema_lightning'
        : voiceCfg.scholar1Engine === 'zerre_ses_a'
        ? 'zerre_ses_a'
        : 'seslen_hasan';
    const effectiveRate =
      startedEvent.scholarId === 'scholar_1' && isAndroidNative
        ? chosenScholar1Engine === 'ema_lightning'
          ? voiceCfg.emaLightningRate ?? 1.0
          : chosenScholar1Engine === 'zerre_ses_a'
          ? voiceCfg.zerreSesARate ?? 0.94
          : voiceCfg.seslenHasanRate ?? 0.94
        : prosody.rate;

    if (isAndroidNative) {
      appendLog(
        'info',
        'tts',
        startedEvent.scholarId === 'scholar_1'
          ? chosenScholar1Engine === 'ema_lightning'
            ? `Dua kuyruğu motor yönlendirmesi: Hacı Ahmet Efendi (scholar_1) -> EMA Lightning (Yerel ONNX 48 kHz${
                voiceCfg.emaLightningFallbackToHasan !== false ? ' · pre-start Hasan fallback açık' : ''
              })`
            : chosenScholar1Engine === 'zerre_ses_a'
            ? `Dua kuyruğu motor yönlendirmesi: Hacı Ahmet Efendi (scholar_1) -> Zerre SES-A (MK Yerel ONNX 24 kHz${
                voiceCfg.zerreSesAFallbackToHasan !== false ? ' · pre-start Hasan fallback açık' : ''
              })`
            : 'Dua kuyruğu motor yönlendirmesi: Hacı Ahmet Efendi (scholar_1) -> Seslen-TTS Hasan (Yerel ONNX)'
          : 'Dua kuyruğu motor yönlendirmesi: Hacı Mehmet Efendi (scholar_2) -> Antalia-2 Mini (Android Sistem TTS)'
      );
    }

    setLastSpeechError(null);
    let handle: Stage2PlaybackHandle | null = null;
    let settledSynchronously = false;
    let outcomeSettled = false;
    let currentPhase: QueueEvent['playbackPhase'] = startedEvent.playbackPhase;
    handle = executeStage2PlaybackSequence({
      event: startedEvent,
      arabicPlayer: verifiedArabicAudioPlayer,
      turkishTts: studioTTSRouter,
      arabicStartTimeoutMs: startedEvent.tier === 'yasin_300' ? 20000 : 12000,
      ttsOptions: {
        scholarId: startedEvent.scholarId,
        scholar1Engine: startedEvent.scholarId === 'scholar_1' ? chosenScholar1Engine : undefined,
        emaFallbackToHasan: voiceCfg.emaLightningFallbackToHasan,
        zerreFallbackToHasan: voiceCfg.zerreSesAFallbackToHasan,
        zerreApproved: voiceCfg.zerreSesAApproved,
        preferredEngine: voiceCfg.provider,
        voiceURI: chosenVoiceURI,
        neuralProviderId: voiceCfg.neuralProviderId,
        neuralVoiceId: chosenNeuralVoiceId,
        tone: voiceCfg.narrationTone,
        fallbackToBrowser: voiceCfg.fallbackToBrowser,
        forbiddenMealText:
          startedEvent.tier === 'yasin_300'
            ? stateRef.current.yasinRecitation?.turkishMealNotice || undefined
            : startedEvent.turkishMeaning,
        lang: voiceCfg.language || 'tr-TR',
        rate: effectiveRate,
        pitch: prosody.pitch,
        volume: voiceCfg.volume,
      },
      onPhaseChange: (phase) => {
        currentPhase = phase;
        setActiveEvent((prev) =>
          prev && prev.id === startedEvent.id ? { ...prev, playbackPhase: phase } : prev
        );
        pushLivePlayback({
          activeEvent: { ...startedEvent, playbackPhase: phase },
          speakingState: 'speaking',
          activeScholar: startedEvent.scholarId,
          mouthLevel: 0.25,
          playbackStarted: playbackStartedRef.current,
        });
      },
      onStart: () => {
        playbackStartedRef.current = true;
        setPlaybackStarted(true);
        setSpeakingState('speaking');
        pushLivePlayback({
          activeEvent: activeEventRef.current || startedEvent,
          speakingState: 'speaking',
          activeScholar: startedEvent.scholarId,
          mouthLevel: 0.35,
          playbackStarted: true,
        });
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
            activeEvent: activeEventRef.current || startedEvent,
            speakingState: 'speaking',
            activeScholar: startedEvent.scholarId,
            mouthLevel: level,
            playbackStarted: playbackStartedRef.current,
          });
        }
      },
      onComplete: () => {
        if (outcomeSettled) return;
        outcomeSettled = true;
        settledSynchronously = true;
        if (!handle || playbackHandleRef.current === handle) {
          playbackHandleRef.current = null;
        }
        emitMouthLevel(0);
        playbackStartedRef.current = false;
        setPlaybackStarted(false);
        setSpeakingState('holding');
        pushLivePlayback({
          activeEvent: activeEventRef.current || startedEvent,
          speakingState: 'holding',
          activeScholar: startedEvent.scholarId,
          mouthLevel: 0,
          playbackStarted: false,
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
          setPlaybackStarted(false);
          playbackStartedRef.current = false;
          pushLivePlayback({
            activeEvent: null,
            speakingState: 'idle',
            activeScholar: startedEvent.scholarId,
            mouthLevel: 0,
            playbackStarted: false,
          });
        }, holdMs);
      },
      onError: (reason) => {
        if (outcomeSettled) return;
        outcomeSettled = true;
        settledSynchronously = true;
        if (!handle || playbackHandleRef.current === handle) {
          playbackHandleRef.current = null;
        }
        emitMouthLevel(0);
        playbackStartedRef.current = false;
        setPlaybackStarted(false);
        const phaseTaggedReason =
          startedEvent.tier === 'yasin_300' && currentPhase
            ? `[Faz: ${currentPhase}] ${reason}`
            : reason;
        setLastSpeechError(phaseTaggedReason);
        const failedEvent: QueueEvent = {
          ...startedEvent,
          playbackPhase: currentPhase,
          status: 'failed',
          errorMessage: phaseTaggedReason,
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
              message: `Playback error for ${startedEvent.displayUsername}: ${phaseTaggedReason}`,
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
          playbackStarted: false,
        });
      },
    });
    if (!settledSynchronously && handle.isLocked()) {
      playbackHandleRef.current = handle;
    } else if (playbackHandleRef.current === handle) {
      playbackHandleRef.current = null;
    }
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
    playbackHandleRef.current?.pause();
    if (!playbackHandleRef.current) {
      verifiedArabicAudioPlayer.pause();
      studioTTSRouter.pause();
    }
    setIsSpeechPaused(true);
    emitMouthLevel(0);
  }, [emitMouthLevel]);

  const resumeSpeech = useCallback(() => {
    playbackHandleRef.current?.resume();
    if (!playbackHandleRef.current) {
      verifiedArabicAudioPlayer.resume();
      studioTTSRouter.resume();
    }
    setIsSpeechPaused(false);
  }, []);

  const stopCurrentSpeech = useCallback(() => {
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    playbackHandleRef.current?.cancel();
    playbackHandleRef.current = null;
    verifiedArabicAudioPlayer.stop();
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
    playbackStartedRef.current = false;
    setPlaybackStarted(false);
    setActiveEvent(null);
    setSpeakingState('idle');
    pushLivePlayback({
      activeEvent: null,
      speakingState: 'idle',
      activeScholar: stateRef.current.scholars.currentSpeaker,
      mouthLevel: 0,
      playbackStarted: false,
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
      if (activeEventRef.current || playbackHandleRef.current?.isLocked() || verifiedArabicAudioPlayer.isPlaying()) {
        return; // Don't clobber active queue or Arabic audio playback
      }
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

      const chosenScholar1Engine =
        voiceCfg.scholar1Engine === 'ema_lightning'
          ? 'ema_lightning'
          : voiceCfg.scholar1Engine === 'zerre_ses_a'
          ? 'zerre_ses_a'
          : 'seslen_hasan';
      const effectiveRate =
        scholarId === 'scholar_1' && isNativeAndroidEnvironment()
          ? chosenScholar1Engine === 'ema_lightning'
            ? voiceCfg.emaLightningRate ?? 1.0
            : chosenScholar1Engine === 'zerre_ses_a'
            ? voiceCfg.zerreSesARate ?? 0.94
            : voiceCfg.seslenHasanRate ?? 0.94
          : prosody.rate;

      setLastSpeechError(null);
      setState((prev) => ({
        ...prev,
        scholars: { ...prev.scholars, currentSpeaker: scholarId },
      }));
      setSpeakingState('speaking');
      studioTTSRouter.speak(sampleText, {
        scholarId,
        scholar1Engine: scholarId === 'scholar_1' ? chosenScholar1Engine : undefined,
        emaFallbackToHasan: voiceCfg.emaLightningFallbackToHasan,
        zerreFallbackToHasan: voiceCfg.zerreSesAFallbackToHasan,
        zerreApproved: voiceCfg.zerreSesAApproved,
        preferredEngine: voiceCfg.provider,
        voiceURI: chosenVoiceURI,
        neuralProviderId: voiceCfg.neuralProviderId,
        neuralVoiceId: chosenNeuralVoiceId,
        tone: voiceCfg.narrationTone,
        fallbackToBrowser: voiceCfg.fallbackToBrowser,
        lang: voiceCfg.language || 'tr-TR',
        rate: effectiveRate,
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
      if (activeEventRef.current || playbackHandleRef.current?.isLocked() || verifiedArabicAudioPlayer.isPlaying()) {
        return;
      }
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
        scholarId,
        forceStandardSystemTts: true,
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
      if (activeEventRef.current || playbackHandleRef.current?.isLocked() || verifiedArabicAudioPlayer.isPlaying()) {
        return Promise.resolve({
          ok: false,
          message: 'A queued prayer or Arabic recitation is currently playing. Wait for it to finish or stop it first.',
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

  const createConnectorCallbacks = useCallback(
    () => ({
      onStatusChange: (payload: {
        state: TikTokConnectionConfig['connectionState'];
        roomId?: string | null;
        viewerCount?: number | null;
        followerCount?: number | null;
        lastEvent?: TikTokConnectionConfig['lastEvent'];
        error?: string | null;
        updatedAt: string;
      }) => {
        setState((prev) => {
          const nextRoomId = payload.roomId !== undefined ? payload.roomId : prev.tiktok.roomId;
          const nextViewerCount =
            payload.viewerCount !== undefined ? payload.viewerCount : prev.tiktok.viewerCount;
          const nextFollowerCount =
            payload.followerCount !== undefined ? payload.followerCount : prev.tiktok.followerCount;
          const nextLastEvent =
            payload.lastEvent !== undefined ? payload.lastEvent : prev.tiktok.lastEvent;
          const nextError = payload.error !== undefined ? payload.error : prev.tiktok.lastError;
          if (
            prev.tiktok.connectionState === payload.state &&
            prev.tiktok.roomId === nextRoomId &&
            prev.tiktok.viewerCount === nextViewerCount &&
            prev.tiktok.followerCount === nextFollowerCount &&
            prev.tiktok.lastEvent === nextLastEvent &&
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
              followerCount: nextFollowerCount,
              lastEvent: nextLastEvent,
              lastError: nextError,
              lastCheckedAt: payload.updatedAt,
            },
          };
        });
      },
      onRecoveryGap: (gap: TikTokRecoveryGapInfo) => {
        setRecoveryGap(gap);
      },
      onFinalizedGift: (gift: {
        isSimulated?: boolean;
        username: string;
        userId?: string;
        giftName: string;
        giftId: string;
        quantity: number;
        unitCoins?: number;
        diamondCount?: number;
        repeatCount?: number;
        giftType?: number;
        repeatEnd?: boolean;
        streakKey: string;
        transactionId?: string;
        sseEventId?: string;
      }) => {
        const res = enqueueGiftEvent({
          source: gift.isSimulated ? 'simulation' : 'real',
          username: gift.username,
          userId: gift.userId,
          giftIdOrName: gift.giftName || gift.giftId,
          displayGiftName: gift.giftName,
          quantity: gift.quantity,
          unitCoins: gift.unitCoins ?? gift.diamondCount,
          repeatCount: gift.repeatCount ?? gift.quantity,
          giftType: gift.giftType,
          repeatEnd: gift.repeatEnd,
          externalDedupeKey: gift.transactionId || gift.streakKey || gift.sseEventId,
        });
        if (!gift.isSimulated && res.ok && res.event) {
          const ev = res.event;
          setState((prev) => ({
            ...prev,
            tiktok: {
              ...prev.tiktok,
              lastEvent: {
                kind: 'gift',
                username: ev.username,
                displayUsername: ev.displayUsername,
                summary: `${ev.giftName} ×${ev.quantity}`,
                coins: ev.eventCoins,
                timestamp: ev.createdAt,
                eventId: ev.id,
              },
            },
          }));
        }
      },
      onFollowEvent: (follow: {
        isSimulated?: boolean;
        username?: string;
        nickname?: string;
        userId?: string;
        dedupeKey?: string;
        eventId: string;
      }) => {
        enqueueFollowEvent({
          source: follow.isSimulated ? 'simulation' : 'real',
          username: follow.username || follow.nickname,
          userId: follow.userId,
          externalDedupeKey: follow.dedupeKey || follow.eventId,
        });
      },
      onLog: (level: 'info' | 'warning' | 'error', message: string) => {
        appendLog(level, 'tiktok', message);
      },
    }),
    [enqueueGiftEvent, enqueueFollowEvent, appendLog]
  );

  // Persistent TikTokLiveConnectorService lifecycle (Admin view only)
  useEffect(() => {
    if (isBroadcastView) return;

    const connector = new TikTokLiveConnectorService(
      stateRef.current.tiktok,
      createConnectorCallbacks()
    );

    tiktokConnectorRef.current = connector;
    return () => {
      connector.dispose();
      if (tiktokConnectorRef.current === connector) {
        tiktokConnectorRef.current = null;
      }
    };
  }, [isBroadcastView, createConnectorCallbacks]);

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
    const callbacks = createConnectorCallbacks();
    const connector =
      tiktokConnectorRef.current || new TikTokLiveConnectorService(tk, callbacks);

    connector.updateCallbacks(callbacks);
    if (!tiktokConnectorRef.current) {
      tiktokConnectorRef.current = connector;
    }

    setSimulationStreamActive(false);
    connector.updateConfig(tk);
    const result = await connector.connect(tk.username);
    if (!result.ok && result.error) {
      appendLog('warning', 'tiktok', result.error);
    }
    return result;
  }, [appendLog, createConnectorCallbacks]);

  const reconnectTikTok = useCallback(async () => {
    const tk = stateRef.current.tiktok;
    const callbacks = createConnectorCallbacks();
    const connector =
      tiktokConnectorRef.current || new TikTokLiveConnectorService(tk, callbacks);
    connector.updateCallbacks(callbacks);
    if (!tiktokConnectorRef.current) {
      tiktokConnectorRef.current = connector;
    }
    setSimulationStreamActive(false);
    connector.updateConfig(tk);
    const result = await connector.reconnect(tk.username);
    if (!result.ok && result.error) {
      appendLog('warning', 'tiktok', `TikTok LIVE yeniden bağlanma hatası: ${result.error}`);
    } else {
      appendLog('info', 'tiktok', `TikTok LIVE yeniden bağlandı (@${tk.username}).`);
    }
    return result;
  }, [appendLog, createConnectorCallbacks]);

  const checkRelayHealth = useCallback(async (explicitEndpoint?: string) => {
    const tk = stateRef.current.tiktok;
    const connector =
      tiktokConnectorRef.current || new TikTokLiveConnectorService(tk, createConnectorCallbacks());
    connector.updateConfig({
      ...tk,
      ...(explicitEndpoint !== undefined ? { connectorEndpoint: explicitEndpoint } : {}),
    });
    const res = await connector.checkHealth(explicitEndpoint);
    appendLog(
      res.ok ? 'info' : 'warning',
      'tiktok',
      res.ok
        ? `Relay sağlık testi başarılı (${res.latencyMs} ms · v${res.connectorVersion || '2.5.0'} · simulation=${String(res.simulationEnabled)}).`
        : `Relay sağlık testi başarısız: ${res.error || 'Bilinmeyen hata'}`
    );
    return res;
  }, [appendLog, createConnectorCallbacks]);

  const disconnectTikTok = useCallback(async () => {
    setSimulationStreamActive(false);
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

  const dismissRecoveryGap = useCallback(() => {
    setRecoveryGap(null);
  }, []);

  const startSimulationSseListener = useCallback(() => {
    const tk = stateRef.current.tiktok;
    const callbacks = createConnectorCallbacks();
    const connector =
      tiktokConnectorRef.current || new TikTokLiveConnectorService(tk, callbacks);
    connector.updateCallbacks(callbacks);
    connector.updateConfig(tk);
    if (!tiktokConnectorRef.current) {
      tiktokConnectorRef.current = connector;
    }
    const res = connector.connectSimulationStream(tk.username);
    setSimulationStreamActive(res.ok);
    return res;
  }, [createConnectorCallbacks]);

  const stopSimulationSseListener = useCallback(() => {
    tiktokConnectorRef.current?.stopSimulationStream();
    setSimulationStreamActive(false);
    appendLog('info', 'tiktok', 'Simülasyon SSE test akışı durduruldu.');
  }, [appendLog]);

  const triggerRelaySimulation = useCallback(
    async (
      scenario:
        | 'follower'
        | 'small_gift'
        | 'mid_gift'
        | 'high_gift'
        | 'yasin_300'
        | 'streak'
        | 'incomplete_streak',
      opts?: { unitCoins?: number; steps?: number[]; includeRepeatEnd?: boolean }
    ): Promise<{ ok: boolean; message: string }> => {
      const tk = stateRef.current.tiktok;
      const baseUrl = normalizeRelayBaseUrl(tk.connectorEndpoint);
      if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
        return {
          ok: false,
          message: 'Önce geçerli bir Relay Sunucusu URL adresi girin.',
        };
      }

      if (
        !tiktokConnectorRef.current?.isSimulationStreamActive &&
        tk.connectionState !== 'connected'
      ) {
        startSimulationSseListener();
      }

      try {
        const response = await fetch(`${baseUrl}/simulate`, {
          method: 'POST',
          mode: 'cors',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            username: sanitizeTikTokHandle(tk.username) || 'fcproplayer7',
            scenario,
            ...opts,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          emittedCount?: number;
          bufferedCount?: number;
          error?: string;
        };

        if (response.status === 404) {
          return {
            ok: false,
            message:
              'Relay sunucusunda /simulate kapalı (HTTP 404 — Production güvenliği aktif). Test için relay sunucusunu SIMULATION_ENABLED=true ile başlatın.',
          };
        }
        if (!response.ok || !data.ok) {
          return {
            ok: false,
            message: data.error || `Simülasyon isteği başarısız oldu (HTTP ${response.status}).`,
          };
        }
        return {
          ok: true,
          message: `Relay SSE simülasyonu gönderildi (${scenario}: ${data.emittedCount ?? 0} yayınlandı, ${data.bufferedCount ?? 0} ara seri tamponlandı).`,
        };
      } catch (err) {
        return {
          ok: false,
          message:
            err instanceof Error
              ? `Relay simülasyon isteği başarısız: ${err.message}`
              : 'Relay simülasyon isteği başarısız.',
        };
      }
    },
    [startSimulationSseListener]
  );

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
        const importedYasin = parsed.yasinRecitation;
        const shouldResetImportedYasin =
          !importedYasin ||
          (importedYasin.id === DEFAULT_YASIN_RECITATION.id &&
            (importedYasin.audioSha256 !== DEFAULT_YASIN_RECITATION.audioSha256 ||
              importedYasin.audioStatus !== DEFAULT_YASIN_RECITATION.audioStatus));
        setState({
          ...defaults,
          ...parsed,
          yasinRecitation: shouldResetImportedYasin
            ? { ...DEFAULT_YASIN_RECITATION }
            : {
                ...DEFAULT_YASIN_RECITATION,
                ...importedYasin,
                turkishMealNotice: '',
              },
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
      playbackStarted,
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
      addHighTierDua,
      updateHighTierDua,
      deleteHighTierDua,
      toggleHighTierDuaActive,
      addGift,
      updateGift,
      deleteGift,
      toggleGiftEnabled,
      updateTierRules,
      enqueueGiftEvent,
      enqueueFollowEvent,
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
      reconnectTikTok,
      checkRelayHealth,
      disconnectTikTok,
      recoveryGap,
      dismissRecoveryGap,
      simulationStreamActive,
      startSimulationSseListener,
      stopSimulationSseListener,
      triggerRelaySimulation,
      updateBroadcastConfig,
      addLog: appendLog,
      resetAllDefaults,
      importStateJson,
    }),
    [
      state,
      activeEvent,
      speakingState,
      playbackStarted,
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
      addHighTierDua,
      updateHighTierDua,
      deleteHighTierDua,
      toggleHighTierDuaActive,
      addGift,
      updateGift,
      deleteGift,
      toggleGiftEnabled,
      updateTierRules,
      enqueueGiftEvent,
      enqueueFollowEvent,
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
      reconnectTikTok,
      checkRelayHealth,
      disconnectTikTok,
      recoveryGap,
      dismissRecoveryGap,
      simulationStreamActive,
      startSimulationSseListener,
      stopSimulationSseListener,
      triggerRelaySimulation,
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
