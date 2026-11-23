import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  createDefaultAppState,
  DEFAULT_HIGH_TIER_DUAS,
  DEFAULT_MID_OPENING_PRAYERS,
  DEFAULT_PRAYERS,
  DEFAULT_YASIN_RECITATION,
} from '../src/data/defaults.ts';
import {
  cleanNotificationUsername,
  formatBroadcastPrayerNotification,
  getActiveTopTierId,
  TOP_TIER_BAR_GRID_COLUMNS,
  TOP_TIER_BAR_ITEMS,
} from '../src/services/broadcastDisplay.ts';
import {
  buildHighTierTurkishSpeech,
  buildYasinClosingSpeech,
  buildYasinIntroSpeech,
} from '../src/services/stage2Flow.ts';

function makeEvent(overrides = {}) {
  return {
    id: overrides.id || 'evt_test_1',
    eventType: overrides.eventType || 'gift',
    source: 'simulation',
    priority: 'normal',
    tier: overrides.tier || 'mid_gift',
    scholarId: 'scholar_1',
    username: overrides.username ?? 'ahmet_yilmaz',
    displayUsername: overrides.displayUsername ?? '@Ahmet Yılmaz',
    giftId: 'gift_1',
    giftName: 'Gül',
    quantity: 1,
    unitCoins: 50,
    eventCoins: 50,
    category: 'mid_opening',
    prayerId: 'prayer-mid-01',
    prayerTitle: overrides.prayerTitle ?? 'Başlangıç Şükür ve Bereket Duası',
    renderedPrayer: "Allah'ım kardeşimize bereket ihsan eyle. Âmin.",
    arabicHarekeli: overrides.arabicHarekeli,
    turkishMeaning: overrides.turkishMeaning,
    status: 'speaking',
    attempts: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test('1. Top horizontal coin-tier bar defines exact 4 boxes in order with 3rd box widest & JETON unitLabel', () => {
  assert.equal(TOP_TIER_BAR_ITEMS.length, 4);
  assert.deepEqual(
    TOP_TIER_BAR_ITEMS.map((item) => ({
      range: item.range,
      unitLabel: item.unitLabel,
      label: item.label,
    })),
    [
      { range: '1–10', unitLabel: 'JETON', label: 'Selamlama' },
      { range: '11–35', unitLabel: 'JETON', label: 'Açılış duası' },
      { range: '36–60 · 61–199', unitLabel: 'JETON', label: 'Kapsamlı dua' },
      { range: '200+', unitLabel: 'JETON', label: 'Yâsîn' },
    ]
  );

  // 3rd box (36–60 · 61–199 Kapsamlı dua) MUST be strictly wider than boxes 1, 2, 4
  assert.equal(TOP_TIER_BAR_GRID_COLUMNS, '0.85fr 1fr 1.5fr 0.85fr');
  assert.ok(TOP_TIER_BAR_ITEMS[2].weight > TOP_TIER_BAR_ITEMS[0].weight);
  assert.ok(TOP_TIER_BAR_ITEMS[2].weight > TOP_TIER_BAR_ITEMS[1].weight);
  assert.ok(TOP_TIER_BAR_ITEMS[2].weight > TOP_TIER_BAR_ITEMS[3].weight);
  assert.equal(TOP_TIER_BAR_ITEMS[2].nowrapRange, true);

  const broadcastSrc = fs.readFileSync(path.resolve('src/components/BroadcastView.tsx'), 'utf8');
  assert.ok(broadcastSrc.includes('TOP_TIER_BAR_GRID_COLUMNS'));
  assert.ok(broadcastSrc.includes('buildTopTierBarItems'));
  assert.ok(broadcastSrc.includes('item.unitLabel'));
  assert.ok(broadcastSrc.includes('whitespace-nowrap'));
  assert.ok(broadcastSrc.includes('aspect-[9/16]'));
});

test('2. BroadcastView NEVER displays Arabic text, Arabic transliteration, Turkish meal, or long Yâsîn speeches', () => {
  const broadcastSrc = fs.readFileSync(path.resolve('src/components/BroadcastView.tsx'), 'utf8');
  assert.equal(broadcastSrc.includes('arabicHarekeli'), false);
  assert.equal(broadcastSrc.includes('turkishMeaning'), false);
  assert.equal(broadcastSrc.includes('Meal:'), false);
  assert.equal(broadcastSrc.includes('sourceCitation'), false);
  assert.equal(broadcastSrc.includes('yasinIntroSpeech'), false);
  assert.equal(broadcastSrc.includes('renderedPrayer'), false);
  assert.equal(broadcastSrc.includes('showSenderCard'), false);
  assert.equal(broadcastSrc.includes('lang="ar"'), false);
  assert.equal(broadcastSrc.includes('dir="rtl"'), false);
});

test('3. 1–10 coins and follow events NEVER display a prayer notification on broadcast screen', () => {
  const smallGift = makeEvent({
    tier: 'small_gift',
    unitCoins: 10,
    eventCoins: 10,
    prayerTitle: 'Küçük Hediye Selamlaması',
  });
  const followEv = makeEvent({
    eventType: 'follow',
    tier: 'follower',
    prayerTitle: 'Takipçi Selamlaması',
  });

  assert.equal(formatBroadcastPrayerNotification(smallGift, true), null);
  assert.equal(formatBroadcastPrayerNotification(followEv, true), null);
  // Highlighting on top bar still subtly marks small_gift while actively speaking
  assert.equal(getActiveTopTierId(smallGift, true), 'small_gift');
  assert.equal(getActiveTopTierId(smallGift, false), null);
});

test('4. 11–35 coins displays "{Kullanıcı Adı} isimli kardeşimizin {Dua Adı} duası okunuyor." ONLY when started', () => {
  const midEv = makeEvent({
    tier: 'mid_gift',
    username: 'mehmet_can',
    displayUsername: '@Mehmet Can',
    prayerTitle: 'Başlangıç Rahmet ve Kolaylık Duası',
  });

  // Before playback starts (queued/synthesizing) -> strictly hidden
  assert.equal(formatBroadcastPrayerNotification(midEv, false), null);

  // Actively started -> exact format using the actual playing prayer title
  assert.equal(
    formatBroadcastPrayerNotification(midEv, true),
    'Mehmet Can isimli kardeşimizin Başlangıç Rahmet ve Kolaylık Duası duası okunuyor.'
  );
  assert.equal(getActiveTopTierId(midEv, true), 'mid_gift');

  // After playback ends -> strictly hidden
  assert.equal(formatBroadcastPrayerNotification(null, false), null);
});

test('5. 36–199 coins displays selected comprehensive dua title WITHOUT Arabic or Turkish meal', () => {
  const highDua = DEFAULT_HIGH_TIER_DUAS[0];
  const highEv = makeEvent({
    tier: 'high_gift',
    username: 'zeynep_nur',
    displayUsername: '@Zeynep Nur',
    prayerTitle: highDua.title,
    arabicHarekeli: highDua.arabicHarekeli,
    turkishMeaning: highDua.turkishMeaning,
    renderedPrayer: buildHighTierTurkishSpeech(highDua, 'Zeynep Nur'),
  });

  assert.equal(formatBroadcastPrayerNotification(highEv, false), null);
  const text = formatBroadcastPrayerNotification(highEv, true);
  assert.equal(
    text,
    `Zeynep Nur isimli kardeşimizin ${highDua.title} duası okunuyor.`
  );
  assert.equal(text.includes(highDua.arabicHarekeli), false);
  assert.equal(text.includes(highDua.turkishMeaning), false);
  assert.equal(text.toLowerCase().includes('meal'), false);
  assert.equal(getActiveTopTierId(highEv, true), 'high_gift');
});

test('6. 200+ coins (Yâsîn) shows strictly "Yâsîn-i Şerîf okunuyor" without username, Arabic, meal, or takdim/closing', () => {
  const yasinEv = makeEvent({
    tier: 'yasin_300',
    username: 'mustafa_oz',
    displayUsername: '@Mustafa Öz',
    prayerTitle: DEFAULT_YASIN_RECITATION.title,
    arabicHarekeli: DEFAULT_YASIN_RECITATION.arabicHarekeliHeader,
    yasinIntroSpeech: buildYasinIntroSpeech(DEFAULT_YASIN_RECITATION, 'Mustafa Öz'),
    renderedPrayer: buildYasinClosingSpeech(DEFAULT_YASIN_RECITATION, 'Mustafa Öz'),
  });

  // Hidden before audio actually starts
  assert.equal(formatBroadcastPrayerNotification(yasinEv, false), null);

  // Strictly ONLY "Yâsîn-i Şerîf okunuyor" across all started Yâsîn phases
  const text = formatBroadcastPrayerNotification(yasinEv, true);
  assert.equal(text, 'Yâsîn-i Şerîf okunuyor');
  assert.equal(text.toLowerCase().includes('mustafa'), false);
  assert.equal(text.includes(DEFAULT_YASIN_RECITATION.arabicHarekeliHeader), false);
  assert.equal(text.includes('Sadakallâhülazîm'), false);
  assert.equal(getActiveTopTierId(yasinEv, true), 'yasin_300');
});

test('7. Long and special TikTok usernames are safely sanitized and truncated', () => {
  const longName = '@CokUzunVeOzelKarakterli_KullaniciAdi_1234567890<script>';
  const cleaned = cleanNotificationUsername(longName);
  assert.ok(!cleaned.startsWith('@'));
  assert.ok(!cleaned.includes('<'));
  assert.ok(cleaned.length <= 24);
  assert.ok(cleaned.endsWith('…'));
  assert.equal(cleanNotificationUsername('', ''), 'Kardeşimiz');
});

test('8. No food/meal ("yemek duası" / "yemek meali") exists anywhere in defaults or broadcast helpers', () => {
  const allStrings = [
    ...DEFAULT_MID_OPENING_PRAYERS.map((p) => `${p.title} ${p.template}`),
    ...DEFAULT_PRAYERS.map((p) => `${p.title} ${p.template}`),
    ...DEFAULT_HIGH_TIER_DUAS.map((d) => `${d.title} ${d.personalPrayerTemplate} ${d.turkishMeaning}`),
    DEFAULT_YASIN_RECITATION.title,
    DEFAULT_YASIN_RECITATION.introSpeechTemplate,
    DEFAULT_YASIN_RECITATION.closingPrayerTemplate,
    DEFAULT_YASIN_RECITATION.turkishMealNotice,
  ]
    .join('\n')
    .toLowerCase();

  assert.equal(allStrings.includes('yemek duası'), false);
  assert.equal(allStrings.includes('yemek meali'), false);
  assert.equal(allStrings.includes('yemek'), false);
});

test('9. StudioContext, syncClient, and server wire playbackStarted strictly to onStart/onComplete/onError', () => {
  const ctxSrc = fs.readFileSync(path.resolve('src/context/StudioContext.tsx'), 'utf8');
  const syncSrc = fs.readFileSync(path.resolve('src/services/syncClient.ts'), 'utf8');
  const serverSrc = fs.readFileSync(path.resolve('server.ts'), 'utf8');

  assert.ok(ctxSrc.includes('playbackStartedRef.current = true'));
  assert.ok(ctxSrc.includes('playbackStartedRef.current = false'));
  assert.ok(syncSrc.includes('playbackStarted?: boolean'));
  assert.ok(serverSrc.includes('playbackStarted: Boolean(body.playbackStarted)'));
});

test('10. Native Android audio plugins enforce AudioTrack STATE_INITIALIZED, write error propagation, AudioFocus, and early-completion protection', () => {
  const seslenJava = fs.readFileSync(
    path.resolve('android/app/src/main/java/com/nur/idua/SeslenLocalTtsPlugin.java'),
    'utf8'
  );
  const emaJava = fs.readFileSync(
    path.resolve('android/app/src/main/java/com/nur/idua/EmaLightningTtsPlugin.java'),
    'utf8'
  );
  const audioJava = fs.readFileSync(
    path.resolve('android/app/src/main/java/com/nur/idua/NurIDuaAudioPlugin.java'),
    'utf8'
  );

  // Seslen AudioTrack & AudioFocus checks
  assert.ok(seslenJava.includes('AudioTrack.STATE_INITIALIZED'));
  assert.ok(seslenJava.includes('requestSpeechAudioFocus()'));
  assert.ok(seslenJava.includes('abandonSpeechAudioFocus()'));
  assert.ok(seslenJava.includes('Seslen AudioTrack write hatası'));

  // EMA AudioTrack & AudioFocus checks
  assert.ok(emaJava.includes('AudioTrack.STATE_INITIALIZED'));
  assert.ok(emaJava.includes('requestSpeechAudioFocus()'));
  assert.ok(emaJava.includes('abandonSpeechAudioFocus()'));
  assert.ok(emaJava.includes('EMA AudioTrack write hatası'));

  // NurIDuaAudioPlugin premature completion duration guard
  assert.ok(audioJava.includes('dur >= 30000 && pos < Math.round(dur * 0.80f)'));
});

test('11. Existing Hasan default, EMA opt-in flag, and verified Yâsîn SHA-256 asset remain preserved', () => {
  const defaults = createDefaultAppState();
  assert.equal(defaults.voice.scholar1Engine, 'seslen_hasan');
  assert.equal(defaults.voice.emaLightningApproved, false);
  assert.equal(
    DEFAULT_YASIN_RECITATION.audioSha256,
    '3cd37c1e1ec60be3b46802ed8aef4c042cd5aa85373e20f2936813161d2bb7b9'
  );
  assert.ok(fs.existsSync(path.resolve('public/audio/duas/yasin_i_serif_verified.mp3')));
  assert.ok(
    fs.existsSync(path.resolve('android/app/src/main/assets/public/audio/duas/yasin_i_serif_verified.mp3'))
  );
});
