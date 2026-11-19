export type PrayerCategoryId =
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

export type EventSource = 'simulation' | 'real';
export type QueueEventStatus = 'pending' | 'speaking' | 'completed' | 'failed' | 'cancelled';

export interface QueueEvent {
  id: string;
  dedupeKey: string;
  source: EventSource;
  username: string;
  displayUsername: string;
  giftId: string;
  giftName: string;
  quantity: number;
  priority: GiftPriority;
  category: PrayerCategoryId;
  prayerId: string;
  prayerTitle: string;
  renderedPrayer: string;
  scholarId: 'scholar_1' | 'scholar_2';
  status: QueueEventStatus;
  attempts: number;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
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
}

export type TikTokConnectionState =
  | 'unconfigured'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

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
}

export interface TikTokRelayGiftPayload {
  eventId: string;
  streakKey: string;
  username: string;
  nickname?: string;
  giftId: string;
  giftName: string;
  quantity: number;
  diamondCount?: number;
  giftType?: number;
  repeatCount?: number;
  repeatEnd?: boolean;
  timestamp: string;
}

export interface TikTokConnectorStatusPayload {
  state: TikTokConnectionState;
  username: string;
  roomId?: string | null;
  viewerCount?: number | null;
  error?: string | null;
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
}

export interface AppState {
  prayers: PrayerTemplate[];
  gifts: GiftRule[];
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

export interface TTSSpeakOptions {
  preferredEngine?: TTSProviderType;
  voiceURI?: string;
  neuralProviderId?: NeuralTTSProviderId;
  neuralVoiceId?: string;
  tone?: 'calm_elderly' | 'warm_classic';
  fallbackToBrowser?: boolean;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  onStart?: () => void;
  onMouthLevel?: (level: number) => void;
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
