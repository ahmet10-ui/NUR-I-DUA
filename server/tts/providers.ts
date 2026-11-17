import {
  IServerTTSProvider,
  NeuralTTSProviderId,
  NeuralVoicePreset,
  ProviderStatusInfo,
  ServerTTSSynthesizeRequest,
  ServerTTSSynthesizeResult,
} from './types';

export const TURKISH_MALE_VOICE_PRESETS: NeuralVoicePreset[] = [
  {
    id: 'tr-TR-AhmetNeural',
    provider: 'azure_neural',
    name: 'Ahmet Neural (Calm Elderly Scholar)',
    lang: 'tr-TR',
    gender: 'male',
    description: 'Deep, unhurried Turkish male neural voice tuned via SSML (-12% rate, -6% pitch).',
    recommendedFor: 'Primary elderly scholar prayer narration',
    defaultRate: 0.88,
    defaultPitchShift: '-6%',
  },
  {
    id: 'tr-TR-AhmetNeural-deep',
    provider: 'azure_neural',
    name: 'Ahmet Neural (Deep Companion Tone)',
    lang: 'tr-TR',
    gender: 'male',
    description: 'Lower-pitched Turkish male neural variant (-14% rate, -10% pitch) for the second scholar.',
    recommendedFor: 'Second scholar speaker contrast',
    defaultRate: 0.86,
    defaultPitchShift: '-10%',
  },
  {
    id: 'tr_TR-fahrettin-medium',
    provider: 'piper_local',
    name: 'Fahrettin (Piper Open-Source Male)',
    lang: 'tr-TR',
    gender: 'male',
    description: 'Free, offline self-hosted Turkish male neural model running via local Piper HTTP server.',
    recommendedFor: 'Zero-cost self-hosted VPS / Docker deployment',
    defaultRate: 0.88,
    defaultPitchShift: '0%',
  },
  {
    id: 'tr_TR-dfki-medium',
    provider: 'piper_local',
    name: 'DFKI Turkish Male (Piper Open-Source)',
    lang: 'tr-TR',
    gender: 'male',
    description: 'Alternative open-source Turkish male Piper voice model.',
    recommendedFor: 'Self-hosted secondary scholar voice',
    defaultRate: 0.88,
    defaultPitchShift: '0%',
  },
  {
    id: 'elevenlabs_custom_tr_male',
    provider: 'elevenlabs',
    name: 'ElevenLabs Custom Turkish Male Voice',
    lang: 'tr-TR',
    gender: 'male',
    description: 'Uses ELEVENLABS_VOICE_ID (set in server env) with eleven_multilingual_v2.',
    recommendedFor: 'Expressive multilingual neural narration',
    defaultRate: 0.9,
    defaultPitchShift: '0%',
  },
  {
    id: 'custom_http_tr_male',
    provider: 'custom_http',
    name: 'Custom TTS Proxy Voice',
    lang: 'tr-TR',
    gender: 'male',
    description: 'Forwards synthesis requests to CUSTOM_TTS_URL (e.g. Coqui XTTS-v2 or internal GPU server).',
    recommendedFor: 'Custom self-hosted or studio TTS microservice',
    defaultRate: 0.88,
    defaultPitchShift: '0%',
  },
];

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildAzureSSML(req: ServerTTSSynthesizeRequest): string {
  const isDeepVariant = req.voiceId === 'tr-TR-AhmetNeural-deep';
  const baseVoice = 'tr-TR-AhmetNeural';
  const rateVal = typeof req.rate === 'number' ? req.rate : 0.86;
  const ratePct = Math.round((rateVal - 1.0) * 100);
  const rateStr = `${ratePct >= 0 ? '+' : ''}${Math.max(-35, Math.min(20, ratePct))}%`;

  const pitchBase = isDeepVariant ? -10 : -6;
  const pitchOffset = typeof req.pitch === 'number' ? Math.round((req.pitch - 0.85) * 25) : 0;
  const totalPitch = Math.max(-20, Math.min(10, pitchBase + pitchOffset));
  const pitchStr = `${totalPitch >= 0 ? '+' : ''}${totalPitch}%`;

  // Insert respectful SSML pause before Âmin
  const textWithPauses = escapeXml(req.text).replace(
    /\s+(Âmin\.?|Amin\.?)$/i,
    ' <break time="420ms"/> $1'
  );

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="tr-TR">
  <voice name="${baseVoice}">
    <prosody rate="${rateStr}" pitch="${pitchStr}">
      ${textWithPauses}
    </prosody>
  </voice>
</speak>`;
}

class AzureNeuralTTSProvider implements IServerTTSProvider {
  readonly id: NeuralTTSProviderId = 'azure_neural';
  readonly label = 'Azure Cognitive Speech (tr-TR-AhmetNeural)';
  readonly requiresPaidApi = true;

  getMissingEnv(): string[] {
    const missing: string[] = [];
    if (!process.env.AZURE_SPEECH_KEY?.trim()) missing.push('AZURE_SPEECH_KEY');
    if (!process.env.AZURE_SPEECH_REGION?.trim()) missing.push('AZURE_SPEECH_REGION');
    return missing;
  }

  isConfigured(): boolean {
    return this.getMissingEnv().length === 0;
  }

  getNotes(): string {
    return 'Supports free F0 tier (up to 500k chars/month) on an Azure account; requires server-side AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.';
  }

  async synthesize(req: ServerTTSSynthesizeRequest): Promise<ServerTTSSynthesizeResult> {
    const missingEnv = this.getMissingEnv();
    if (missingEnv.length > 0) {
      return {
        ok: false,
        configured: false,
        provider: this.id,
        statusCode: 503,
        missingEnv,
        error: `Azure Neural TTS is not configured. Missing environment variable(s): ${missingEnv.join(', ')}.`,
      };
    }

    const region = process.env.AZURE_SPEECH_REGION!.trim();
    const key = process.env.AZURE_SPEECH_KEY!.trim();
    const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

    try {
      const ssml = buildAzureSSML(req);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
          'User-Agent': 'nur-i-dua-studio',
        },
        body: ssml,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return {
          ok: false,
          configured: true,
          provider: this.id,
          statusCode: response.status,
          error: `Azure TTS returned HTTP ${response.status}${errText ? `: ${errText.slice(0, 180)}` : ''}`,
        };
      }

      const arrBuf = await response.arrayBuffer();
      return {
        ok: true,
        configured: true,
        provider: this.id,
        statusCode: 200,
        contentType: 'audio/mpeg',
        audioBuffer: Buffer.from(arrBuf),
      };
    } catch (err) {
      return {
        ok: false,
        configured: true,
        provider: this.id,
        statusCode: 502,
        error: err instanceof Error ? err.message : 'Azure TTS request failed.',
      };
    }
  }
}

class PiperLocalTTSProvider implements IServerTTSProvider {
  readonly id: NeuralTTSProviderId = 'piper_local';
  readonly label = 'Self-Hosted Piper TTS (Open Source)';
  readonly requiresPaidApi = false;

  getMissingEnv(): string[] {
    return process.env.PIPER_TTS_URL?.trim() ? [] : ['PIPER_TTS_URL'];
  }

  isConfigured(): boolean {
    return this.getMissingEnv().length === 0;
  }

  getNotes(): string {
    return '100% free, offline neural TTS. Run Piper HTTP server with tr_TR-fahrettin-medium.onnx and set PIPER_TTS_URL (e.g. http://127.0.0.1:5000).';
  }

  async synthesize(req: ServerTTSSynthesizeRequest): Promise<ServerTTSSynthesizeResult> {
    const missingEnv = this.getMissingEnv();
    if (missingEnv.length > 0) {
      return {
        ok: false,
        configured: false,
        provider: this.id,
        statusCode: 503,
        missingEnv,
        error: 'Self-hosted Piper TTS URL is not configured (set PIPER_TTS_URL in server environment).',
      };
    }

    const baseUrl = process.env.PIPER_TTS_URL!.trim().replace(/\/+$/, '');
    try {
      const lengthScale = typeof req.rate === 'number' ? Number((1 / Math.max(0.5, req.rate)).toFixed(2)) : 1.15;
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: req.text,
          voice: req.voiceId || 'tr_TR-fahrettin-medium',
          length_scale: lengthScale,
        }),
      });

      if (!response.ok) {
        return {
          ok: false,
          configured: true,
          provider: this.id,
          statusCode: response.status,
          error: `Piper TTS server returned HTTP ${response.status}.`,
        };
      }

      const arrBuf = await response.arrayBuffer();
      return {
        ok: true,
        configured: true,
        provider: this.id,
        statusCode: 200,
        contentType: response.headers.get('content-type') || 'audio/wav',
        audioBuffer: Buffer.from(arrBuf),
      };
    } catch (err) {
      return {
        ok: false,
        configured: true,
        provider: this.id,
        statusCode: 502,
        error: err instanceof Error ? err.message : 'Unable to reach local Piper TTS server.',
      };
    }
  }
}

class ElevenLabsTTSProvider implements IServerTTSProvider {
  readonly id: NeuralTTSProviderId = 'elevenlabs';
  readonly label = 'ElevenLabs Multilingual v2';
  readonly requiresPaidApi = true;

  getMissingEnv(): string[] {
    const missing: string[] = [];
    if (!process.env.ELEVENLABS_API_KEY?.trim()) missing.push('ELEVENLABS_API_KEY');
    if (!process.env.ELEVENLABS_VOICE_ID?.trim()) missing.push('ELEVENLABS_VOICE_ID');
    return missing;
  }

  isConfigured(): boolean {
    return this.getMissingEnv().length === 0;
  }

  getNotes(): string {
    return 'Requires ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID (set to a calm, deep Turkish male voice ID) on the server.';
  }

  async synthesize(req: ServerTTSSynthesizeRequest): Promise<ServerTTSSynthesizeResult> {
    const missingEnv = this.getMissingEnv();
    if (missingEnv.length > 0) {
      return {
        ok: false,
        configured: false,
        provider: this.id,
        statusCode: 503,
        missingEnv,
        error: `ElevenLabs TTS is not configured. Missing environment variable(s): ${missingEnv.join(', ')}.`,
      };
    }

    const apiKey = process.env.ELEVENLABS_API_KEY!.trim();
    const voiceId = process.env.ELEVENLABS_VOICE_ID!.trim();

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: req.text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.72,
            similarity_boost: 0.78,
            style: 0.15,
            use_speaker_boost: true,
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return {
          ok: false,
          configured: true,
          provider: this.id,
          statusCode: response.status,
          error: `ElevenLabs API returned HTTP ${response.status}${errText ? `: ${errText.slice(0, 180)}` : ''}`,
        };
      }

      const arrBuf = await response.arrayBuffer();
      return {
        ok: true,
        configured: true,
        provider: this.id,
        statusCode: 200,
        contentType: 'audio/mpeg',
        audioBuffer: Buffer.from(arrBuf),
      };
    } catch (err) {
      return {
        ok: false,
        configured: true,
        provider: this.id,
        statusCode: 502,
        error: err instanceof Error ? err.message : 'ElevenLabs request failed.',
      };
    }
  }
}

class CustomHttpTTSProvider implements IServerTTSProvider {
  readonly id: NeuralTTSProviderId = 'custom_http';
  readonly label = 'Custom Self-Hosted HTTP TTS';
  readonly requiresPaidApi = false;

  getMissingEnv(): string[] {
    return process.env.CUSTOM_TTS_URL?.trim() ? [] : ['CUSTOM_TTS_URL'];
  }

  isConfigured(): boolean {
    return this.getMissingEnv().length === 0;
  }

  getNotes(): string {
    return 'Calls CUSTOM_TTS_URL (and optional Bearer CUSTOM_TTS_TOKEN) expecting JSON { text, voiceId, rate, pitch, lang: "tr-TR" } and returning audio/mpeg or audio/wav.';
  }

  async synthesize(req: ServerTTSSynthesizeRequest): Promise<ServerTTSSynthesizeResult> {
    const missingEnv = this.getMissingEnv();
    if (missingEnv.length > 0) {
      return {
        ok: false,
        configured: false,
        provider: this.id,
        statusCode: 503,
        missingEnv,
        error: 'Custom HTTP TTS endpoint is not configured (set CUSTOM_TTS_URL in server environment).',
      };
    }

    const url = process.env.CUSTOM_TTS_URL!.trim();
    const token = process.env.CUSTOM_TTS_TOKEN?.trim();

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text: req.text,
          voiceId: req.voiceId,
          rate: req.rate ?? 0.86,
          pitch: req.pitch ?? 0.84,
          lang: 'tr-TR',
          tone: req.tone || 'calm_elderly',
        }),
      });

      if (!response.ok) {
        return {
          ok: false,
          configured: true,
          provider: this.id,
          statusCode: response.status,
          error: `Custom TTS endpoint returned HTTP ${response.status}.`,
        };
      }

      const arrBuf = await response.arrayBuffer();
      return {
        ok: true,
        configured: true,
        provider: this.id,
        statusCode: 200,
        contentType: response.headers.get('content-type') || 'audio/mpeg',
        audioBuffer: Buffer.from(arrBuf),
      };
    } catch (err) {
      return {
        ok: false,
        configured: true,
        provider: this.id,
        statusCode: 502,
        error: err instanceof Error ? err.message : 'Custom TTS request failed.',
      };
    }
  }
}

const PROVIDERS: Record<NeuralTTSProviderId, IServerTTSProvider> = {
  azure_neural: new AzureNeuralTTSProvider(),
  piper_local: new PiperLocalTTSProvider(),
  elevenlabs: new ElevenLabsTTSProvider(),
  custom_http: new CustomHttpTTSProvider(),
};

export function getServerTTSProvider(id: NeuralTTSProviderId): IServerTTSProvider | null {
  return PROVIDERS[id] || null;
}

export function getServerTTSStatus(): {
  providers: ProviderStatusInfo[];
  voices: NeuralVoicePreset[];
  anyConfigured: boolean;
} {
  const providers: ProviderStatusInfo[] = Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    requiresPaidApi: p.requiresPaidApi,
    configured: p.isConfigured(),
    missingEnv: p.getMissingEnv(),
    notes: p.getNotes(),
  }));

  return {
    providers,
    voices: TURKISH_MALE_VOICE_PRESETS,
    anyConfigured: providers.some((p) => p.configured),
  };
}
