import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Volume2,
  Pause,
  Play,
  Square,
  RefreshCw,
  Info,
  Sparkles,
  Server,
  AlertTriangle,
  CheckCircle2,
  Smartphone,
} from 'lucide-react';
import { useStudio } from '../../context/StudioContext';
import {
  fetchServerTTSStatus,
  getScholarProsody,
  resolveTurkishSystemVoice,
  ServerTTSStatusResponse,
} from '../../services/ttsService';
import {
  AndroidTTSEngineStatus,
  getEngineInfo as getNativeAndroidEngineInfo,
} from '../../services/nativeAndroidTtsBridge';
import { NeuralTTSProviderId, ScholarId, TTSProviderType } from '../../types/nuridua';

interface RawVoiceDiagnosticItem {
  name: string;
  lang: string;
  localService: boolean;
  isDefault: boolean;
  voiceURI: string;
  matchesAntalia: boolean;
}

export const VoicePage: React.FC = () => {
  const {
    state,
    availableVoices,
    voiceLoadStatus,
    voiceLoadError,
    lastSpeechError,
    refreshVoices,
    isSpeechPaused,
    updateVoiceConfig,
    testVoicePlayback,
    testSystemTurkishSpeech,
    testServerNeuralPlayback,
    pauseSpeech,
    resumeSpeech,
    stopCurrentSpeech,
  } = useStudio();

  const { voice, scholars } = state;
  const [testScholar, setTestScholar] = useState<ScholarId>('scholar_1');
  const [sampleSentence, setSampleSentence] = useState(
    "Allah'ım, Ahmet kardeşimize sağlık, huzur, bereket ve hayırlı bir ömür nasip eyle. Onu ve sevdiklerini muhafaza eyle. Âmin."
  );

  const [serverStatus, setServerStatus] = useState<ServerTTSStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [neuralTestLoading, setNeuralTestLoading] = useState(false);
  const [neuralTestFeedback, setNeuralTestFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const loadServerStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const data = await fetchServerTTSStatus();
      setServerStatus(data);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Unable to reach /api/tts/status');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const [rawDiagnosticVoices, setRawDiagnosticVoices] = useState<RawVoiceDiagnosticItem[]>([]);
  const [diagSupported, setDiagSupported] = useState<boolean>(false);
  const [diagLastTrigger, setDiagLastTrigger] = useState<string>('Henüz kontrol edilmedi');
  const [diagLastCheckedAt, setDiagLastCheckedAt] = useState<string | null>(null);
  const [diagTwoSecondChecked, setDiagTwoSecondChecked] = useState<boolean>(false);
  const [diagVoicesChangedCount, setDiagVoicesChangedCount] = useState<number>(0);

  const [nativeStatus, setNativeStatus] = useState<AndroidTTSEngineStatus | null>(null);
  const [nativeLoading, setNativeLoading] = useState<boolean>(false);

  const loadNativeAndroidStatus = useCallback(async () => {
    setNativeLoading(true);
    try {
      const info = await getNativeAndroidEngineInfo();
      setNativeStatus(info);
    } finally {
      setNativeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNativeAndroidStatus();
  }, [loadNativeAndroidStatus]);

  const inspectBrowserVoices = useCallback(
    (triggerLabel: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setDiagSupported(false);
        setRawDiagnosticVoices([]);
        setDiagLastTrigger(triggerLabel);
        setDiagLastCheckedAt(new Date().toLocaleTimeString('tr-TR'));
        return;
      }
      setDiagSupported(true);
      try {
        const list = window.speechSynthesis.getVoices() || [];
        const mapped: RawVoiceDiagnosticItem[] = list.map((v) => ({
          name: v.name,
          lang: v.lang,
          localService: Boolean(v.localService),
          isDefault: Boolean(v.default),
          voiceURI: v.voiceURI,
          matchesAntalia: /antalia/i.test(v.name) || /antalia/i.test(v.voiceURI),
        }));
        setRawDiagnosticVoices(mapped);
      } catch {
        setRawDiagnosticVoices([]);
      }
      setDiagLastTrigger(triggerLabel);
      setDiagLastCheckedAt(new Date().toLocaleTimeString('tr-TR'));
    },
    []
  );

  useEffect(() => {
    void loadServerStatus();
  }, [loadServerStatus]);

  // Diagnostic-only voice list inspection: on page open, on `voiceschanged`, and 2 seconds later.
  useEffect(() => {
    inspectBrowserVoices('Sayfa Açılışı');
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setDiagTwoSecondChecked(true);
      return;
    }

    const synth = window.speechSynthesis;
    const onVoicesChanged = () => {
      setDiagVoicesChangedCount((c) => c + 1);
      inspectBrowserVoices('voiceschanged Olayı');
      refreshVoices();
    };

    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', onVoicesChanged);
    }

    const twoSecTimer = window.setTimeout(() => {
      setDiagTwoSecondChecked(true);
      inspectBrowserVoices('2 Saniye Sonraki Kontrol');
      refreshVoices();
    }, 2000);

    return () => {
      window.clearTimeout(twoSecTimer);
      if (typeof synth.removeEventListener === 'function') {
        synth.removeEventListener('voiceschanged', onVoicesChanged);
      }
    };
  }, [inspectBrowserVoices, refreshVoices]);

  const antaliaMatches = useMemo(
    () => rawDiagnosticVoices.filter((v) => v.matchesAntalia),
    [rawDiagnosticVoices]
  );

  const rawSpeechVoices = useMemo(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
    try {
      return window.speechSynthesis.getVoices() || [];
    } catch {
      return [];
    }
    // Re-evaluate whenever availableVoices updates via voiceschanged
  }, [availableVoices]);

  const scholar1Resolved = useMemo(
    () => resolveTurkishSystemVoice(rawSpeechVoices, voice.selectedVoiceURI, voice.language || 'tr-TR'),
    [rawSpeechVoices, voice.selectedVoiceURI, voice.language]
  );

  const scholar2EffectiveURI = voice.scholar2VoiceURI || voice.selectedVoiceURI;
  const scholar2Resolved = useMemo(
    () => resolveTurkishSystemVoice(rawSpeechVoices, scholar2EffectiveURI, voice.language || 'tr-TR'),
    [rawSpeechVoices, scholar2EffectiveURI, voice.language]
  );

  const scholar1Prosody = getScholarProsody(voice.rate, voice.pitch, 'scholar_1');
  const scholar2Prosody = getScholarProsody(voice.rate, voice.pitch, 'scholar_2');

  const turkishVoices = availableVoices.filter((v) => v.isTurkish);
  const otherVoices = availableVoices.filter((v) => !v.isTurkish);

  const formatVoiceLabel = (v: (typeof availableVoices)[number]) => {
    const tags: string[] = [v.lang];
    if (v.isDefault) tags.push('Varsayılan');
    tags.push(v.localService ? 'Yerel/Cihaz İçi' : 'Ağ');
    return `${v.name} (${tags.join(' · ')})`;
  };

  const formatLocalStatus = (localService: boolean | null) => {
    if (localService === true) return 'Yerel / Cihaz İçi';
    if (localService === false) return 'Uzak / Ağ Tabanlı';
    return 'İşletim Sistemi Varsayılan Motoru';
  };

  const applyScholarlyPreset = () => {
    updateVoiceConfig({
      provider: 'browser_speech_synthesis',
      language: 'tr-TR',
      narrationTone: 'calm_elderly',
      rate: 0.86,
      pitch: 0.84,
      volume: 0.95,
    });
  };

  const allNeuralVoices = serverStatus?.voices || [];
  const providerVoices = allNeuralVoices.filter((v) => v.provider === voice.neuralProviderId);
  const selectedProviderStatus = serverStatus?.providers.find(
    (p) => p.id === voice.neuralProviderId
  );

  const handleNeuralProviderChange = (nextProvider: NeuralTTSProviderId) => {
    const matchingVoices = allNeuralVoices.filter((v) => v.provider === nextProvider);
    updateVoiceConfig({
      neuralProviderId: nextProvider,
      neuralVoiceId: matchingVoices[0]?.id || voice.neuralVoiceId,
      neuralScholar2VoiceId:
        matchingVoices[1]?.id || matchingVoices[0]?.id || voice.neuralScholar2VoiceId,
    });
    setNeuralTestFeedback(null);
  };

  const handleRunServerNeuralTest = async () => {
    setNeuralTestLoading(true);
    setNeuralTestFeedback(null);
    try {
      const res = await testServerNeuralPlayback(sampleSentence, testScholar);
      setNeuralTestFeedback(res);
    } finally {
      setNeuralTestLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-[#1A2B54] pb-5">
        <div>
          <p className="text-xs text-[#D4B26A] font-medium tracking-[0.14em] uppercase">
            Ses &amp; Android Sistem TTS
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-white">
            Voice &amp; Turkish Speech Settings
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Ücretsiz cihaz/Android sistem metin-konuşma (Text-to-Speech) motorunu (<code className="font-mono text-slate-300">tr-TR</code>) kullanır. API anahtarı veya ücretli servis gerekmez.
          </p>
        </div>

        <button
          type="button"
          onClick={applyScholarlyPreset}
          className="inline-flex items-center gap-2 bg-[#13234B] hover:bg-[#1B3166] border border-[#C9A45C]/50 text-[#F4E3BD] text-xs font-medium px-3.5 py-2.5 shrink-0 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#E5C88B]" />
          <span>Calm Scholar Preset (0.86× / 0.84)</span>
        </button>
      </div>

      {/* Android System TTS Notice */}
      <div className="bg-[#0E1834] border border-[#C9A45C]/35 p-4 flex items-start gap-3 text-xs text-slate-300 leading-relaxed">
        <Smartphone className="w-4 h-4 text-[#E5C88B] shrink-0 mt-0.5" />
        <div className="space-y-1.5">
          <p className="font-semibold text-white">
            Android / Cihaz Sistem TTS Motoru (Ücretsiz &amp; Yerel)
          </p>
          <p className="text-slate-300">
            Özel bir ses seçilmediğinde uygulama sabit bir sağlayıcı (Google vb.) zorlamaz; doğrudan cihazınızın Android Metin-Konuşma ayarlarında seçili varsayılan Türkçe motorunu (ör. <strong className="text-[#E5C88B]">Antalia-2 Mini</strong> veya sistem varsayılanı) <code className="font-mono text-slate-100">tr-TR</code> diliyle kullanır.
          </p>
          <p className="text-slate-400">
            Not: Web Speech API (<code className="font-mono text-slate-200">SpeechSynthesis</code>) ham ses dalgası (PCM) verisi sağlamaz; ağız animasyonu gerçek ses dalga analizi değil, konuşma sınırı ve tahmini hece ritmi senkronizasyonudur. Android Chrome/WebView kuralları gereği konuşma yalnızca kullanıcı etkileşiminden sonra başlatılır.
          </p>
        </div>
      </div>

      {/* Explicit Voice Load Error / Speech Playback Error */}
      {(voiceLoadError || lastSpeechError) && (
        <div className="bg-rose-950/35 border border-rose-500/45 p-4 flex items-start gap-3 text-xs text-rose-200 leading-relaxed">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            {voiceLoadError && (
              <p>
                <strong className="text-white">Ses Listesi Hatası:</strong> {voiceLoadError}
              </p>
            )}
            {lastSpeechError && (
              <p>
                <strong className="text-white">Son Konuşma Hatası:</strong> {lastSpeechError}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: System TTS Settings & Prosody */}
        <div className="space-y-6">
          <div className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">
                Sistem TTS Motoru ve Ses Seçimi
              </h2>
              <button
                type="button"
                onClick={refreshVoices}
                className="inline-flex items-center gap-1.5 text-xs text-[#E5C88B] hover:underline cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Sesleri Yenile</span>
              </button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label htmlFor="tts-provider" className="block text-xs text-slate-300 mb-1.5">
                  Aktif Konuşma Motoru
                </label>
                <select
                  id="tts-provider"
                  value={voice.provider}
                  onChange={(e) =>
                    updateVoiceConfig({
                      provider: e.target.value as TTSProviderType,
                    })
                  }
                  className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
                >
                  <option value="browser_speech_synthesis">
                    Cihaz / Android Sistem TTS Motoru (Ücretsiz · Önerilen)
                  </option>
                  <option value="external_studio_adapter">
                    İsteğe Bağlı Sunucu Neural TTS Adaptörü (Harici Kurulum)
                  </option>
                </select>
              </div>

              <div>
                <label htmlFor="tts-lang" className="block text-xs text-slate-300 mb-1.5">
                  Konuşma Dili
                </label>
                <select
                  id="tts-lang"
                  value={voice.language}
                  onChange={(e) => updateVoiceConfig({ language: e.target.value })}
                  className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
                >
                  <option value="tr-TR">Türkçe (tr-TR)</option>
                  <option value="en-US">English (en-US)</option>
                </select>
              </div>

              <div>
                <label htmlFor="voice-scholar-1" className="block text-xs text-slate-300 mb-1.5">
                  1. Hoca Sesi ({scholars.profiles.scholar_1.name})
                </label>
                <select
                  id="voice-scholar-1"
                  value={voice.selectedVoiceURI}
                  onChange={(e) => updateVoiceConfig({ selectedVoiceURI: e.target.value })}
                  className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
                >
                  <option value="">
                    Android / Cihaz Varsayılan Türkçe Sesi (Otomatik — Sabit Sağlayıcı Zorlanmaz)
                  </option>
                  {turkishVoices.length > 0 && (
                    <optgroup label="Türkçe Sistem Sesleri (tr-TR)">
                      {turkishVoices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {formatVoiceLabel(v)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {otherVoices.length > 0 && (
                    <optgroup label="Diğer Cihaz Sesleri">
                      {otherVoices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {formatVoiceLabel(v)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div>
                <label htmlFor="voice-scholar-2" className="block text-xs text-slate-300 mb-1.5">
                  2. Hoca Sesi ({scholars.profiles.scholar_2.name})
                </label>
                <select
                  id="voice-scholar-2"
                  value={voice.scholar2VoiceURI}
                  onChange={(e) => updateVoiceConfig({ scholar2VoiceURI: e.target.value })}
                  className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
                >
                  <option value="">
                    1. Hoca ile Aynı Ses (Perde -0.05 / Hız +0.03 ile Hafifçe Farklılaşır)
                  </option>
                  {turkishVoices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {formatVoiceLabel(v)}
                    </option>
                  ))}
                  {otherVoices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {formatVoiceLabel(v)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Rate / Pitch / Volume Sliders */}
              <div className="space-y-3.5 pt-2 border-t border-[#16254A]">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label htmlFor="voice-rate" className="text-slate-300">
                      Konuşma Hızı (Önerilen: 0.82× – 0.90×)
                    </label>
                    <span className="font-mono-tabular text-[#E5C88B]">
                      {voice.rate.toFixed(2)}×
                    </span>
                  </div>
                  <input
                    id="voice-rate"
                    type="range"
                    min={0.6}
                    max={1.3}
                    step={0.02}
                    value={voice.rate}
                    onChange={(e) => updateVoiceConfig({ rate: Number(e.target.value) })}
                    className="w-full accent-[#C9A45C]"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label htmlFor="voice-pitch" className="text-slate-300">
                      Ses Perdesi / Ton Kalınlığı (Pitch)
                    </label>
                    <span className="font-mono-tabular text-[#E5C88B]">
                      {voice.pitch.toFixed(2)}
                    </span>
                  </div>
                  <input
                    id="voice-pitch"
                    type="range"
                    min={0.65}
                    max={1.25}
                    step={0.02}
                    value={voice.pitch}
                    onChange={(e) => updateVoiceConfig({ pitch: Number(e.target.value) })}
                    className="w-full accent-[#C9A45C]"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label htmlFor="voice-volume" className="text-slate-300">
                      Ses Seviyesi (Volume)
                    </label>
                    <span className="font-mono-tabular text-[#E5C88B]">
                      {Math.round(voice.volume * 100)}%
                    </span>
                  </div>
                  <input
                    id="voice-volume"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={voice.volume}
                    onChange={(e) => updateVoiceConfig({ volume: Number(e.target.value) })}
                    className="w-full accent-[#C9A45C]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Diagnostics Card */}
          <div className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-[#E5C88B]" />
                <h2 className="text-base font-semibold text-white">Sistem TTS Teşhis Alanı</h2>
              </div>
              <span className="font-mono text-[11px] uppercase tracking-wider text-slate-300">
                {voiceLoadStatus === 'ready'
                  ? `${availableVoices.length} Ses (${turkishVoices.length} TR)`
                  : voiceLoadStatus === 'loading'
                    ? 'Sesler Yükleniyor...'
                    : voiceLoadStatus === 'unsupported'
                      ? 'Desteklenmiyor'
                      : 'Ses Listesi Boş'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-[#070E1F] border border-[#1B2D58] p-3 space-y-1.5">
                <p className="font-semibold text-[#E5C88B]">
                  1. Hoca ({scholars.profiles.scholar_1.name})
                </p>
                <p className="text-slate-300">
                  <span className="text-slate-400">Ses Adı:</span>{' '}
                  <span className="text-white font-medium">{scholar1Resolved.name}</span>
                </p>
                <p className="text-slate-300">
                  <span className="text-slate-400">Dil:</span>{' '}
                  <code className="font-mono text-slate-100">{scholar1Resolved.lang}</code>
                </p>
                <p className="text-slate-300">
                  <span className="text-slate-400">Konum:</span>{' '}
                  {formatLocalStatus(scholar1Resolved.localService)}
                </p>
                <p className="text-slate-300">
                  <span className="text-slate-400">Hız / Perde:</span>{' '}
                  <span className="font-mono-tabular text-white">
                    {scholar1Prosody.rate.toFixed(2)}× / {scholar1Prosody.pitch.toFixed(2)}
                  </span>
                </p>
              </div>

              <div className="bg-[#070E1F] border border-[#1B2D58] p-3 space-y-1.5">
                <p className="font-semibold text-[#E5C88B]">
                  2. Hoca ({scholars.profiles.scholar_2.name})
                </p>
                <p className="text-slate-300">
                  <span className="text-slate-400">Ses Adı:</span>{' '}
                  <span className="text-white font-medium">{scholar2Resolved.name}</span>
                </p>
                <p className="text-slate-300">
                  <span className="text-slate-400">Dil:</span>{' '}
                  <code className="font-mono text-slate-100">{scholar2Resolved.lang}</code>
                </p>
                <p className="text-slate-300">
                  <span className="text-slate-400">Konum:</span>{' '}
                  {formatLocalStatus(scholar2Resolved.localService)}
                </p>
                <p className="text-slate-300">
                  <span className="text-slate-400">Hız / Perde:</span>{' '}
                  <span className="font-mono-tabular text-white">
                    {scholar2Prosody.rate.toFixed(2)}× / {scholar2Prosody.pitch.toFixed(2)}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Playback Testing & Optional Server Adapter */}
        <div className="space-y-6">
          <div className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-4">
            <h2 className="text-base font-semibold text-white">Türkçe Konuşma Testi</h2>

            <div>
              <label htmlFor="test-scholar-select" className="block text-xs text-slate-300 mb-1.5">
                Konuşacak Hoca
              </label>
              <select
                id="test-scholar-select"
                value={testScholar}
                onChange={(e) => setTestScholar(e.target.value as ScholarId)}
                className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
              >
                <option value="scholar_1">{scholars.profiles.scholar_1.name}</option>
                <option value="scholar_2">{scholars.profiles.scholar_2.name}</option>
              </select>
            </div>

            {/* Required System Turkish Voice Test Button */}
            <div className="bg-[#070E1F] border border-[#C9A45C]/35 p-3.5 space-y-2.5">
              <p className="text-xs text-slate-300">
                <strong className="text-white">Sistem TTS Hızlı Test:</strong> &ldquo;Esselâmü aleyküm. Allah dualarımızı kabul eylesin.&rdquo;
              </p>
              <button
                type="button"
                onClick={() => testSystemTurkishSpeech(testScholar)}
                className="inline-flex items-center gap-2 bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] font-semibold text-xs px-4 py-2.5 cursor-pointer"
              >
                <Volume2 className="w-4 h-4" />
                <span>Sistem Türkçe Sesini Test Et</span>
              </button>
            </div>

            <div>
              <label htmlFor="test-tts-text" className="block text-xs text-slate-300 mb-1.5">
                Özel Dua Metni Testi
              </label>
              <textarea
                id="test-tts-text"
                rows={3}
                value={sampleSentence}
                onChange={(e) => setSampleSentence(e.target.value)}
                className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => testVoicePlayback(sampleSentence, testScholar)}
                className="inline-flex items-center gap-2 bg-[#13234B] hover:bg-[#1B3166] border border-[#C9A45C]/50 text-[#F4E3BD] font-medium text-xs px-4 py-2.5 cursor-pointer"
              >
                <Volume2 className="w-4 h-4 text-[#E5C88B]" />
                <span>Özel Metni Seslendir</span>
              </button>

              <button
                type="button"
                onClick={isSpeechPaused ? resumeSpeech : pauseSpeech}
                className="inline-flex items-center gap-2 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-white text-xs px-3.5 py-2.5 cursor-pointer"
              >
                {isSpeechPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                <span>{isSpeechPaused ? 'Devam Et' : 'Duraklat'}</span>
              </button>

              <button
                type="button"
                onClick={stopCurrentSpeech}
                className="inline-flex items-center gap-2 bg-[#2B1822] hover:bg-[#3B202E] border border-rose-500/40 text-rose-200 text-xs px-3.5 py-2.5 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Durdur</span>
              </button>
            </div>
          </div>

          {/* Optional Server Neural Adapter (Non-mandatory) */}
          <details className="bg-[#0B142B] border border-[#1B2D58] p-5">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-sm font-semibold text-white">
              <span className="inline-flex items-center gap-2">
                <Server className="w-4 h-4 text-[#E5C88B]" />
                <span>İsteğe Bağlı Sunucu TTS Adaptörü (Zorunlu Değil)</span>
              </span>
              <span className="text-xs font-mono text-slate-400">
                {serverStatus?.anyConfigured ? 'Configured' : 'Opsiyonel'}
              </span>
            </summary>

            <div className="mt-4 pt-4 border-t border-[#16254A] space-y-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                Uygulamanın normal çalışması için sunucu TTS veya ücretli API gerekmez. İleride harici veya kendi barındırdığınız sunucu TTS servisini bağlamak isterseniz aşağıdaki opsiyonel adaptörü kullanabilirsiniz.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="neural-provider-id" className="block text-xs text-slate-300 mb-1.5">
                    Sunucu Sağlayıcı
                  </label>
                  <select
                    id="neural-provider-id"
                    value={voice.neuralProviderId}
                    onChange={(e) =>
                      handleNeuralProviderChange(e.target.value as NeuralTTSProviderId)
                    }
                    className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-sm text-white"
                  >
                    <option value="piper_local">Self-Hosted Piper TTS (Ücretsiz Açık Kaynak)</option>
                    <option value="azure_neural">Azure Speech (tr-TR-AhmetNeural)</option>
                    <option value="elevenlabs">ElevenLabs Multilingual v2</option>
                    <option value="custom_http">Custom HTTP TTS Server</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="narration-tone" className="block text-xs text-slate-300 mb-1.5">
                    Anlatım Tonu
                  </label>
                  <select
                    id="narration-tone"
                    value={voice.narrationTone}
                    onChange={(e) =>
                      updateVoiceConfig({
                        narrationTone: e.target.value as 'calm_elderly' | 'warm_classic',
                      })
                    }
                    className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-sm text-white"
                  >
                    <option value="calm_elderly">Sakin Kıdemli Hoca</option>
                    <option value="warm_classic">Sıcak Klasik Okuma</option>
                  </select>
                </div>
              </div>

              {selectedProviderStatus && (
                <div
                  className={`p-3 border text-xs ${
                    selectedProviderStatus.configured
                      ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                      : 'bg-[#070E1F] border-[#1B2D58] text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {selectedProviderStatus.configured ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Info className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      {selectedProviderStatus.label}
                    </span>
                    <span className="font-mono text-[11px] uppercase">
                      {selectedProviderStatus.configured ? 'Configured' : 'Not Configured'}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-400">{selectedProviderStatus.notes}</p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleRunServerNeuralTest}
                  disabled={neuralTestLoading}
                  className="inline-flex items-center gap-2 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-white text-xs px-3.5 py-2 cursor-pointer disabled:opacity-60"
                >
                  <Server className="w-3.5 h-3.5 text-[#E5C88B]" />
                  <span>{neuralTestLoading ? 'Sentezleniyor...' : 'Sunucu Adaptörünü Test Et'}</span>
                </button>

                <button
                  type="button"
                  onClick={loadServerStatus}
                  disabled={statusLoading}
                  className="inline-flex items-center gap-1.5 text-xs text-[#E5C88B] hover:underline cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${statusLoading ? 'animate-spin' : ''}`} />
                  <span>Durumu Yenile</span>
                </button>
              </div>

              {statusError && (
                <div className="p-2.5 border border-rose-500/40 bg-rose-950/30 text-xs text-rose-200">
                  {statusError}
                </div>
              )}

              {neuralTestFeedback && (
                <div
                  className={`p-2.5 border text-xs ${
                    neuralTestFeedback.ok
                      ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                      : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                  }`}
                >
                  {neuralTestFeedback.message}
                </div>
              )}

              <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={voice.fallbackToBrowser}
                  onChange={(e) => updateVoiceConfig({ fallbackToBrowser: e.target.checked })}
                  className="mt-0.5 accent-[#C9A45C]"
                />
                <span>
                  Sunucu adaptörü yapılandırılmamışsa otomatik olarak ücretsiz cihaz/Android sistem TTS motoruna dön.
                </span>
              </label>
            </div>
          </details>
        </div>
      </div>

      {/* Android Native TextToSpeech (Capacitor) Diagnostic Panel */}
      <div className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#16254A] pb-3.5">
          <div>
            <h2 className="text-base font-semibold text-white">
              Android Yerel TTS Teşhisi (<code className="font-mono text-[#E5C88B]">android.speech.tts.TextToSpeech</code>)
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Capacitor köprüsü üzerinden cihazın yerel Android TTS motoru, Türkçe desteği ve Antalia-2 Mini durumu.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadNativeAndroidStatus()}
            disabled={nativeLoading}
            className="inline-flex items-center gap-1.5 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-[#E5C88B] text-xs font-medium px-3.5 py-2 shrink-0 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${nativeLoading ? 'animate-spin' : ''}`} />
            <span>Android TTS Durumunu Yenile</span>
          </button>
        </div>

        {/* Core Platform & Engine Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="bg-[#070E1F] border border-[#1B2D58] p-3">
            <p className="text-slate-400">Platform</p>
            <p className="mt-1 font-mono font-semibold text-white uppercase">
              {nativeStatus?.platform || 'web'}
            </p>
          </div>
          <div className="bg-[#070E1F] border border-[#1B2D58] p-3">
            <p className="text-slate-400">Native Android Ortamı</p>
            <p
              className={`mt-1 font-semibold ${
                nativeStatus?.isNativeAndroid ? 'text-emerald-300' : 'text-amber-300'
              }`}
            >
              {nativeStatus?.isNativeAndroid
                ? nativeStatus.pluginAvailable
                  ? 'Aktif (Eklenti Bağlı)'
                  : 'Android (Eklenti Kayıtlı Değil)'
                : 'Aktif Değil (Chrome Preview / Web)'}
            </p>
          </div>
          <div className="bg-[#070E1F] border border-[#1B2D58] p-3">
            <p className="text-slate-400">Türkçe (tr-TR) Desteği</p>
            <p className="mt-1 font-mono font-medium text-white">
              {nativeStatus?.isNativeAndroid
                ? `${nativeStatus.turkishSupport}${
                    nativeStatus.turkishSupportCode !== null
                      ? ` (${nativeStatus.turkishSupportCode})`
                      : ''
                  }`
                : 'Kullanılamıyor (Web)'}
            </p>
          </div>
          <div className="bg-[#070E1F] border border-[#1B2D58] p-3">
            <p className="text-slate-400">Antalia-2 Mini Eşleşmesi</p>
            <p
              className={`mt-1 font-semibold ${
                nativeStatus?.isNativeAndroid &&
                (nativeStatus.antaliaEngineMatched || nativeStatus.antaliaVoiceMatched)
                  ? 'text-[#E5C88B]'
                  : 'text-slate-300'
              }`}
            >
              {!nativeStatus?.isNativeAndroid
                ? 'Doğrulanamaz (Android Değil)'
                : nativeStatus.antaliaEngineMatched || nativeStatus.antaliaVoiceMatched
                  ? 'Eşleşme Bulundu'
                  : 'Eşleşme Yok'}
            </p>
          </div>
        </div>

        {/* Honest Chrome Preview vs Native Android Status Banner */}
        {!nativeStatus?.isNativeAndroid ? (
          <div className="bg-[#070E1F] border border-amber-500/40 p-3.5 flex items-start gap-3 text-xs text-slate-300 leading-relaxed">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-amber-200">
                Android Native Bağlantısı Kullanılamıyor (Chrome Preview / Web Ortamı)
              </p>
              <p>
                Şu anda uygulama yerel Capacitor Android APK kabuğu içinde değil, tarayıcı/Web ortamında çalışıyor. Bu nedenle{' '}
                <code className="font-mono text-white">android.speech.tts.TextToSpeech</code> motoruna ve Antalia-2 Mini&apos;ye erişilemez; seslendirme otomatik olarak mevcut tarayıcı <code className="font-mono text-white">SpeechSynthesis</code> sistemine yönlendirilir.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            {/* Default Engine & Last Error */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-[#070E1F] border border-[#1B2D58] p-3 space-y-1">
                <p className="text-slate-400">Varsayılan Android TTS Motoru</p>
                <p className="text-white font-semibold">
                  {nativeStatus.defaultEngineLabel || 'Etiket Bildirilmedi'}
                </p>
                <p className="font-mono text-slate-300">
                  {nativeStatus.defaultEngine || '—'}
                </p>
              </div>
              <div className="bg-[#070E1F] border border-[#1B2D58] p-3 space-y-1">
                <p className="text-slate-400">Bağlantı ve Son Hata Durumu</p>
                <p
                  className={
                    nativeStatus.lastError ? 'text-rose-300 font-medium' : 'text-emerald-300 font-medium'
                  }
                >
                  {nativeStatus.lastError ||
                    (nativeStatus.initialized
                      ? 'TextToSpeech bağlantısı hazır.'
                      : 'Başlatma bekleniyor...')}
                </p>
              </div>
            </div>

            {/* Installed Android Engines */}
            <div className="bg-[#070E1F] border border-[#1B2D58] p-3 space-y-2">
              <p className="font-semibold text-white">
                Cihazdaki TTS Motorları ({nativeStatus.engines.length})
              </p>
              {nativeStatus.engines.length === 0 ? (
                <p className="text-slate-400">Motor listesi döndürülmedi.</p>
              ) : (
                <div className="space-y-1.5">
                  {nativeStatus.engines.map((eng, idx) => (
                    <div
                      key={`${eng.name}-${idx}`}
                      className={`flex flex-wrap items-center justify-between gap-2 p-2 border ${
                        eng.isDefault
                          ? 'border-[#C9A45C]/60 bg-[#C9A45C]/10 text-white'
                          : 'border-[#16254A] bg-[#081024] text-slate-300'
                      }`}
                    >
                      <div>
                        <span className="font-medium">{eng.label || eng.name}</span>{' '}
                        <code className="font-mono text-[11px] text-slate-400">({eng.name})</code>
                      </div>
                      {eng.isDefault && (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-[#E5C88B]">
                          Varsayılan Motor
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Native Android Voices */}
            <div className="bg-[#070E1F] border border-[#1B2D58] p-3 space-y-2">
              <p className="font-semibold text-white">
                Kullanılabilir Yerel Android Sesleri ({nativeStatus.voices.length})
              </p>
              {nativeStatus.voices.length === 0 ? (
                <p className="text-slate-400">
                  Motor `getVoices()` çağrısı boş liste döndürdü (bazı özel Android motorları yalnızca varsayılan konuşma üzerinden hizmet verir).
                </p>
              ) : (
                <div className="overflow-x-auto border border-[#16254A]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#081024] border-b border-[#16254A] text-slate-400 uppercase text-[11px]">
                        <th className="py-2 px-2.5">Ses Adı</th>
                        <th className="py-2 px-2.5">Locale</th>
                        <th className="py-2 px-2.5">Ağ Gereksinimi</th>
                        <th className="py-2 px-2.5">Kalite</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#142347]">
                      {nativeStatus.voices.map((nv, idx) => (
                        <tr
                          key={`${nv.name}-${idx}`}
                          className={nv.matchesAntalia ? 'bg-[#C9A45C]/15 text-white' : 'text-slate-200'}
                        >
                          <td className="py-2 px-2.5 font-medium">
                            {nv.name}{' '}
                            {nv.matchesAntalia && (
                              <span className="ml-1.5 bg-[#C9A45C] text-[#070D1B] text-[10px] font-semibold px-1.5 py-0.5 uppercase">
                                Antalia
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2.5 font-mono">{nv.locale || '—'}</td>
                          <td className="py-2 px-2.5 font-mono">
                            {nv.isNetworkConnectionRequired ? 'Ağ Gerekli' : 'Yerel / Çevrimdışı'}
                          </td>
                          <td className="py-2 px-2.5 font-mono-tabular">{nv.quality}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Detailed Browser speechSynthesis.getVoices() Diagnostic Inspector */}
      <div className="bg-[#0B142B] border border-[#1B2D58] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#16254A] pb-3.5">
          <div>
            <h2 className="text-base font-semibold text-white">
              Tarayıcı <code className="font-mono text-[#E5C88B]">speechSynthesis.getVoices()</code> Detaylı Teşhisi
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Tarayıcının gerçekten erişebildiği tüm sesler değişiklik yapılmadan, ham adlarıyla listelenir.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              inspectBrowserVoices('Manuel Kontrol');
              refreshVoices();
            }}
            className="inline-flex items-center gap-1.5 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-[#E5C88B] text-xs font-medium px-3.5 py-2 shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Listeyi Şimdi Tekrar Kontrol Et</span>
          </button>
        </div>

        {/* Diagnostic Status Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="bg-[#070E1F] border border-[#1B2D58] p-3">
            <p className="text-slate-400">Erişilen Ses Sayısı</p>
            <p className="mt-1 font-mono-tabular text-lg font-semibold text-white">
              {diagSupported ? rawDiagnosticVoices.length : 'Desteklenmiyor'}
            </p>
          </div>
          <div className="bg-[#070E1F] border border-[#1B2D58] p-3">
            <p className="text-slate-400">2. Saniye Kontrolü</p>
            <p className="mt-1 font-medium text-white">
              {diagTwoSecondChecked ? 'Tamamlandı (2000ms)' : 'Bekleniyor...'}
            </p>
          </div>
          <div className="bg-[#070E1F] border border-[#1B2D58] p-3">
            <p className="text-slate-400">voiceschanged Olayı</p>
            <p className="mt-1 font-mono-tabular font-medium text-white">
              {diagVoicesChangedCount > 0 ? `Tetiklendi (${diagVoicesChangedCount}×)` : 'Henüz tetiklenmedi'}
            </p>
          </div>
          <div className="bg-[#070E1F] border border-[#1B2D58] p-3">
            <p className="text-slate-400">Son Kontrol</p>
            <p className="mt-1 font-medium text-slate-200">
              {diagLastTrigger}
              {diagLastCheckedAt ? ` · ${diagLastCheckedAt}` : ''}
            </p>
          </div>
        </div>

        {/* Explicit Antalia / Antalia-2 Mini Search Result */}
        {antaliaMatches.length > 0 ? (
          <div className="bg-emerald-950/35 border border-[#C9A45C] p-3.5 flex items-start gap-3 text-xs">
            <CheckCircle2 className="w-4 h-4 text-[#E5C88B] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-[#F4E3BD]">
                Antalia / Antalia-2 Mini Eşleşmesi Bulundu ({antaliaMatches.length} ses)
              </p>
              <p className="text-slate-200">
                Tarayıcı listesinde bulunan eşleşme(ler):{' '}
                <strong className="text-white">
                  {antaliaMatches.map((m) => `${m.name} [${m.lang}]`).join(', ')}
                </strong>
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-amber-950/30 border border-amber-500/45 p-3.5 flex items-start gap-3 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-amber-200">
                Antalia / Antalia-2 Mini bu tarayıcının speechSynthesis.getVoices() listesinde bulunamadı.
              </p>
              <p className="text-slate-300 leading-relaxed">
                Listede adı <code className="font-mono text-white">Antalia</code> veya{' '}
                <code className="font-mono text-white">Antalia-2 Mini</code> ile eşleşen hiçbir ses kaydı yok. Yukarıdaki/aşağıdaki ham listedeki hiçbir ses otomatik olarak Antalia diye adlandırılmamıştır.
              </p>
            </div>
          </div>
        )}

        {/* Full Raw Voice List */}
        {!diagSupported ? (
          <div className="bg-[#070E1F] border border-rose-500/40 p-4 text-xs text-rose-200">
            Bu tarayıcıda <code className="font-mono">window.speechSynthesis</code> API&apos;si mevcut değil.
          </div>
        ) : rawDiagnosticVoices.length === 0 ? (
          <div className="bg-[#070E1F] border border-[#1B2D58] p-4 text-xs text-slate-300">
            <code className="font-mono text-white">window.speechSynthesis.getVoices()</code> şu anda boş dizi (
            <code className="font-mono">[]</code>) döndürüyor; tarayıcı erişilebilir ses listesi bildirmedi.
          </div>
        ) : (
          <div className="overflow-x-auto border border-[#1B2D58]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#070E1F] border-b border-[#1B2D58] text-slate-400 uppercase tracking-wider text-[11px]">
                  <th className="py-2.5 px-3 font-medium">#</th>
                  <th className="py-2.5 px-3 font-medium">Sesin Tam Adı (name)</th>
                  <th className="py-2.5 px-3 font-medium">Dil Kodu (lang)</th>
                  <th className="py-2.5 px-3 font-medium">localService</th>
                  <th className="py-2.5 px-3 font-medium">default</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#142347]">
                {rawDiagnosticVoices.map((v, idx) => (
                  <tr
                    key={`${v.voiceURI || v.name}-${idx}`}
                    className={
                      v.matchesAntalia
                        ? 'bg-[#C9A45C]/15 text-white'
                        : 'bg-[#081024] hover:bg-[#0D1836] text-slate-200'
                    }
                  >
                    <td className="py-2.5 px-3 font-mono-tabular text-slate-400">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={v.matchesAntalia ? 'font-semibold text-[#F4E3BD]' : 'font-medium text-white'}>
                          {v.name}
                        </span>
                        {v.matchesAntalia && (
                          <span className="bg-[#C9A45C] text-[#070D1B] font-semibold text-[10px] px-1.5 py-0.5 uppercase tracking-wide">
                            Antalia Eşleşmesi
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-200">{v.lang || '—'}</td>
                    <td className="py-2.5 px-3 font-mono">
                      <span className={v.localService ? 'text-emerald-300' : 'text-slate-400'}>
                        {String(v.localService)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      <span className={v.isDefault ? 'text-[#E5C88B] font-semibold' : 'text-slate-400'}>
                        {String(v.isDefault)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
