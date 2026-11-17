export type NeuralTTSProviderId =
  | 'azure_neural'
  | 'piper_local'
  | 'elevenlabs'
  | 'custom_http';

export type NarrationTone = 'calm_elderly' | 'warm_classic';

export interface NeuralVoicePreset {
  id: string;
  provider: NeuralTTSProviderId;
  name: string;
  lang: 'tr-TR';
  gender: 'male';
  description: string;
  recommendedFor: string;
  defaultRate: number;
  defaultPitchShift: string;
}

export interface ProviderStatusInfo {
  id: NeuralTTSProviderId;
  label: string;
  requiresPaidApi: boolean;
  configured: boolean;
  missingEnv: string[];
  notes: string;
}

export interface ServerTTSSynthesizeRequest {
  text: string;
  provider: NeuralTTSProviderId;
  voiceId?: string;
  rate?: number;
  pitch?: number;
  tone?: NarrationTone;
}

export interface ServerTTSSynthesizeResult {
  ok: boolean;
  configured: boolean;
  provider: NeuralTTSProviderId;
  contentType?: string;
  audioBuffer?: Buffer;
  statusCode: number;
  error?: string;
  missingEnv?: string[];
}

export interface IServerTTSProvider {
  readonly id: NeuralTTSProviderId;
  readonly label: string;
  readonly requiresPaidApi: boolean;
  isConfigured(): boolean;
  getMissingEnv(): string[];
  getNotes(): string;
  synthesize(req: ServerTTSSynthesizeRequest): Promise<ServerTTSSynthesizeResult>;
}
