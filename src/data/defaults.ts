import {
  AppState,
  GiftRule,
  PrayerCategoryMeta,
  PrayerTemplate,
} from '../types/nuridua';

export const PRAYER_CATEGORIES: PrayerCategoryMeta[] = [
  {
    id: 'health_healing',
    labelTr: 'Sağlık ve Şifa',
    labelEn: 'Health & Healing',
    description: 'Prayers asking for physical wellness, recovery, and strength.',
  },
  {
    id: 'blessings_abundance',
    labelTr: 'Bereket ve Rızık',
    labelEn: 'Blessings & Abundance',
    description: 'Prayers for lawful sustenance, abundance, and fruitful work.',
  },
  {
    id: 'family_peace',
    labelTr: 'Aile ve Huzur',
    labelEn: 'Family & Peace',
    description: 'Prayers for harmony, love, and serenity within the household.',
  },
  {
    id: 'good_fortune',
    labelTr: 'Hayırlı Kısmet ve Başarı',
    labelEn: 'Good Fortune',
    description: 'Prayers for righteous paths, wisdom, and auspicious endeavors.',
  },
  {
    id: 'relief_difficulties',
    labelTr: 'Sıkıntılardan Ferahlık',
    labelEn: 'Relief from Difficulties',
    description: 'Prayers for ease during hardship, patience, and open doors.',
  },
  {
    id: 'parents',
    labelTr: 'Anne ve Baba',
    labelEn: 'Parents',
    description: 'Prayers honoring mothers and fathers with mercy and longevity.',
  },
  {
    id: 'happiness_tranquility',
    labelTr: 'Mutluluk ve Gönül Huzuru',
    labelEn: 'Happiness & Tranquility',
    description: 'Prayers for inner peace, gratitude, and calm hearts.',
  },
  {
    id: 'general_blessings',
    labelTr: 'Genel Hayır Duaları',
    labelEn: 'General Blessings',
    description: 'Comprehensive daily supplications for well-being and acceptance.',
  },
];

const nowIso = () => new Date().toISOString();

