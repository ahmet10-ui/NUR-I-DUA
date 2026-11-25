import {
  AppState,
  GiftRule,
  HighTierDuaEntry,
  PrayerCategoryMeta,
  PrayerTemplate,
  ScholarSettingsConfig,
  TierRuleConfig,
  YasinRecitationConfig,
} from '../types/nuridua';

export const PRAYER_CATEGORIES: PrayerCategoryMeta[] = [
  {
    id: 'mid_opening',
    labelTr: 'Başlangıç Duaları (Orta Hediye)',
    labelEn: 'Opening Duas (Mid Gift)',
    description: 'Dedicated pool for mid-tier gifts (11–35 coins) with non-consecutive rotation.',
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
  {
    id: 'high-dua-ayetel-kursi',
    title: 'Âyetel Kürsî (Bakara Sûresi 2:255)',
    sourceCitation:
      'Kur’ân-ı Kerîm, Bakara Sûresi 2:255 · Metin: Quran.com / Tanzil Uthmani · Meal: Diyanet İşleri Başkanlığı · Ses: Qari Aaqib Azeez (Wikimedia Commons, CC BY-SA 4.0)',
    arabicHarekeli:
      'ٱللَّهُ لَآ إِلَـٰهَ إِلَّا هُوَ ٱلْحَىُّ ٱلْقَيُّومُ ۚ لَا تَأْخُذُهُۥ سِنَةٌ وَلَا نَوْمٌ ۚ لَّهُۥ مَا فِى ٱلسَّمَـٰوَٰتِ وَمَا فِى ٱلْأَرْضِ ۗ مَن ذَا ٱلَّذِى يَشْفَعُ عِندَهُۥٓ إِلَّا بِإِذْنِهِۦ ۚ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ ۖ وَلَا يُحِيطُونَ بِشَىْءٍ مِّنْ عِلْمِهِۦٓ إِلَّا بِمَا شَآءَ ۚ وَسِعَ كُرْسِيُّهُ ٱلسَّمَـٰوَٰتِ وَٱلْأَرْضَ ۖ وَلَا يَـُٔودُهُۥ حِفْظُهُمَا ۚ وَهُوَ ٱلْعَلِىُّ ٱلْعَظِيمُ',
    turkishMeaning:
      'Bakara Sûresi 255. ayetin meali: Allah, O’ndan başka ilâh yoktur; diridir, her şeyin varlığı O’na bağlı ve dayalıdır. Ne uykusu gelir ne de uyur. Göklerde ve yerde ne varsa hepsi O’nundur. O’nun izni olmadıkça katında hiçbir kimse şefaat edemez. Onların önlerinde ve arkalarında olanları O bilir. O’nun ilminden hiçbir şeyi —dilediği müstesna— kimse bilgisi içine sığdıramaz. O’nun kürsüsü gökleri ve yeri içine almıştır. Onları korumak kendisine zor gelmez. O yücedir, mutlak büyüktür.',
    personalPrayerTemplate:
      "Âyetel Kürsî’nin hürmetine Allah'ım; {isim} kardeşimize, muhterem anne ve babasına, eşine, evlatlarına ve bütün akrabalarına görünür görünmez her türlü kaza, bela ve şerden muhafaza; bedenlerine sıhhat, hânelerine huzur ve helal rızık ihsan eyle. Vefat etmiş yakınlarına rahmet ve mağfiret nasip eyle. Âmin.",
    audioUrl: '/audio/duas/ayetel_kursi_2_255_aaqib_azeez_ccbysa4.mp3',
    audioLicense: 'CC BY-SA 4.0 (Wikimedia Commons · Kendi Çalışması / Own Work)',
    audioAttribution: 'Qari Aaqib Azeez (Wikimedia Commons, File:Throne_Verse_(Al-Baqara,_verse_255).mp3)',
    audioSha256: 'cb32b4b36012fdc2c4a93460a7106b9e337f1244d5198a549cea76a7edeaeb38',
    audioStatus: 'verified_ready',
    isActive: true,
    updatedAt: nowIso(),
  },
  {
    id: 'high-dua-ihlas',
    title: 'İhlâs Sûresi (112:1–4)',
    sourceCitation:
      'Kur’ân-ı Kerîm, İhlâs Sûresi 112:1–4 · Metin: Quran.com / Tanzil Uthmani · Meal: Diyanet İşleri Başkanlığı · Ses: Qari Aaqib Azeez (Wikimedia Commons, CC0 1.0)',
    arabicHarekeli:
      'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ ۝ قُلْ هُوَ ٱللَّهُ أَحَدٌ ۝ ٱللَّهُ ٱلصَّمَدُ ۝ لَمْ يَلِدْ وَلَمْ يُولَدْ ۝ وَلَمْ يَكُن لَّهُۥ كُفُوًا أَحَدٌۢ',
    turkishMeaning:
      'İhlâs Sûresi’nin meali: Rahmân ve Rahîm olan Allah’ın adıyla. De ki: O, Allah’tır, bir tektir. Allah Samed’dir (Her şey O’na muhtaçtır; O hiçbir şeye muhtaç değildir). O’ndan çocuk olmamıştır; kendisi de doğmamıştır. Hiçbir şey O’na denk ve benzer değildir.',
    personalPrayerTemplate:
      "Okunan İhlâs-ı Şerîf’in nuru hürmetine Yüce Rabbim; {isim} kardeşimizin, anne ve babasının, ailesinin ve bütün akrabalarının kalplerini iman ve ihlâs ile sabit kıl; kendilerine iki cihanda afiyet, bereket ve hayırlı uzun ömürler ihsan eyle. Geçmişlerinin ruhlarını şad eyle. Âmin.",
    audioUrl: '/audio/duas/ihlas_112_aaqib_azeez_cc0.mp3',
    audioLicense: 'CC0 1.0 Public Domain Dedication',
    audioAttribution:
      "Qari Aaqib Azeez (Wikimedia Commons, File:Chapter_112,_Al-Ikhlas_(Mujawwad)_-_Recitation_of_the_Holy_Qur'an.mp3)",
    audioSha256: 'bcf92fc3ff76170c1a5f12c94636d290f26386a382b58e102425407b71463c5b',
    audioStatus: 'verified_ready',
    isActive: true,
    updatedAt: nowIso(),
  },
  {
    id: 'high-dua-felak',
    title: 'Felak Sûresi (113:1–5)',
    sourceCitation:
      'Kur’ân-ı Kerîm, Felak Sûresi 113:1–5 · Metin: Quran.com / Tanzil Uthmani · Meal: Diyanet İşleri Başkanlığı · Ses: Qari Aaqib Azeez (Wikimedia Commons, CC0 1.0)',
    arabicHarekeli:
      'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ ۝ قُلْ أَعُوذُ بِرَبِّ ٱلْفَلَقِ ۝ مِن شَرِّ مَا خَلَقَ ۝ وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ ۝ وَمِن شَرِّ ٱلنَّفَّـٰثَـٰتِ فِى ٱلْعُقَدِ ۝ وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ',
    turkishMeaning:
      'Felak Sûresi’nin meali: Rahmân ve Rahîm olan Allah’ın adıyla. De ki: Yarattığı şeylerin kötülüğünden, karanlığı çöktüğü zaman gecenin kötülüğünden, düğümlere üfleyenlerin kötülüğünden ve haset ettiği zaman hasetçinin kötülüğünden, sabah aydınlığının Rabbine sığınırım.',
    personalPrayerTemplate:
      "Felak Sûresi’nin hürmetine Allah'ım; {isim} kardeşimizi, muhterem anne ve babasını, aile fertlerini ve bütün akrabalarını hasetçilerin şerrinden, nazar ve vesveseden muhafaza eyle; ömürlerine sağlık, kalplerine sekinet ve yuvalarına selamet ver. Âmin.",
    audioUrl: '/audio/duas/felak_113_aaqib_azeez_cc0.mp3',
    audioLicense: 'CC0 1.0 Public Domain Dedication',
    audioAttribution:
      "Qari Aaqib Azeez (Wikimedia Commons, File:Chapter_113,_Al-Falaq_(Murattal)_-_Recitation_of_the_Holy_Qur'an.mp3)",
    audioSha256: '2e01e8048cca4ff3a7419331e119241d15565e1e5a531fab85bd53d7283afcc9',
    audioStatus: 'verified_ready',
    isActive: true,
    updatedAt: nowIso(),
  },
  {
    id: 'high-dua-nas',
    title: 'Nâs Sûresi (114:1–6)',
    sourceCitation:
      'Kur’ân-ı Kerîm, Nâs Sûresi 114:1–6 · Metin: Quran.com / Tanzil Uthmani · Meal: Diyanet İşleri Başkanlığı · Ses: Qari Aaqib Azeez (Wikimedia Commons, CC0 1.0)',
    arabicHarekeli:
      'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ ۝ قُلْ أَعُوذُ بِرَبِّ ٱلنَّاسِ ۝ مَلِكِ ٱلنَّاسِ ۝ إِلَـٰهِ ٱلنَّاسِ ۝ مِن شَرِّ ٱلْوَسْوَاسِ ٱلْخَنَّاسِ ۝ ٱلَّذِى يُوَسْوِسُ فِى صُدُورِ ٱلنَّاسِ ۝ مِنَ ٱلْجِنَّةِ وَٱلنَّاسِ',
    turkishMeaning:
      'Nâs Sûresi’nin meali: Rahmân ve Rahîm olan Allah’ın adıyla. De ki: Cinlerden ve insanlardan; insanların kalplerine vesvese veren sinsi vesvesecinin kötülüğünden, insanların Rabbine, insanların Melik’ine, insanların İlâh’ına sığınırım.',
    personalPrayerTemplate:
      "Nâs Sûresi’nin hürmetine Rabbimiz; {isim} kardeşimizin, anne ve babasının, sevdiklerinin ve bütün akrabalarının gönüllerine huzur ve ferahlık nasip eyle; her türlü manevi darlıktan, vesveseden ve üzüntüden muhafaza buyur. Âmin.",
    audioUrl: '/audio/duas/nas_114_aaqib_azeez_cc0.mp3',
    audioLicense: 'CC0 1.0 Public Domain Dedication',
    audioAttribution:
      "Qari Aaqib Azeez (Wikimedia Commons, File:Chapter_114,_Al-Nas_(Murattal)_-_Recitation_of_the_Holy_Qur'an.mp3)",
    audioSha256: '176441a835915036e7b517f723d49d2954a86cfd8bfd12d6172c77edcc85405e',
    audioStatus: 'verified_ready',
    isActive: true,
    updatedAt: nowIso(),
  },
  {
    id: 'high-dua-kevser',
    title: 'Kevser Sûresi (108:1–3)',
    sourceCitation:
      'Kur’ân-ı Kerîm, Kevser Sûresi 108:1–3 · Metin: Quran.com / Tanzil Uthmani · Meal: Diyanet İşleri Başkanlığı · Ses: Qari Aaqib Azeez (Wikimedia Commons, CC0 1.0)',
    arabicHarekeli:
      'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ ۝ إِنَّآ أَعْطَيْنَـٰكَ ٱلْكَوْثَرَ ۝ فَصَلِّ لِرَبِّكَ وَٱنْحَرْ ۝ إِنَّ شَانِئَكَ هُوَ ٱلْأَبْتَرُ',
    turkishMeaning:
      'Kevser Sûresi’nin meali: Rahmân ve Rahîm olan Allah’ın adıyla. Şüphesiz Biz sana Kevser’i verdik. O hâlde Rabbin için namaz kıl ve kurban kes. Doğrusu sana kin besleyen kimsenin soyu kesiktir.',
    personalPrayerTemplate:
      "Kevser Sûresi’nin bereketiyle Yüce Allah'ım; {isim} kardeşimizin, muhterem anne ve babasının, ailesinin ve bütün akrabalarının rızıklarına bolluk, sofralarına bereket, ömürlerine hayır ve şükür dolu güzel günler ihsan eyle. Ahirette Kevser havuzundan içmeyi nasip eyle. Âmin.",
    audioUrl: '/audio/duas/kevser_108_aaqib_azeez_cc0.mp3',
    audioLicense: 'CC0 1.0 Public Domain Dedication',
    audioAttribution:
      "Qari Aaqib Azeez (Wikimedia Commons, File:Chapter_108,_Al-Kawthar_(Murattal)_-_Recitation_of_the_Holy_Qur'an.mp3)",
    audioSha256: 'b973e5a7e4c582c95436187d99ea5bf315ef5c820a6d3114b81ab145519a86bb',
    audioStatus: 'verified_ready',
    isActive: true,
    updatedAt: nowIso(),
  },
  {
    id: 'high-dua-salati-tefriciye',
    title: 'Salât-ı Tefriciye (Geleneksel Arapça Salavât ve Dua)',
    sourceCitation:
      'Geleneksel İslâm Dua ve Salavât Geleneği (Kur’ân-ı Kerîm ayeti değildir · Salât-ı Nâriye rivayeti) · Ses: Lisanslı Okuyucu Kaydı Bekleniyor',
    arabicHarekeli:
      'أَللّٰهُمَّ صَلِّ صَلَاةً كَامِلَةً وَسَلِّمْ سَلَامًا تَامًّا عَلَىٰ سَيِّدِنَا مُحَمَّدٍ ٱلَّذِي تَنْحَلُّ بِهِ ٱلْعُقَدُ وَتَنْفَرِجُ بِهِ ٱلْكُرَبُ وَتُقْضَىٰ بِهِ ٱلْحَوَائِجُ وَتُنَالُ بِهِ ٱلرَّغَائِبُ وَحُسْنُ ٱلْخَوَاتِمِ وَيُسْتَسْقَى ٱلْغَمَامُ بِوَجْهِهِ ٱلْكَرِيمِ وَعَلَىٰ آلِهِ وَصَحْبِهِ فِي كُلِّ لَمْحَةٍ وَنَفَسٍ بِعَدَدِ كُلِّ مَعْلُومٍ لَكَ',
    turkishMeaning:
      'Salât-ı Tefriciye (Kur’ân-ı Kerîm ayeti değildir; geleneksel Arapça salavât ve duadır): Allah’ım! Kendisi hürmetine düğümlerin çözüldüğü, sıkıntıların feraha erdiği, ihtiyaçların giderildiği, hayırlı arzulara ve güzel akıbete ulaşıldığı, kerîm yüzü hürmetine yağmurların indirildiği Efendimiz Muhammed’e, âline ve ashâbına her göz açıp kapamada ve her nefeste, Senin bildiğin bütün varlıklar adedince kâmil bir salât ve tam bir selâm eyle.',
    personalPrayerTemplate:
      "Bu mübarek salavât-ı şerîfe hürmetine Allah'ım; {isim} kardeşimizin, anne ve babasının, ailesinin ve bütün akrabalarının gönüllerindeki hayırlı muratları ihsan eyle; sıkıntılarını feraha, dertlerini şifaya, işlerini kolaylığa tebdil eyle. Geçmişlerine rahmet eyle. Âmin.",
    audioUrl: '',
    audioLicense: 'Doğrulanmamış / Lisanslı Okuyucu Kaydı Bekleniyor',
    audioAttribution:
      'Geçici Olarak Hazır Değil — Doğrulanmış ses kaydı eklendiğinde aktif olur (Kur’ân ayeti değil, geleneksel salavâttır).',
    audioStatus: 'pending_license_verification',
    isActive: true,
    updatedAt: nowIso(),
  },
];

export const LEGACY_SCHOLAR_CAP_COLORS = ['#1E3A8A', '#1D4ED8'] as const;

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

export const LEGACY_DEFAULT_TIER_THRESHOLDS = {
  smallGiftMinCoins: 1,
  smallGiftMaxCoins: 49,
  midGiftMinCoins: 50,
  midGiftMaxCoins: 149,
  highGiftMinCoins: 150,
  highGiftMaxCoins: 299,
  yasinMinCoins: 300,
} as const;

export const DEFAULT_TIER_RULES: TierRuleConfig = {
  smallGiftMinCoins: 1,
  smallGiftMaxCoins: 10,
  midGiftMinCoins: 11,
  midGiftMaxCoins: 35,
  highGiftMinCoins: 36,
  highGiftMaxCoins: 199,
  yasinMinCoins: 200,
  coinEvaluationMode: 'event_total',
  followerEnabled: true,
  smallGiftEnabled: true,
  midGiftEnabled: true,
  highGiftEnabled: true,
  yasinEnabled: true,
  followerGreetingTemplate: 'Selâmün aleyküm, {isim}! NUR-I DUA ailemize hoş geldin.',
  smallGiftGreetingTemplate: 'Selâmün aleyküm, {isim}!',
};

export const DEFAULT_YASIN_RECITATION: YasinRecitationConfig = {
  id: 'yasin-300-default',
  title: 'Yâsîn-i Şerîf okunuyor',
  sourceCitation:
    "Kur’ân-ı Kerîm · Yâsîn Sûresi (36:1–83 · 83 Ayet) · Kârî: Abdullah Awad Al-Juhani (11:54, 128 kbps · Kaynak: QuranCentral / Islamic Network CDN)",
  arabicHarekeliHeader:
    'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ ۝ يٓسٓ ۝ وَٱلْقُرْءَانِ ٱلْحَكِيمِ ۝ إِنَّكَ لَمِنَ ٱلْمُرْسَلِينَ ۝ عَلَىٰ صِرَٰطٍ مُّسْتَقِيمٍ',
  turkishMealNotice: '',
  introSpeechTemplate:
    'Bismillâhirrahmânirrahîm. Aziz ve muhterem kardeşlerimiz, kıymetli izleyicilerimiz; {isim} kardeşimizin güzel niyetleri ve hayır temennileri vesilesiyle Kur’ân-ı Kerîm’in kalbi olan Yâsîn-i Şerîf Sûresi’ni baştan sona tilavet ediyoruz. Eûzü billâhimineşşeytânirracîm, Bismillâhirrahmânirrahîm.',
  closingPrayerTemplate:
    'Sadakallâhülazîm. Okunan bu mübarek Yâsîn-i Şerîf’ten hâsıl olan sevabı evvelâ Sevgili Peygamberimiz Hazreti Muhammed Mustafa sallallâhu aleyhi ve sellem Efendimizin mübarek ruh-i şerîflerine hediye eyledik, vasıl eyle Allah’ım. Kıymetli {isim} kardeşimize bu güzel ikramı ve hayır niyeti için gönülden teşekkür ediyoruz. Yüce Rabbim; {isim} kardeşimizin, muhterem anne ve babasının, aile fertlerinin, evlatlarının ve bütün akrabalarının dünya ve ahiret saadetini daim eyle; sağlık, afiyet, helal rızık ve hanelerine huzur ve bereket ihsan eyle. Bilhassa {isim} kardeşimizin ve cümlemizin ahirete irtihal etmiş anne, baba, dede, nine ve bütün vefat etmiş yakınlarının ruhlarını şad eyle, kabirlerini pür-nur eyle, taksiratlarını affeyle ve cennetinle, cemalinle müşerref eyle. Âmin, ve selâmün alel-mürselîn, velhamdülâhi rabbil-âlemîn.',
  audioUrl: '/audio/duas/yasin_i_serif_verified.mp3',
  audioSourceUrl:
    'https://qurancentral.net/surah/ya-sin/ · https://cdn.islamic.network/quran/audio-surah/128/ar.abdullahawadaljuhani/36.mp3',
  audioLicense:
    'Kullanıcı tarafından QuranCentral kullanım izni alındığı teyit edildi (uygulama içine gömme, ticari kullanım, çoğaltma ve dağıtma hakları); izin belgesinin kendisi proje deposunda mevcut değildir.',
  audioAttribution:
    'Kârî: Abdullah Awad Al-Juhani — Surah Ya-Sin (36:1–83 · 83 Ayet, 11:54, 128 kbps, Mono) · Kaynak: QuranCentral / Islamic Network CDN',
  audioSha256: '3cd37c1e1ec60be3b46802ed8aef4c042cd5aa85373e20f2936813161d2bb7b9',
  expectedFileBytes: 12109585,
  durationSec: 714.024,
  durationLabel: '11:54',
  audioStatus: 'verified_ready',
  acceptedFormats: ['.mp3', '.m4a', '.ogg', '.wav'],
  missingAudioInstruction:
    'Abdullah Awad Al-Juhani Yâsîn MP3 dosyası (/audio/duas/yasin_i_serif_verified.mp3) SHA-256 doğrulaması ile birlikte beklenmektedir (3cd37c1e1ec60be3b46802ed8aef4c042cd5aa85373e20f2936813161d2bb7b9). Dosya eksik veya bozuksa yeniden paketleyin.',
  updatedAt: nowIso(),
};

export const createDefaultAppState = (): AppState => ({
  prayers: DEFAULT_PRAYERS,
  gifts: DEFAULT_GIFTS,
  tierRules: { ...DEFAULT_TIER_RULES },
  highTierDuas: DEFAULT_HIGH_TIER_DUAS.map((d) => ({ ...d })),
  yasinRecitation: { ...DEFAULT_YASIN_RECITATION },
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
        capColor: '#FFFFFF',
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
        capColor: '#FFFFFF',
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
    scholar1Engine: 'seslen_hasan',
    emaLightningRate: 1.0,
    emaLightningFallbackToHasan: true,
    emaLightningApproved: false,
    zerreSesARate: 0.94,
    zerreSesAFallbackToHasan: true,
    zerreSesAApproved: false,
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
    followerCount: null,
    lastEvent: null,
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
    realFollowers: 0,
    simulatedFollowers: 0,
  },
  lastUpdatedAt: nowIso(),
});

