export type PrayerCategoryId =
  | 'mid_opening'
  | 'health_healing'
  | 'blessings_abundance'
  | 'family_peace'
  | 'good_fortune'
  | 'relief_difficulties'
  | 'parents'
  | 'happiness_tranquility'
  | 'general_blessings';

export interface PrayerCategoryMeta {
  id: PrayerCategoryId;
  labelTr: string;
  labelEn: string;
  description: string;
}

export interface PrayerTemplate {
  id: string;
  title: string;
  category: PrayerCategoryId;
  template: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type GiftPriority = 'normal' | 'high' | 'urgent';

export interface GiftRule {
  id: string;
  name: string;
  tiktokGiftId: string;
  category: PrayerCategoryId;
  quantityMultiplier: number;
  repeatPerQuantity: boolean;
  priority: GiftPriority;
  enabled: boolean;
  minCoins: number;
  updatedAt: string;
}

export type InteractionTierId =
  | 'follower'
  | 'small_gift'
  | 'mid_gift'
  | 'high_gift'
  | 'yasin_300';

export type IncomingEventType = 'gift' | 'follow';

export interface TierRuleConfig {
  smallGiftMinCoins: number;
  smallGiftMaxCoins: number;
  midGiftMinCoins: number;
  midGiftMaxCoins: number;
  highGiftMinCoins: number;
  highGiftMaxCoins: number;
  yasinMinCoins: number;
  coinEvaluationMode: 'event_total' | 'unit_only';
  followerEnabled: boolean;
  smallGiftEnabled?: boolean;
  midGiftEnabled?: boolean;
  highGiftEnabled?: boolean;
  yasinEnabled?: boolean;
  followerGreetingTemplate: string;
  smallGiftGreetingTemplate: string;
}

export type VerifiedAudioStatus = 'verified_ready' | 'pending_license_verification';

export interface HighTierDuaEntry {
  id: string;
  title: string;
  sourceCitation: string;
  arabicHarekeli: string;
  turkishMeaning: string;
  personalPrayerTemplate: string;
  audioUrl: string;
  audioLicense: string;
  audioAttribution: string;
  audioSha256?: string;
  audioStatus: VerifiedAudioStatus;
  isActive: boolean;
  updatedAt: string;
}

export type EventSource = 'simulation' | 'real';
export type QueueEventStatus = 'pending' | 'speaking' | 'completed' | 'failed' | 'cancelled';

export interface QueueEvent {
  id: string;
  dedupeKey: string;
  source: EventSource;
  eventType?: IncomingEventType;
  tier?: InteractionTierId;
  userId?: string;
  username: string;
  displayUsername: string;
  giftId: string;
  giftName: string;
  quantity: number;
  unitCoins?: number;
  eventCoins?: number;
  priority: GiftPriority;
  category: PrayerCategoryId;
  prayerId: string;
  prayerTitle: string;
  renderedPrayer: string;
  arabicHarekeli?: string;
  turkishMeaning?: string;
  sourceCitation?: string;
  arabicAudioUrl?: string;
  arabicAudioLicense?: string;
  arabicAudioAttribution?: string;
  arabicAudioStatus?: VerifiedAudioStatus;
  yasinIntroSpeech?: string;
  yasinAudioSha256?: string;
  playbackPhase?: 'yasin_intro' | 'arabic_audio' | 'turkish_speech';
  scholarId: 'scholar_1' | 'scholar_2';
  status: QueueEventStatus;
  attempts: number;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface YasinRecitationConfig {
  id: string;
  title: string;
  sourceCitation: string;
  arabicHarekeliHeader: string;
  turkishMealNotice: string;
  introSpeechTemplate: string;
  closingPrayerTemplate: string;
  audioUrl: string;
  audioSourceUrl?: string;
  audioLicense: string;
  audioAttribution: string;
  audioSha256?: string;
  expectedFileBytes?: number;
  durationSec?: number;
  durationLabel?: string;
  audioStatus: VerifiedAudioStatus;
  acceptedFormats: string[];
  missingAudioInstruction: string;
  updatedAt: string;
}

export type ScholarId = 'scholar_1' | 'scholar_2';
export type ActiveScholarMode = 'scholar_1' | 'scholar_2' | 'alternate';

export interface ScholarProfile {
  id: ScholarId;
  name: string;
  title: string;
  bio: string;
  capColor: string;
  jacketColor: string;
  beardStyle: 'full_white' | 'trimmed_silver';
  hasSpectacles: boolean;
  voiceName: string;
  rigProvider: 'procedural' | 'custom_gltf';
  customModelUrl: string;
}

export interface ScholarSettingsConfig {
  activeMode: ActiveScholarMode;
  currentSpeaker: ScholarId;
  blinkIntervalSec: number;
  headMovementIntensity: number;
  idleBreathingIntensity: number;
  listenerInteractionEnabled: boolean;
  profiles: Record<ScholarId, ScholarProfile>;
}

export type TTSProviderType = 'browser_speech_synthesis' | 'external_studio_adapter';
export type NeuralTTSProviderId = 'azure_neural' | 'piper_local' | 'elevenlabs' | 'custom_http';

export interface VoiceSettingsConfig {
  provider: TTSProviderType;
  neuralProviderId: NeuralTTSProviderId;
  neuralVoiceId: string;
  neuralScholar2VoiceId: string;
  narrationTone: 'calm_elderly' | 'warm_classic';
  fallbackToBrowser: boolean;
  language: string;
  selectedVoiceURI: string;
  scholar2VoiceURI: string;
  rate: number;
  pitch: number;
  volume: number;
  externalEndpoint: string;
  scholar1IndependentEnabled: boolean;
  scholar1VoiceURI: string;
  scholar1Rate: number;
  scholar1Pitch: number;
  seslenHasanRate?: number;
  scholar1Engine?: 'seslen_hasan' | 'ema_lightning' | 'zerre_ses_a';
  emaLightningRate?: number;
  emaLightningFallbackToHasan?: boolean;
  emaLightningApproved?: boolean;
  zerreSesARate?: number;
  zerreSesAFallbackToHasan?: boolean;
  zerreSesAApproved?: boolean;
}

export type TikTokConnectionState =
  | 'unconfigured'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface TikTokLastEventSummary {
  kind: 'gift' | 'follow' | 'status' | 'error';
  username?: string;
  displayUsername?: string;
  summary: string;
  coins?: number;
  timestamp: string;
  eventId?: string;
}

export interface TikTokConnectionConfig {
  username: string;
  connectionState: TikTokConnectionState;
  connectorEndpoint: string;
  autoReconnect: boolean;
  maxRetries: number;
  retryDelaySec: number;
  duplicateWindowSec: number;
  lastError: string | null;
  lastCheckedAt: string | null;
  roomId?: string | null;
  viewerCount?: number | null;
  followerCount?: number | null;
  lastEvent?: TikTokLastEventSummary | null;
}

export interface TikTokRelayGiftPayload {
  eventId: string;
  sseEventId?: string;
  transactionId?: string;
  groupId?: string;
  isSimulated?: boolean;
  replayed?: boolean;
  streakKey: string;
  userId?: string;
  username: string;
  nickname?: string;
  giftId: string;
  giftName: string;
  quantity: number;
  unitCoins?: number;
  unitCoinsSource?: 'extendedGiftInfo.diamond_count' | 'gift.diamond_count' | 'diamondCount' | 'none';
  diamondCount?: number;
  giftType?: number;
  repeatCount?: number;
  repeatEnd?: boolean;
  rawMeta?: Record<string, unknown>;
  timestamp: string;
}

export interface TikTokRelayFollowPayload {
  eventId: string;
  sseEventId?: string;
  isSimulated?: boolean;
  replayed?: boolean;
  dedupeKey: string;
  userId?: string;
  username: string;
  nickname?: string;
  rawEventType?: 'follow' | 'social' | 'simulation';
  displayType?: string;
  msgId?: string;
  timestamp: string;
}

export interface TikTokRecoveryGapInfo {
  reason: 'relay_restarted' | 'buffer_evicted' | 'sequence_mismatch';
  message: string;
  instanceId?: string;
  previousInstanceId?: string;
  lastReceivedSeq?: number;
  oldestAvailableSeq?: number | null;
  currentSeq?: number;
  missedEstimate?: number;
  sseEventId?: string;
  timestamp: string;
}

export interface TikTokConnectorStatusPayload {
  state: TikTokConnectionState;
  username: string;
  roomId?: string | null;
  viewerCount?: number | null;
  followerCount?: number | null;
  lastEvent?: TikTokLastEventSummary | null;
  lastErrorCategory?: string | null;
  error?: string | null;
  sseEventId?: string;
  instanceId?: string;
  simulationEnabled?: boolean;
  updatedAt: string;
}

export interface SystemLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  source: 'tiktok' | 'queue' | 'tts' | 'system';
  message: string;
}

export interface BroadcastSettingsConfig {
  studioTitle: string;
  showSenderCard: boolean;
  showPrayerText: boolean;
  showScholarNames: boolean;
  goldAnimationsEnabled: boolean;
  postSpeechHoldSec: number;
  cameraPreset: 'broadcast_portrait' | 'wide_mihrab' | 'scholar_closeup';
}

export type AdminSectionId =
  | 'overview'
  | 'prayers'
  | 'gifts'
  | 'studio'
  | 'scholars'
  | 'voice'
  | 'queue'
  | 'history'
  | 'tiktok'
  | 'settings';

export interface StudioStats {
  totalGifts: number;
  totalPrayers: number;
  simulatedGifts: number;
  realGifts: number;
  realFollowers?: number;
  simulatedFollowers?: number;
}

export interface AppState {
  prayers: PrayerTemplate[];
  gifts: GiftRule[];
  tierRules?: TierRuleConfig;
  highTierDuas?: HighTierDuaEntry[];
  yasinRecitation?: YasinRecitationConfig;
  queue: QueueEvent[];
  history: QueueEvent[];
  queuePaused: boolean;
  scholars: ScholarSettingsConfig;
  voice: VoiceSettingsConfig;
  tiktok: TikTokConnectionConfig;
  broadcast: BroadcastSettingsConfig;
  logs: SystemLogEntry[];
  stats: StudioStats;
  lastUpdatedAt: string;
}

/**
 * Modular adapter contract so licensed GLTF/VRM photorealistic 3D characters
 * can replace the procedural Three.js scholar rigs without rebuilding the scene.
 */
export interface IScholarCharacterRig {
  readonly id: ScholarId;
  readonly providerType: 'procedural' | 'gltf';
  setSpeaking(isSpeaking: boolean): void;
  setListeningTo(targetSide: 'left' | 'right' | 'center'): void;
  setMouthOpen(amount: number): void;
  update(deltaSec: number, elapsedSec: number): void;
  dispose(): void;
}

export type LipSyncVisemeId =
  | 'rest'
  | 'closed_mbp'
  | 'labiodental_fv'
  | 'round_o'
  | 'round_u'
  | 'open_a'
  | 'open_e'
  | 'spread_i'
  | 'neutral_c';

export type LipSyncSyncMode =
  | 'engine_boundary_viseme'
  | 'pcm_envelope_viseme'
  | 'spectral_audio_viseme'
  | 'resting';

export type ScholarAnimationPhase =
  | 'IDLE'
  | 'SPEAKING'
  | 'SPEECH_PAUSE'
  | 'RAISING_HANDS'
  | 'AMEEN'
  | 'WIPING_FACE'
  | 'RETURNING_TO_IDLE';

export interface ScholarAnimationSnapshot {
  scholarId: ScholarId;
  phase: ScholarAnimationPhase;
  /** 0 = hands resting on thighs, 1 = hands lifted into gesture space */
  handLiftProgress: number;
  /** 0 = palms down (lap), 1 = palms up (🤲🏻), -1 = palms facing self (face wipe) */
  palmOrientation: number;
  /** 0 = chest height, 0 -> 1 = forehead -> cheeks -> chin wipe sweep */
  wipeProgress: number;
  /** 0 = relaxed on lap, ~0.38 = cupped 🤲🏻, ~0.22 = soft wipe */
  fingerCurl: number;
  /** Reverent calm eye softness (0..1) during AMEEN / WIPING_FACE */
  calmEyeSoftness: number;
  /** Gentle reverent head tilt/nod offset (-1..1) */
  gestureHeadNod: number;
  /** Strict guard: true ONLY when this scholar's mouth may articulate Turkish phonemes */
  mouthAllowed: boolean;
  /** Phase duration in ms for smooth cross-tab / OBS interpolation */
  phaseDurationMs: number;
  /** Wall timestamp when current phase started */
  phaseStartedAtMs: number;
  /** Updated timestamp */
  updatedAtMs: number;
}

export interface LipSyncFrame {
  level: number;
  viseme: LipSyncVisemeId;
  jawOpen: number;
  lipRound: number;
  lipClose: number;
  lipSpread: number;
  lowerLipTuck: number;
  active: boolean;
  isPause?: boolean;
  scholarId?: ScholarId;
  syncMode?: LipSyncSyncMode;
}

export interface TTSSpeakOptions {
  scholarId?: ScholarId;
  scholar1Engine?: 'seslen_hasan' | 'ema_lightning' | 'zerre_ses_a';
  emaFallbackToHasan?: boolean;
  zerreFallbackToHasan?: boolean;
  zerreApproved?: boolean;
  forceStandardSystemTts?: boolean;
  preferredEngine?: TTSProviderType;
  voiceURI?: string;
  neuralProviderId?: NeuralTTSProviderId;
  neuralVoiceId?: string;
  tone?: 'calm_elderly' | 'warm_classic';
  fallbackToBrowser?: boolean;
  forbiddenMealText?: string;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  onStart?: () => void;
  onMouthLevel?: (level: number) => void;
  onLipSyncFrame?: (frame: LipSyncFrame) => void;
  onFallbackNotice?: (reason: string) => void;
  onEnd?: () => void;
  onError?: (reason: string) => void;
}

/**
 * Modular adapter contract for local and external neural TTS services.
 */
export interface ITTSProvider {
  readonly id: TTSProviderType;
  readonly label: string;
  readonly isStudioGrade: boolean;
  isSupported(): boolean;
  speak(text: string, options: TTSSpeakOptions): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

/**
 * Modular adapter contract for TikTok LIVE gift stream integrations.
 */
export interface ITikTokGiftAdapter {
  readonly mode: EventSource;
  readonly isConfigured: boolean;
  getStatus(): TikTokConnectionState;
  connect(username: string): Promise<{ ok: boolean; error?: string }>;
  disconnect(): void | Promise<void>;
}
