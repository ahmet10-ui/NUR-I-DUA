import {
  AppState,
  GiftRule,
  HighTierDuaEntry,
  PrayerCategoryMeta,
  PrayerTemplate,
  TierRuleConfig,
} from '../types/nuridua';

export const PRAYER_CATEGORIES: PrayerCategoryMeta[] = [
  {
    id: 'mid_opening',
    labelTr: 'Başlangıç Duaları (Orta Hediye)',
    labelEn: 'Opening Duas (Mid Gift)',
    description: 'Dedicated pool for mid-tier gifts (50–149 coins) with non-consecutive rotation.',
  },
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

export const DEFAULT_MID_OPENING_PRAYERS: PrayerTemplate[] = [
  {
    id: 'prayer-mid-01',
    title: 'Başlangıç Şükür ve Bereket Duası',
    category: 'mid_opening',
    template:
      "Bismillâhirrahmânirrahîm. Allah'ım, {isim} kardeşimizin ikramını kabul eyle; ömrüne bereket, gönlüne huzur ve hanesine afiyet ihsan eyle. Âmin.",
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: 'prayer-mid-02',
    title: 'Başlangıç Hayır ve İkram Duası',
    category: 'mid_opening',
    template:
      "Rabbimiz, güzel niyetle ikramda bulunan {isim} kardeşimizin yolunu açık, kazancını helal ve bereketli, kalbini iman nuruyla daim eyle. Âmin.",
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: 'prayer-mid-03',
    title: 'Başlangıç Afiyet ve Selamet Duası',
    category: 'mid_opening',
    template:
      "Yüce Allah'ım, {isim} kardeşimize dünya ve ahiret selameti, bedenine sıhhat, sevdikleriyle birlikte huzurlu ve hayırlı günler nasip eyle. Âmin.",
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: 'prayer-mid-04',
    title: 'Başlangıç Rahmet ve Kolaylık Duası',
    category: 'mid_opening',
    template:
      "Allah'ım, {isim} kardeşimizin işlerini kolaylaştır, gönlündeki hayırlı muratları ihsan eyle ve kendisini her türlü kaza ve beladan muhafaza eyle. Âmin.",
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  {
    id: 'prayer-mid-05',
    title: 'Başlangıç Hane ve Rızık Duası',
    category: 'mid_opening',
    template:
      "Merhametlilerin en merhametlisi Rabbim, {isim} kardeşimizin sofrasına bolluk, yuvasına dirlik ve dua eden dillerine bereket nasip eyle. Âmin.",
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
];

export const DEFAULT_PRAYERS: PrayerTemplate[] = [
  ...DEFAULT_MID_OPENING_PRAYERS,
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

export const DEFAULT_HIGH_TIER_DUAS: HighTierDuaEntry[] = [
  {
    id: 'high-dua-amenerrasulu',
    title: 'Âmenerrasûlü (Bakara Sûresi 285–286)',
    sourceCitation:
      'Kur’ân-ı Kerîm, Bakara Sûresi 2:285–286 · Metin: Quran.com / Tanzil Uthmani · Meal: Diyanet İşleri Başkanlığı · Ses: Qari Aaqib Azeez (Wikimedia Commons, CC0 1.0)',
    arabicHarekeli:
      'ءَامَنَ ٱلرَّسُولُ بِمَآ أُنزِلَ إِلَيْهِ مِن رَّبِّهِۦ وَٱلْمُؤْمِنُونَ ۚ كُلٌّ ءَامَنَ بِٱللَّهِ وَمَلَـٰٓئِكَتِهِۦ وَكُتُبِهِۦ وَرُسُلِهِۦ لَا نُفَرِّقُ بَيْنَ أَحَدٍ مِّن رُّسُلِهِۦ ۚ وَقَالُوا۟ سَمِعْنَا وَأَطَعْنَا ۖ غُفْرَانَكَ رَبَّنَا وَإِلَيْكَ ٱلْمَصِيرُ ۝ لَا يُكَلِّفُ ٱللَّهُ نَفْسًا إِلَّا وُسْعَهَا ۚ لَهَا مَا كَسَبَتْ وَعَلَيْهَا مَا ٱكْتَسَبَتْ ۗ رَبَّنَا لَا تُؤَاخِذْنَآ إِن نَّسِينَآ أَوْ أَخْطَأْنَا ۚ رَبَّنَا وَلَا تَحْمِلْ عَلَيْنَآ إِصْرًا كَمَا حَمَلْتَهُۥ عَلَى ٱلَّذِينَ مِن قَبْلِنَا ۚ رَبَّنَا وَلَا تُحَمِّلْنَا مَا لَا طَاقَةَ لَنَا بِهِۦ ۖ وَٱعْفُ عَنَّا وَٱغْفِرْ لَنَا وَٱرْحَمْنَآ ۚ أَنتَ مَوْلَىٰنَا فَٱنصُرْنَا عَلَى ٱلْقَوْمِ ٱلْكَـٰفِرِينَ',
    turkishMeaning:
      'Bakara Sûresi 285 ve 286. ayetlerin meali: Peygamber ve inananlar, ona Rabbinden indirilene inandı. Hepsi Allah’a, meleklerine, kitaplarına, peygamberlerine inandı; "Peygamberleri arasından hiçbirini ayırt etmeyiz, işittik, itaat ettik, Rabbimiz! Affını dileriz, dönüş Sanadır" dediler. Allah kişiye ancak gücünün yeteceği kadar yükler; kazandığı iyilik lehine, ettiği kötülük de aleyhinedir. Rabbimiz! Eğer unutacak veya yanılacak olursak bizi sorumlu tutma. Rabbimiz! Bizden öncekilere yüklediğin gibi bize de ağır yük yükleme. Rabbimiz! Bize gücümüzün yetmeyeceği şeyi taşıtma, bizi affet, bizi bağışla, bize acı. Sen Mevlamızsın, kâfirlere karşı bize yardım et.',
    personalPrayerTemplate:
      "Okunan bu mübarek ayetlerin hürmetine Allah'ım; {isim} kardeşimize, muhterem anne ve babasına, ailesine, evlatlarına ve bütün akrabalarına sağlık, afiyet, helal rızık, hidayet ve hanelerine huzur ihsan eyle. Hayatta olan yakınlarına hayırlı uzun ömürler, ahirete irtihal eden anne-baba ve akrabalarına ise rahmet ve mağfiret nasip eyle. Âmin.",
    audioUrl: '/audio/duas/amenerrasulu_2_285_286_aaqib_azeez_cc0.mp3',
    audioLicense: 'CC0 1.0 Public Domain Dedication',
    audioAttribution: 'Qari Aaqib Azeez (Wikimedia Commons, File:Al-Baqarah_verses_285-286.mp3)',
    audioSha256: '9d61b290a9aa99ab5b8d94dc01d1172045616290c72f82380a33188fbe235d2a',
    audioStatus: 'verified_ready',
    isActive: true,
    updatedAt: nowIso(),
  },
  {
    id: 'high-dua-fatiha',
    title: 'Fâtiha-i Şerîfe (1:1–7)',
    sourceCitation:
      'Kur’ân-ı Kerîm, Fâtiha Sûresi 1:1–7 · Metin: Quran.com / Tanzil Uthmani · Meal: Diyanet İşleri Başkanlığı · Ses: Qari Aaqib Azeez (Wikimedia Commons, CC0 1.0)',
    arabicHarekeli:
      'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ ۝ ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ ۝ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ ۝ مَـٰلِكِ يَوْمِ ٱلدِّينِ ۝ إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ ۝ ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ ۝ صِرَٰطَ ٱلَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ ٱلْمَغْضُوبِ عَلَيْهِمْ وَلَا ٱلضَّآلِّينَ',
    turkishMeaning:
      'Fâtiha Sûresi’nin meali: Rahmân ve Rahîm olan Allah’ın adıyla. Hamd, âlemlerin Rabbi Allah’a mahsustur. O Rahmân ve Rahîm’dir, Din Günü’nün sahibidir. Ancak Sana kulluk eder ve yalnız Senden yardım dileriz. Bizi doğru yola eriştir; nimete erdirdiğin kimselerin yoluna; gazaba uğrayanların ya da sapıtanların yoluna değil.',
    personalPrayerTemplate:
      "Okunan Fâtiha-i Şerîfe’nin bereketiyle Yüce Rabbim; {isim} kardeşimizin, anne ve babasının, eş ve evlatlarının, bütün aile fertleri ile akrabalarının sıhhatini daim, rızıklarını bereketli, gönüllerini ferah ve akıbetlerini hayır eyle. Geçmişlerinin ruhlarını şad, mekanlarını cennet eyle. Âmin.",
    audioUrl: '/audio/duas/fatiha_aaqib_azeez_cc0.mp3',
    audioLicense: 'CC0 1.0 Public Domain Dedication',
    audioAttribution:
      'Qari Aaqib Azeez (Wikimedia Commons, File:Chapter_1,_Al-Fatiha_(Murattal)_-_Recitation_of_the_Holy_Qur%27an.mp3)',
    audioSha256: '46fe21a5118957d52ac76f5a6a7fdd7e75d52e4a569619ae3e174a23ce5c82bc',
    audioStatus: 'verified_ready',
    isActive: true,
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

export const DEFAULT_TIER_RULES: TierRuleConfig = {
  smallGiftMinCoins: 1,
  smallGiftMaxCoins: 49,
  midGiftMinCoins: 50,
  midGiftMaxCoins: 149,
  highGiftMinCoins: 150,
  highGiftMaxCoins: 299,
  yasinMinCoins: 300,
  coinEvaluationMode: 'event_total',
  followerEnabled: true,
  smallGiftEnabled: true,
  midGiftEnabled: true,
  highGiftEnabled: true,
  yasinEnabled: true,
  followerGreetingTemplate: 'Selâmün aleyküm, {isim}! NUR-I DUA ailemize hoş geldin.',
  smallGiftGreetingTemplate: 'Selâmün aleyküm, {isim}!',
};

export const createDefaultAppState = (): AppState => ({
  prayers: DEFAULT_PRAYERS,
  gifts: DEFAULT_GIFTS,
  tierRules: { ...DEFAULT_TIER_RULES },
  highTierDuas: DEFAULT_HIGH_TIER_DUAS.map((d) => ({ ...d })),
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
        title: 'Kıdemli Dua Hocası',
        bio: 'Sakin hitabeti, şifa ve bereket dualarıyla yayına eşlik eder.',
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
        title: 'İkinci Dua Hocası',
        bio: 'Diğer hoca dua okurken dinleyerek ve âmin diyerek eşlik eder.',
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
    scholar1IndependentEnabled: true,
    scholar1VoiceURI: '',
    scholar1Rate: 0.76,
    scholar1Pitch: 0.68,
    seslenHasanRate: 0.94,
  },
  tiktok: {
    username: 'fcproplayer7',
    connectionState: 'unconfigured',
    connectorEndpoint: '',
    autoReconnect: true,
    maxRetries: 5,
    retryDelaySec: 8,
    duplicateWindowSec: 8,
    lastError: null,
    lastCheckedAt: null,
    roomId: null,
    viewerCount: null,
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