const LEGACY_SCHOLAR_CAP_SET = new Set(
  LEGACY_SCHOLAR_CAP_COLORS.map((c) => c.toUpperCase())
);

export function migrateScholarCapColor(capColor?: string): string {
  const normalized = String(capColor || '').trim().toUpperCase();
  if (!normalized || LEGACY_SCHOLAR_CAP_SET.has(normalized)) {
    return '#FFFFFF';
  }
  return String(capColor).trim();
}

export function mergeScholarSettingsWithPureWhiteCaps(
  savedScholars?: Partial<ScholarSettingsConfig> | null,
  defaultScholars: ScholarSettingsConfig = createDefaultAppState().scholars
): ScholarSettingsConfig {
  const s1 = {
    ...defaultScholars.profiles.scholar_1,
    ...(savedScholars?.profiles?.scholar_1 || {}),
  };
  const s2 = {
    ...defaultScholars.profiles.scholar_2,
    ...(savedScholars?.profiles?.scholar_2 || {}),
  };
  return {
    ...defaultScholars,
    ...(savedScholars || {}),
    profiles: {
      scholar_1: { ...s1, capColor: migrateScholarCapColor(s1.capColor) },
      scholar_2: { ...s2, capColor: migrateScholarCapColor(s2.capColor) },
    },
  };
}

