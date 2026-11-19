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
  resolveScholarVoiceURI,
  resolveTurkishSystemVoice,
  ServerTTSStatusResponse,
} from '../../services/ttsService';
import {
  AndroidTTSEngineStatus,
  getEngineInfo as getNativeAndroidEngineInfo,
} from '../../services/nativeAndroidTtsBridge';
import {
  cancelSeslenDownload,
  downloadSeslenModel,
  getSeslenStatus,
  playOfficialHasanSample,
  replayLastSeslenWav,
  SeslenContractVerificationResult,
  SeslenDownloadProgressEvent,
  SeslenIntegrityResult,
  SeslenPcmStats,
  SeslenSpeakTestResult,
  SeslenStatusResult,
  speakSeslenTest,
  stopSeslenTest,
  subscribeSeslenEvents,
  verifySeslenContract,
  verifySeslenModelIntegrity,
} from '../../services/nativeSeslenTtsBridge';
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

  // Isolated Seslen-TTS Hasan (Hacı Ahmet Efendi ONLY) state — Stage 1-4 verification/test
  const [seslenStatus, setSeslenStatus] = useState<SeslenStatusResult | null>(null);
  const [seslenProgress, setSeslenProgress] = useState<SeslenDownloadProgressEvent | null>(null);
  const [seslenError, setSeslenError] = useState<string | null>(null);
  const [seslenIntegrity, setSeslenIntegrity] = useState<SeslenIntegrityResult | null>(null);
  const [seslenIntegrityLoading, setSeslenIntegrityLoading] = useState(false);
  const [seslenContract, setSeslenContract] = useState<SeslenContractVerificationResult | null>(null);
  const [seslenContractLoading, setSeslenContractLoading] = useState(false);
  const [seslenTestSentence, setSeslenTestSentence] = useState(
    'Esselâmü aleyküm. Allah dualarımızı kabul eylesin.'
  );
  const seslenRate = voice.seslenHasanRate ?? 0.94;
  const [seslenSpeaking, setSeslenSpeaking] = useState(false);
  const [seslenMouthLevel, setSeslenMouthLevel] = useState(0);
  const [seslenTestResult, setSeslenTestResult] = useState<SeslenSpeakTestResult | null>(null);
  const [seslenOfficialStats, setSeslenOfficialStats] = useState<SeslenPcmStats | null>(null);
  const [seslenLogs, setSeslenLogs] = useState<string[]>([]);

  const loadNativeAndroidStatus = useCallback(async () => {
    setNativeLoading(true);
    try {
      const [info, seslen] = await Promise.all([
        getNativeAndroidEngineInfo(),
        getSeslenStatus(),
      ]);
      setNativeStatus(info);
      setSeslenStatus(seslen);
      if (seslen.logs && seslen.logs.length > 0) {
        setSeslenLogs(seslen.logs);
      }
    } finally {
      setNativeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNativeAndroidStatus();
  }, [loadNativeAndroidStatus]);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    void subscribeSeslenEvents({
      onDownloadProgress: (ev) => {
        setSeslenProgress(ev);
        setSeslenError(null);
      },
      onDownloadError: (ev) => {
        setSeslenError(ev.message);
        void getSeslenStatus().then(setSeslenStatus);
      },
      onStart: () => {
        setSeslenSpeaking(true);
      },
      onMouth: (ev) => {
        setSeslenMouthLevel(ev.level);
      },
      onLog: (ev) => {
        setSeslenLogs((prev) => [...prev.slice(-79), ev.line]);
      },
      onDone: (ev) => {
        setSeslenSpeaking(false);
        setSeslenMouthLevel(0);
        setSeslenTestResult(ev);
        if (ev.logs) setSeslenLogs(ev.logs);
      },
      onError: (ev) => {
        setSeslenSpeaking(false);
        setSeslenMouthLevel(0);
        setSeslenError(ev.message);
      },
    }).then((fn) => {
      unsub = fn;
    });
    return () => {
      unsub?.();
    };
  }, []);

  const handleStartSeslenDownload = async () => {
    setSeslenError(null);
    setSeslenIntegrity(null);
    const res = await downloadSeslenModel();
    if (!res.ok && res.error) {
      setSeslenError(res.error);
    }
    const updated = await getSeslenStatus();
    setSeslenStatus(updated);
    if (updated.logs) setSeslenLogs(updated.logs);
  };

  const handleVerifySeslenIntegrity = async () => {
    setSeslenIntegrityLoading(true);
    setSeslenError(null);
    try {
      const res = await verifySeslenModelIntegrity();
      setSeslenIntegrity(res);
      if (res.logs) setSeslenLogs(res.logs);
      if (!res.ok && res.error) {
        setSeslenError(res.error);
      }
    } finally {
      setSeslenIntegrityLoading(false);
    }
  };

  const handleVerifySeslenContract = async () => {
    setSeslenContractLoading(true);
    setSeslenError(null);
    try {
      const res = await verifySeslenContract(seslenTestSentence);
      setSeslenContract(res);
      if (res.logs) setSeslenLogs(res.logs);
      if (!res.ok && res.error) {
        setSeslenError(res.error);
      }
      const updated = await getSeslenStatus();
      setSeslenStatus(updated);
    } finally {
      setSeslenContractLoading(false);
    }
  };

  const handleSpeakSeslenTest = async () => {
    setSeslenError(null);
    setSeslenTestResult(null);
    setSeslenSpeaking(true);
    try {
      const res = await speakSeslenTest({
        text: seslenTestSentence,
        rate: seslenRate,
        volume: voice.volume,
      });
      setSeslenTestResult(res);
      if (res.logs) setSeslenLogs(res.logs);
      if (!res.ok && res.error && !res.cancelled) {
        setSeslenError(res.error);
      }
      const updated = await getSeslenStatus();
      setSeslenStatus(updated);
    } finally {
      setSeslenSpeaking(false);
      setSeslenMouthLevel(0);
    }
  };

  const handleReplayLastSeslenWav = async () => {
    setSeslenError(null);
    setSeslenSpeaking(true);
    try {
      const res = await replayLastSeslenWav(voice.volume);
      if (res.logs) setSeslenLogs(res.logs);
      if (!res.ok && res.error) {
        setSeslenError(res.error);
      }
    } finally {
      setSeslenSpeaking(false);
      setSeslenMouthLevel(0);
    }
  };

  const handlePlayOfficialHasanSample = async () => {
    setSeslenError(null);
    setSeslenSpeaking(true);
    try {
      const res = await playOfficialHasanSample(voice.volume);
      if (res.officialSampleStats) {
        setSeslenOfficialStats(res.officialSampleStats);
      }
      if (res.logs) setSeslenLogs(res.logs);
      if (!res.ok && res.error) {
        setSeslenError(res.error);
      }
    } finally {
      setSeslenSpeaking(false);
      setSeslenMouthLevel(0);
    }
  };

  const handleStopSeslenTest = async () => {
    await stopSeslenTest();
    setSeslenSpeaking(false);
    setSeslenMouthLevel(0);
  };

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

  const scholar1EffectiveURI = resolveScholarVoiceURI(voice, 'scholar_1');
  const scholar1Resolved = useMemo(
    () => resolveTurkishSystemVoice(rawSpeechVoices, scholar1EffectiveURI, voice.language || 'tr-TR'),
    [rawSpeechVoices, scholar1EffectiveURI, voice.language]
  );

  const scholar2EffectiveURI = resolveScholarVoiceURI(voice, 'scholar_2');
  const scholar2Resolved = useMemo(
    () => resolveTurkishSystemVoice(rawSpeechVoices, scholar2EffectiveURI, voice.language || 'tr-TR'),
    [rawSpeechVoices, scholar2EffectiveURI, voice.language]
  );

  const scholar1Prosody = getScholarProsody(voice.rate, voice.pitch, 'scholar_1', {
    enabled: voice.scholar1IndependentEnabled,
    rate: voice.scholar1Rate,
    pitch: voice.scholar1Pitch,
  });
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
      scholar1IndependentEnabled: true,
      scholar1Rate: 0.76,
      scholar1Pitch: 0.68,
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

          {/* Independent Voice Profile ONLY for Hacı Ahmet Efendi */}
          <div className="bg-[#0B142B] border border-[#C9A45C]/45 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#D4B26A]">
                  Mevcut Sistem TTS Profili (Antalia-2 Mini)
                </p>
                <h2 className="text-base font-semibold text-white">
                  {scholars.profiles.scholar_1.name} (Sistem TTS Hız / Perde)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => testSystemTurkishSpeech('scholar_1')}
                className="inline-flex items-center gap-1.5 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-[#F4E3BD] font-semibold text-xs px-3 py-1.5 cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Sistem TTS (Antalia) Testi</span>
              </button>
            </div>

            <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={voice.scholar1IndependentEnabled !== false}
                onChange={(e) =>
                  updateVoiceConfig({ scholar1IndependentEnabled: e.target.checked })
                }
                className="mt-0.5 accent-[#C9A45C]"
              />
              <span>
                Yalnızca {scholars.profiles.scholar_1.name} için bağımsız hız ve ses perdesi profili uygula ({scholars.profiles.scholar_2.name} mevcut ayarlarında aynen korunur)
              </span>
            </label>

            <div
              className={`space-y-3.5 pt-2 border-t border-[#16254A] ${
                voice.scholar1IndependentEnabled === false ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              <div>
                <label htmlFor="voice-scholar-1-override" className="block text-xs text-slate-300 mb-1.5">
                  Hacı Ahmet Özel Ses Seçimi (Opsiyonel)
                </label>
                <select
                  id="voice-scholar-1-override"
                  value={voice.scholar1VoiceURI}
                  onChange={(e) => updateVoiceConfig({ scholar1VoiceURI: e.target.value })}
                  className="w-full bg-[#070E1F] border border-[#233969] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#C9A45C]"
                >
                  <option value="">
                    Varsayılan / Antalia-2 Mini Motoru (Yalnızca Hız ve Perde Farklılaşır)
                  </option>
                  {turkishVoices.map((v) => (
                    <option key={`s1-${v.voiceURI}`} value={v.voiceURI}>
                      {formatVoiceLabel(v)}
                    </option>
                  ))}
                  {otherVoices.map((v) => (
                    <option key={`s1o-${v.voiceURI}`} value={v.voiceURI}>
                      {formatVoiceLabel(v)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <label htmlFor="scholar1-rate" className="text-slate-300">
                    Hacı Ahmet Konuşma Hızı (Ağırbaşlı: 0.76×)
                  </label>
                  <span className="font-mono-tabular text-[#E5C88B]">
                    {(voice.scholar1Rate ?? 0.76).toFixed(2)}×
                  </span>
                </div>
                <input
                  id="scholar1-rate"
                  type="range"
                  min={0.55}
                  max={1.15}
                  step={0.02}
                  value={voice.scholar1Rate ?? 0.76}
                  onChange={(e) => updateVoiceConfig({ scholar1Rate: Number(e.target.value) })}
                  className="w-full accent-[#C9A45C]"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <label htmlFor="scholar1-pitch" className="text-slate-300">
                    Hacı Ahmet Ses Perdesi / Kalınlık (Tok Ton: 0.68)
                  </label>
                  <span className="font-mono-tabular text-[#E5C88B]">
                    {(voice.scholar1Pitch ?? 0.68).toFixed(2)}
                  </span>
                </div>
                <input
                  id="scholar1-pitch"
                  type="range"
                  min={0.5}
                  max={1.1}
                  step={0.02}
                  value={voice.scholar1Pitch ?? 0.68}
                  onChange={(e) => updateVoiceConfig({ scholar1Pitch: Number(e.target.value) })}
                  className="w-full accent-[#C9A45C]"
                />
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Not: Android <code className="font-mono text-slate-300">TextToSpeech</code> (Antalia-2 Mini) motoru perde ve konuşma hızı parametrelerini destekler; ses tellerine özel pürüzlülük DSP filtresi sağlamaz. Daha tok ve yaşlı etki için perde düşürülüp okuma hızı ağırlaştırılır.
              </p>
            </div>
          </div>

          {/* Isolated Seslen-TTS Hasan (Hacı Ahmet Efendi ONLY) Verification & Single-Sentence Test */}
          <div className="bg-[#0B142B] border border-[#C9A45C]/55 p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#16254A] pb-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#D4B26A]">
                  Aşama 5 Aktif · Hacı Ahmet Kuyruğu: Seslen-TTS Hasan
                </p>
                <h2 className="text-base font-semibold text-white">
                  Hacı Ahmet Efendi — Seslen-TTS &ldquo;Hasan&rdquo; (70 Yaş · Bariton)
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Hedef Cihaz: <span className="text-slate-200">Redmi Note 10T 5G (6 GB RAM, arm64-v8a)</span>. Hacı Ahmet dua kuyruğunda Seslen-TTS Hasan kullanır; Hacı Mehmet Efendi&apos;nin Antalia-2 Mini sesi aynen korunur.
                </p>
              </div>
              <span
                className={`text-[11px] font-mono px-2 py-1 border ${
                  seslenStatus?.modelInstalled
                    ? 'border-emerald-500/50 bg-emerald-950/35 text-emerald-300'
                    : 'border-amber-500/40 bg-amber-950/30 text-amber-200'
                }`}
              >
                {seslenStatus?.modelInstalled ? 'Model Hazır (310.6 MB)' : 'Model Kurulmadı'}
              </span>
            </div>

            {!seslenStatus?.isNativeAndroid || !seslenStatus?.pluginAvailable ? (
              <div className="bg-[#070E1F] border border-amber-500/40 p-3.5 text-xs text-slate-300 space-y-1.5 leading-relaxed">
                <p className="font-semibold text-amber-200">
                  Android APK Ortamı Gerekli (Chrome Preview Aktif)
                </p>
                <p>
                  Chaquopy (<code className="font-mono text-white">turkce-vurgu</code> / <code className="font-mono text-white">turkce-normalize</code>) ve ONNX Runtime (<code className="font-mono text-white">metin.onnx</code> + <code className="font-mono text-white">ses.onnx</code>) yerel Android APK içinde çalışır. Model indirme, SHA-256 doğrulama ve tek cümle Hasan testi Redmi Note 10T 5G üzerindeki APK derlemesinde aktif olur.
                </p>
              </div>
            ) : (
              <div className="space-y-3.5 text-xs">
                {/* Wi-Fi Download & Integrity */}
                <div className="bg-[#070E1F] border border-[#1B2D58] p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-white">1. Wi-Fi Model İndirme &amp; SHA-256 Doğrulama</p>
                      <p className="text-slate-400">
                        Wi-Fi: <strong className={seslenStatus.wifiConnected ? 'text-emerald-300' : 'text-amber-300'}>{seslenStatus.wifiConnected ? 'Bağlı' : 'Bağlı Değil (Wi-Fi Gerekli)'}</strong> · Boyut: 310.6 MiB (tek seferlik dahili hafıza)
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!seslenStatus.modelInstalled && !seslenStatus.isDownloading && (
                        <button
                          type="button"
                          onClick={() => void handleStartSeslenDownload()}
                          className="bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] font-semibold px-3 py-1.5 cursor-pointer"
                        >
                          {seslenError ? 'Tekrar Dene (Wi-Fi)' : 'Wi-Fi ile Modeli İndir'}
                        </button>
                      )}
                      {seslenStatus.isDownloading && (
                        <button
                          type="button"
                          onClick={() => void cancelSeslenDownload()}
                          className="bg-[#2B1822] border border-rose-500/40 text-rose-200 px-3 py-1.5 cursor-pointer"
                        >
                          İptal Et
                        </button>
                      )}
                      {seslenStatus.modelInstalled && (
                        <button
                          type="button"
                          disabled={seslenIntegrityLoading}
                          onClick={() => void handleVerifySeslenIntegrity()}
                          className="bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-[#E5C88B] px-3 py-1.5 cursor-pointer disabled:opacity-60"
                        >
                          {seslenIntegrityLoading ? 'SHA-256 Kontrol Ediliyor...' : 'SHA-256 Bütünlüğünü Doğrula'}
                        </button>
                      )}
                    </div>
                  </div>

                  {(seslenStatus.isDownloading || (seslenProgress && seslenProgress.percent < 100)) && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[11px] text-slate-300">
                        <span>
                          {seslenProgress?.phase === 'verifying' ? 'SHA-256 Doğrulanıyor' : 'İndiriliyor'}:{' '}
                          <code className="font-mono text-white">{seslenProgress?.currentFile || '...'}</code>
                        </span>
                        <span className="font-mono-tabular text-[#E5C88B]">
                          {seslenProgress?.percent ?? seslenStatus.percent}% ({((seslenProgress?.downloadedBytes ?? seslenStatus.downloadedBytes) / (1024 * 1024)).toFixed(1)} / 310.6 MB)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-[#0B142B] border border-[#1B2D58]">
                        <div
                          className="h-full bg-[#C9A45C] transition-all"
                          style={{ width: `${seslenProgress?.percent ?? seslenStatus.percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {seslenIntegrity && (
                    <div
                      className={`p-2.5 border ${
                        seslenIntegrity.ok
                          ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                          : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                      }`}
                    >
                      {seslenIntegrity.ok
                        ? `Tüm ${seslenIntegrity.files.length} model dosyasının boyut ve SHA-256 özeti doğrulandı.`
                        : seslenIntegrity.error || 'Bütünlük doğrulaması başarısız.'}
                    </div>
                  )}
                </div>

                {/* Stage 3: ONNX & Python Contract Check */}
                <div className="bg-[#070E1F] border border-[#1B2D58] p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-white">2. ONNX Tensor &amp; Python Ön İşleme Doğrulaması</p>
                    <button
                      type="button"
                      disabled={!seslenStatus.modelInstalled || seslenContractLoading}
                      onClick={() => void handleVerifySeslenContract()}
                      className="bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-[#E5C88B] px-3 py-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {seslenContractLoading ? 'Doğrulanıyor...' : 'ONNX Kontratını Doğrula'}
                    </button>
                  </div>
                  {seslenContract && (
                    <div
                      className={`p-2.5 border space-y-1 ${
                        seslenContract.ok
                          ? 'bg-emerald-950/25 border-emerald-500/40 text-emerald-200'
                          : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                      }`}
                    >
                      {seslenContract.ok ? (
                        <>
                          <p>
                            Stil vektörü: <code className="font-mono text-white">hasan/notr ({seslenContract.styleDim} float)</code> · Token L: <code className="font-mono text-white">{seslenContract.tokenLengthL}</code>
                          </p>
                          <p className="text-slate-300">
                            G2P okunuş: <code className="font-mono text-white">{seslenContract.pythonOkunus}</code>
                          </p>
                        </>
                      ) : (
                        <p>{seslenContract.error}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Stage 4: Isolated Single-Sentence Playback Test */}
                <div className="bg-[#070E1F] border border-[#1B2D58] p-3.5 space-y-3">
                  <p className="font-semibold text-white">3. Hacı Ahmet (Hasan Sesi) Tek Cümle Testi</p>
                  <input
                    type="text"
                    value={seslenTestSentence}
                    onChange={(e) => setSeslenTestSentence(e.target.value)}
                    className="w-full bg-[#0B142B] border border-[#233969] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#C9A45C]"
                  />
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-slate-300">Hasan Konuşma Hızı</span>
                      <span className="font-mono-tabular text-[#E5C88B]">{seslenRate.toFixed(2)}×</span>
                    </div>
                    <input
                      type="range"
                      min={0.78}
                      max={1.12}
                      step={0.02}
                      value={seslenRate}
                      onChange={(e) => updateVoiceConfig({ seslenHasanRate: Number(e.target.value) })}
                      className="w-full accent-[#C9A45C]"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!seslenStatus.modelInstalled || seslenSpeaking}
                      onClick={() => void handleSpeakSeslenTest()}
                      className="inline-flex items-center gap-1.5 bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] font-semibold px-3.5 py-2 cursor-pointer disabled:opacity-50"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>{seslenSpeaking ? 'Sentezleniyor / Çalınıyor...' : 'Hasan Sesiyle Test Cümlesini Oynat'}</span>
                    </button>
                    {seslenStatus.hasLastTestWav && !seslenSpeaking && (
                      <button
                        type="button"
                        onClick={() => void handleReplayLastSeslenWav()}
                        className="inline-flex items-center gap-1.5 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-[#F4E3BD] px-3 py-2 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Son Üretilen WAV&apos;ı Çal</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={seslenSpeaking}
                      onClick={() => void handlePlayOfficialHasanSample()}
                      className="inline-flex items-center gap-1.5 bg-[#13234B] hover:bg-[#1B3166] border border-[#C9A45C]/45 text-[#E5C88B] px-3 py-2 cursor-pointer disabled:opacity-50"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Resmi Hasan Örneğini Çal (ornekler/hasan.wav)</span>
                    </button>
                    {seslenSpeaking && (
                      <button
                        type="button"
                        onClick={() => void handleStopSeslenTest()}
                        className="inline-flex items-center gap-1.5 bg-[#2B1822] border border-rose-500/40 text-rose-200 px-3 py-2 cursor-pointer"
                      >
                        <Square className="w-3.5 h-3.5" />
                        <span>Durdur</span>
                      </button>
                    )}
                  </div>

                  {/* Live Audio RMS Mouth Level */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>PCM Ağız Senkron Seviyesi (24 kHz RMS)</span>
                      <span className="font-mono-tabular text-slate-200">{Math.round(seslenMouthLevel * 100)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-[#0B142B] border border-[#1B2D58]">
                      <div
                        className="h-full bg-emerald-400 transition-all"
                        style={{ width: `${Math.round(seslenMouthLevel * 100)}%` }}
                      />
                    </div>
                  </div>

                  {seslenTestResult && seslenTestResult.ok && (
                    <div className="space-y-2.5">
                      <div className="p-2.5 border border-emerald-500/40 bg-emerald-950/25 text-emerald-200 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div>
                          <span className="text-slate-400 block">Motor</span>
                          <strong className="font-mono text-[11px]">ONNX Hasan (Antalia: Yok)</strong>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Sentez / Ses</span>
                          <strong className="font-mono-tabular">{seslenTestResult.synthesisMs} / {seslenTestResult.audioDurationMs} ms</strong>
                        </div>
                        <div>
                          <span className="text-slate-400 block">RTF</span>
                          <strong className="font-mono-tabular">{seslenTestResult.rtf}</strong>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Boş RAM</span>
                          <strong className="font-mono-tabular">{seslenTestResult.memory?.systemAvailMb ?? '—'} MB</strong>
                        </div>
                      </div>

                      {seslenTestResult.styleVerification && (
                        <div className="p-2.5 border border-[#1B2D58] bg-[#0B142B] text-[11px] font-mono text-slate-300 space-y-0.5">
                          <p className="text-[#E5C88B]">
                            Stil Doğrulama: {seslenTestResult.styleVerification.speakerKey} ({seslenTestResult.styleVerification.dim} float · L2={seslenTestResult.styleVerification.l2Norm})
                          </p>
                          <p>ref[0..3]: {seslenTestResult.styleVerification.refHead}</p>
                          <p>s[128..131]: {seslenTestResult.styleVerification.styleHead}</p>
                        </div>
                      )}

                      {(seslenTestResult.rawPcmStats || seslenTestResult.playedPcmStats) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                          {seslenTestResult.rawPcmStats && (
                            <div className="p-2.5 border border-[#1B2D58] bg-[#0B142B] text-slate-300 space-y-0.5">
                              <p className="text-white font-semibold">Ham Model Çıktısı (ses.onnx)</p>
                              <p>Örnek: {seslenTestResult.rawPcmStats.sampleCount} · {seslenTestResult.rawPcmStats.durationMs} ms</p>
                              <p>Peak: {seslenTestResult.rawPcmStats.peak} · RMS: {seslenTestResult.rawPcmStats.rms} · NaN: {seslenTestResult.rawPcmStats.nanOrInfCount}</p>
                            </div>
                          )}
                          {seslenTestResult.playedPcmStats && (
                            <div className="p-2.5 border border-[#1B2D58] bg-[#0B142B] text-slate-300 space-y-0.5">
                              <p className="text-white font-semibold">Oynatılan PCM (AudioTrack)</p>
                              <p>{seslenTestResult.playedPcmStats.sampleRate} Hz · {seslenTestResult.playedPcmStats.channels}ch · {seslenTestResult.playedPcmStats.encoding}</p>
                              <p>Peak: {seslenTestResult.playedPcmStats.peak} · RMS: {seslenTestResult.playedPcmStats.rms} · {seslenTestResult.playedPcmStats.durationMs} ms</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {seslenOfficialStats && (
                    <div className="p-2.5 border border-[#C9A45C]/40 bg-[#0B142B] text-[11px] font-mono text-slate-200">
                      <span className="text-[#E5C88B]">Resmi Referans (ornekler/hasan.wav):</span>{' '}
                      {seslenOfficialStats.sampleRate} Hz · {seslenOfficialStats.channels}ch · {seslenOfficialStats.durationMs} ms · Peak {seslenOfficialStats.peak} · RMS {seslenOfficialStats.rms}
                    </div>
                  )}
                </div>

                {seslenError && (
                  <div className="p-3 border border-rose-500/45 bg-rose-950/35 text-rose-200">
                    <strong className="text-white">Seslen-TTS Hatası:</strong> {seslenError}
                  </div>
                )}

                {seslenLogs.length > 0 && (
                  <div className="bg-[#070E1F] border border-[#1B2D58] p-3 space-y-1.5">
                    <p className="font-semibold text-white">Canlı Yerel Motor Kanıt Logları</p>
                    <div className="max-h-40 overflow-y-auto font-mono text-[10px] text-slate-300 space-y-0.5">
                      {seslenLogs.map((line, idx) => (
                        <div key={`slog-${idx}`}>{line}</div>
                      ))}
                    </div>
                  </div>
                )}

                {seslenStatus.memory && (
                  <p className="text-[11px] font-mono text-slate-400">
                    RAM (Redmi Note 10T 5G): JVM {seslenStatus.memory.jvmUsedMb}/{seslenStatus.memory.jvmMaxMb} MB · Native {seslenStatus.memory.nativeHeapMb} MB · Sistem Boş {seslenStatus.memory.systemAvailMb ?? '—'}/{seslenStatus.memory.systemTotalMb ?? '—'} MB
                  </p>
                )}
              </div>
            )}

            <p className="text-[11px] text-slate-400 leading-relaxed border-t border-[#16254A] pt-3">
              <strong className="text-slate-300">Lisans &amp; Yönlendirme:</strong>{' '}
              Seslen-TTS yazılım kodu (MIT — Mehmet Veysel Delibaş) · Model ağırlıkları &amp; &ldquo;hasan&rdquo; sesi (CC BY-SA 4.0) · turkce-vurgu (MIT AND CC-BY-SA-4.0) · turkce-normalize (MIT) · Chaquopy 17.2.0 (MIT) · ONNX Runtime Android 1.32.0 (MIT). Hacı Ahmet Efendi (scholar_1) kuyrukta yalnızca Seslen-TTS Hasan kullanır (hata hâlinde Antalia&apos;ya geri düşmez); Hacı Mehmet Efendi (scholar_2) Antalia-2 Mini motorunda korunur.
            </p>
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

            {/* Required System Turkish Voice Test Buttons */}
            <div className="bg-[#070E1F] border border-[#C9A45C]/35 p-3.5 space-y-2.5">
              <p className="text-xs text-slate-300">
                <strong className="text-white">Sistem TTS (Antalia-2 Mini) Hızlı Test:</strong> &ldquo;Esselâmü aleyküm. Allah dualarımızı kabul eylesin.&rdquo;
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => testSystemTurkishSpeech(testScholar)}
                  className="inline-flex items-center gap-2 bg-[#13234B] hover:bg-[#1B3166] border border-[#C9A45C]/50 text-[#F4E3BD] font-semibold text-xs px-4 py-2.5 cursor-pointer"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>Seçili Hocayı Sistem TTS ile Test Et</span>
                </button>
                <button
                  type="button"
                  onClick={() => testSystemTurkishSpeech('scholar_1')}
                  className="inline-flex items-center gap-1.5 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-slate-300 text-xs px-3 py-2.5 cursor-pointer"
                >
                  <span>Hacı Ahmet (Antalia · {scholar1Prosody.rate.toFixed(2)}× / {scholar1Prosody.pitch.toFixed(2)})</span>
                </button>
                <button
                  type="button"
                  onClick={() => testSystemTurkishSpeech('scholar_2')}
                  className="inline-flex items-center gap-1.5 bg-[#13234B] hover:bg-[#1B3166] border border-[#29437F] text-slate-200 text-xs px-3 py-2.5 cursor-pointer"
                >
                  <span>Hacı Mehmet (Antalia · {scholar2Prosody.rate.toFixed(2)}× / {scholar2Prosody.pitch.toFixed(2)})</span>
                </button>
              </div>
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
