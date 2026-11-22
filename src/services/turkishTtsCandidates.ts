/**
 * NUR-I DUA — Türkçe TTS Aday Değerlendirme Matrisi
 *
 * Hacı Ahmet Efendi (scholar_1) için erkek Türkçe TTS adaylarının teknik,
 * cinsiyet/ton, çalışma zamanı uyumu (onnxruntime-android:1.32.0 / arm64-v8a)
 * ve lisans değerlendirmesi. Tamamen şeffaf ve doğrulanmış verilere dayanır.
 */

export type TtsCandidateStatus = 'active_default' | 'integrated_opt_in' | 'rejected';

export interface TurkishTtsCandidateEntry {
  id: string;
  name: string;
  voiceLabel: string;
  status: TtsCandidateStatus;
  statusLabel: string;
  genderAndTone: string;
  runtimeAndSize: string;
  sampleRateHz: number;
  licenseStatus: string;
  legalNote: string;
  sourceUrl: string;
  decisionSummary: string;
}

export const TURKISH_TTS_CANDIDATE_MATRIX: TurkishTtsCandidateEntry[] = [
  {
    id: 'seslen_hasan',
    name: 'Seslen-TTS (Hasan)',
    voiceLabel: 'Hasan · Yerel ONNX',
    status: 'active_default',
    statusLabel: 'Varsayılan Aktif',
    genderAndTone: 'Erkek, oturaklı ve doğal yaşlıca imam/hoca üslubu',
    runtimeAndSize: 'onnxruntime-android 1.32.0 + Chaquopy turkce-vurgu (~326 MB / 111.7M par.)',
    sampleRateHz: 24000,
    licenseStatus: 'Apache-2.0 / MIT bileşenler',
    legalNote: 'Mevcut doğrulanan referans model; varsayılan motor olarak korunur.',
    sourceUrl: 'https://github.com/ozcancelik/seslen-tts',
    decisionSummary:
      'Ses kalitesi en oturaklı erkek hoca tonudur; sentez hızı mobilde daha yavaştır (RTF ~3.1–4.0x) fakat güvenilir baz olarak korunur.',
  },
  {
    id: 'zerre_ses_a',
    name: 'Zerre-TTS SES-A (MK)',
    voiceLabel: 'SES-A (MK) · Saf ONNX',
    status: 'integrated_opt_in',
    statusLabel: 'Entegre · İsteğe Bağlı (Opt-In)',
    genderAndTone: 'Erkek sesli kitap anlatıcısı tonu; düşük gecikmeli hızlı sentez hedefi',
    runtimeAndSize: 'onnxruntime-android 1.32.0 (ek C++/NDK yok) · ~9.7 MB paket (INT8 8.55 MB)',
    sampleRateHz: 24000,
    licenseStatus: 'Kod/ağırlık Apache-2.0 · Kaynak sesli kitap hukuki inceleme gerekir',
    legalNote:
      'Upstream docs/data_sources.md: eğitim verisi sesli kitap korpusundan (MIT beyanı yükleyiciye ait) derlenmiştir; ticari/genel yayın öncesi kullanıcı hukuki değerlendirmesi gerekir.',
    sourceUrl: 'https://github.com/erkinemreta1/zerre-tts',
    decisionSummary:
      'Mevcut onnxruntime-android 1.32.0 ile çakışma olmadan entegre edildi; küçük boyutu ve hızlı ONNX çıkarımı ile Hasan/EMA A/B testine alındı.',
  },
  {
    id: 'ema_lightning',
    name: 'EMA Lightning',
    voiceLabel: 'Tek Yerleşik Ses · Saf ONNX',
    status: 'integrated_opt_in',
    statusLabel: 'Entegre · İsteğe Bağlı (Opt-In)',
    genderAndTone: 'Genç / kadın tınısına yakın (hoca karakteri için erkek tonu zayıf)',
    runtimeAndSize: 'onnxruntime-android 1.32.0 (8.6M par., FP32+INT8) · RTF <0.4x',
    sampleRateHz: 48000,
    licenseStatus: 'Apache-2.0',
    legalNote: 'Apache-2.0 açık kaynak; yalnızca isteğe bağlı kıyaslama amacıyla korunur.',
    sourceUrl: 'https://huggingface.co/ozcancelik/ema-lightning-onnx',
    decisionSummary:
      'Hız ölçütünde referans (RTF <0.4x); ses tonu kadın karakterine yakın olduğu için yalnızca kıyaslama seçeneği olarak tutulur.',
  },
  {
    id: 'zerre_ses_b',
    name: 'Zerre-TTS SES-B (NK)',
    voiceLabel: 'SES-B (NK)',
    status: 'rejected',
    statusLabel: 'Reddedildi (Kadın Sesi)',
    genderAndTone: 'Kadın anlatıcı sesi',
    runtimeAndSize: 'Aynı Zerre ONNX içinde voice=1',
    sampleRateHz: 24000,
    licenseStatus: 'Apache-2.0 + docs/data_sources.md uyarısı',
    legalNote: 'Yalnızca erkek SES-A (voice=0) kullanıldı; voice=1 kasıtlı olarak engellendi.',
    sourceUrl: 'https://github.com/erkinemreta1/zerre-tts',
    decisionSummary: 'Hacı Ahmet Efendi erkek ses gereksinimine uymadığı için reddedildi.',
  },
  {
    id: 'piper_fettah',
    name: 'Piper tr_TR-fettah-medium',
    voiceLabel: 'tr_TR-fettah-medium',
    status: 'rejected',
    statusLabel: 'Reddedildi (Kadın Sesi)',
    genderAndTone: 'Kadın sesi (medyan temel frekans ~193.4 Hz)',
    runtimeAndSize: 'Piper / VITS + espeak-ng',
    sampleRateHz: 22050,
    licenseStatus: 'MIT/CC0 belirsiz + espeak-ng GPL-3.0 bulaşma riski',
    legalNote: 'Hem kadın sesi hem GPL-3.0 espeak-ng bağımlılığı.',
    sourceUrl: 'https://huggingface.co/rhasspy/piper-voices',
    decisionSummary: 'Erkek sesi olmadığı ve GPL-3.0 bağımlılığı taşıdığı için reddedildi.',
  },
  {
    id: 'piper_fahrettin',
    name: 'Piper tr_TR-fahrettin-medium',
    voiceLabel: 'tr_TR-fahrettin-medium',
    status: 'rejected',
    statusLabel: 'Reddedildi (Lisans + ABI)',
    genderAndTone: 'Erkek sesi (kısmen robotik prosodi)',
    runtimeAndSize: 'VITS + espeak-ng / sherpa-onnx (libonnxruntime.so ABI çakışması)',
    sampleRateHz: 22050,
    licenseStatus: 'Çelişkili beyan (CC0 vs none) + GPL-3.0 espeak-ng zorunlu',
    legalNote:
      'sherpa-onnx paketi mevcut com.microsoft.onnxruntime:onnxruntime-android:1.32.0 ile libonnxruntime.so sembol çakışması oluşturur.',
    sourceUrl: 'https://huggingface.co/rhasspy/piper-voices',
    decisionSummary:
      'Çelişkili lisans metadata’sı, GPL-3.0 espeak-ng zorunluluğu ve libonnxruntime.so ABI çakışması nedeniyle reddedildi.',
  },
];