export function mergeBuiltInHighTierDuas(
  savedHighTier?: HighTierDuaEntry[] | null,
  builtInHighTier: HighTierDuaEntry[] = DEFAULT_HIGH_TIER_DUAS
): HighTierDuaEntry[] {
  const base =
    Array.isArray(savedHighTier) && savedHighTier.length > 0
      ? savedHighTier.filter((entry) => Boolean(entry && entry.id))
      : [];
  if (base.length === 0) {
    return builtInHighTier.map((d) => ({ ...d }));
  }
  const builtInById = new Map(builtInHighTier.map((d) => [d.id, d]));
  const upgradedBase = base.map((entry) => {
    const builtIn = builtInById.get(entry.id);
    if (
      builtIn &&
      builtIn.audioStatus === 'verified_ready' &&
      entry.audioStatus === 'pending_license_verification' &&
      !String(entry.audioUrl || '').trim()
    ) {
      return {
        ...entry,
        sourceCitation: builtIn.sourceCitation,
        audioUrl: builtIn.audioUrl,
        audioLicense: builtIn.audioLicense,
        audioAttribution: builtIn.audioAttribution,
        audioSha256: builtIn.audioSha256,
        audioStatus: builtIn.audioStatus,
      };
    }
    return entry;
  });
  const existingIds = new Set(upgradedBase.map((d) => d.id));
  const missingBuiltIns = builtInHighTier
    .filter((d) => !existingIds.has(d.id))
    .map((d) => ({ ...d }));
  return [...upgradedBase, ...missingBuiltIns];
}