export const DEFAULT_PRAYERS: PrayerTemplate[] = [
  {
    id: 'prayer-health-01',
    title: 'Şifa ve Afiyet Duası',
    category: 'health_healing',
    template:
      "Allah'ım, {isim} kardeşimize ve ailesine maddi ve manevi şifalar ihsan eyle. Bedenine sıhhat, kalbine ferahlık ve ömrüne hayırlı afiyet nasip eyle. Âmin.",
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: 'prayer-abundance-01',
    title: 'Helal Rızık ve Bereket Duası',
    category: 'blessings_abundance',
    template:
      "Ya Rabbi, {isim} kardeşimizin kazancına bereket, işlerine kolaylık ve hanesine hayırlı rızıklar nasip eyle. Emeğini zayi etme, kapılarını hayra aç. Âmin.",
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: 'prayer-family-01',
    title: 'Hane Huzuru ve Muhabbet Duası',
    category: 'family_peace',
    template:
      "Allah'ım, {isim} kardeşimizin yuvasına muhabbet, sevgi ve kalıcı huzur ikram eyle. Sevdikleriyle arasını daima iyi tut, hanesini her türlü kötülükten muhafaza eyle. Âmin.",
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: 'prayer-fortune-01',
    title: 'Hayırlı Kapılar ve Başarı Duası',
    category: 'good_fortune',
    template:
      "Yüce Rabbim, {isim} kardeşimizin karşısına hayırlı insanlar ve hayırlı fırsatlar çıkar. Attığı her adımda basiret, işlerinde muvaffakiyet nasip eyle. Âmin.",
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: 'prayer-relief-01',
    title: 'Ferahlık ve Sabır Duası',
    category: 'relief_difficulties',
    template:
      "Allah'ım, {isim} kardeşimizin gönlündeki darlığı gider, zorluklarını kolaylığa tebdil eyle. Sabrını artır, beklediği hayırlı ferahlığı tez zamanda nasip eyle. Âmin.",
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: 'prayer-parents-01',
    title: 'Anne ve Baba İçin Hayır Duası',
    category: 'parents',
    template:
      "Rabbimiz, {isim} kardeşimizin anne ve babasına rahmet, sağlık ve hayırlı uzun ömürler ihsan eyle; ahirete irtihal edenlerine ise mağfiret ve huzur nasip eyle. Âmin.",
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: 'prayer-happiness-01',
    title: 'Gönül Ferahlığı ve Şükür Duası',
    category: 'happiness_tranquility',
    template:
      "Allah'ım, {isim} kardeşimizin kalbine sekinet, yüzüne tebessüm ve hayatına şükürle dolu güzel günler nasip eyle. Gönlündeki hayırlı muratları kabul buyur. Âmin.",
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: 'prayer-general-01',
    title: 'Genel Sağlık, Huzur ve Bereket Duası',
    category: 'general_blessings',
    template:
      "Allah'ım, {isim} kardeşimize sağlık, huzur, bereket ve hayırlı bir ömür nasip eyle. Onu ve sevdiklerini muhafaza eyle. Dualarını hayırlısıyla kabul eyle. Âmin.",
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
];

export const DEFAULT_GIFTS: GiftRule[] = [
  {
    id: 'gift-cay-01',
    name: 'Çay',
    tiktokGiftId: 'cay',
    category: 'general_blessings',
    quantityMultiplier: 1,
    repeatPerQuantity: false,
    priority: 'normal',
    enabled: true,
    minCoins: 1,
    updatedAt: nowIso(),
  },
];

export const SAMPLE_TIKTOK_USERNAMES = [
  'ahmet.yilmaz34',
  'fatmanur_kaya',
  'mehmet_demir06',
  'zeynep.arslan',
  'mustafa_celik16',
  'elif_sahin_tr',
  'ibrahim.ozturk',
  'ayse_korkmaz42',
  'hasan_yildiz61',
  'hatice.aydin',
];

export const createDefaultAppState = (): AppState => ({
  prayers: DEFAULT_PRAYERS,
  gifts: DEFAULT_GIFTS,
  queue: [],
  history: [],
  queuePaused: false,
  scholars: {
    activeMode: 'alternate',
    currentSpeaker: 'scholar_1',
    blinkIntervalSec: 3.8,
    headMovementIntensity: 0.75,
    idleBreathingIntensity: 0.7,
    listenerInteractionEnabled: true,
    profiles: {
      scholar_1: {
        id: 'scholar_1',
        name: 'Hacı Ahmet Efendi',
        title: 'Kıdemli Dua Hocası (Dijital Karakter)',
        bio: 'Kurgusal dijital karakter. Sakin hitabeti ve şifa/bereket dualarıyla yayına eşlik eder.',
        capColor: '#1E3A8A',
        jacketColor: '#101F42',
        beardStyle: 'full_white',
        hasSpectacles: true,
        voiceName: '',
        rigProvider: 'procedural',
        customModelUrl: '',
      },
      scholar_2: {
        id: 'scholar_2',
        name: 'Hacı Mehmet Efendi',
        title: 'İkinci Dua Hocası (Dijital Karakter)',
        bio: 'Kurgusal dijital karakter. Diğer hoca dua okurken dinleyerek ve âmin diyerek eşlik eder.',
        capColor: '#1D4ED8',
        jacketColor: '#13244C',
        beardStyle: 'trimmed_silver',
        hasSpectacles: false,
        voiceName: '',
        rigProvider: 'procedural',
        customModelUrl: '',
      },
    },
  },
  voice: {
    provider: 'browser_speech_synthesis',
    neuralProviderId: 'azure_neural',
    neuralVoiceId: 'tr-TR-AhmetNeural',
    neuralScholar2VoiceId: 'tr-TR-AhmetNeural-deep',
    narrationTone: 'calm_elderly',
    fallbackToBrowser: true,
    language: 'tr-TR',
    selectedVoiceURI: '',
    scholar2VoiceURI: '',
    rate: 0.86,
    pitch: 0.84,
    volume: 0.95,
    externalEndpoint: '',
  },
  tiktok: {
    username: '',
    connectionState: 'unconfigured',
    connectorEndpoint: '',
    autoReconnect: true,
    maxRetries: 5,
    retryDelaySec: 8,
    duplicateWindowSec: 8,
    lastError: null,
    lastCheckedAt: null,
  },
  broadcast: {
    studioTitle: 'NUR-I DUA',
    showSenderCard: true,
    showPrayerText: true,
    showScholarNames: true,
    goldAnimationsEnabled: true,
    postSpeechHoldSec: 2.5,
    cameraPreset: 'broadcast_portrait',
  },
  logs: [
    {
      id: 'log-init-01',
      timestamp: nowIso(),
      level: 'info',
      source: 'system',
      message: 'NUR-I DUA studio initialized with local persistence. TikTok LIVE connector is not configured.',
    },
  ],
  stats: {
    totalGifts: 0,
    totalPrayers: 0,
    simulatedGifts: 0,
    realGifts: 0,
  },
  lastUpdatedAt: nowIso(),
});
