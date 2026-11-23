/**
 * Pure TypeScript reference frontend, manifest, frame planner & Redmi Note 10T 5G benchmark presets
 * matching `ozcancelik/ema-lightning-onnx` (`canberk7/ema-lightning`, 8.6M params, 48 kHz mono, Apache-2.0).
 *
 * Strictly zero PyTorch/network runtime dependencies; mirrors `EmaLightningTtsPlugin.java` bit-for-bit.
 */

export interface EmaModelFileManifestEntry {
  fileName: string;
  downloadUrl: string;
  expectedBytes: number;
  expectedSha256: string;
}

export const EMA_LIGHTNING_MODEL_METADATA = {
  id: 'ema_lightning',
  name: 'EMA Lightning',
  parameterCount: '8.6M',
  language: 'tr',
  sampleRate: 48000,
  channels: 1,
  license: 'Apache-2.0',
  upstreamRepo: 'https://github.com/canberk7/ema-lightning',
  onnxRepo: 'https://huggingface.co/ozcancelik/ema-lightning-onnx',
  totalBytes: 34959357,
  latentDim: 64,
  hopSamples: 1920,
  times: [0.0, 0.25, 0.5, 0.75] as const,
} as const;

export const EMA_MODEL_FILES: readonly EmaModelFileManifestEntry[] = [
  {
    fileName: 'meta.json',
    downloadUrl: 'https://huggingface.co/ozcancelik/ema-lightning-onnx/resolve/main/meta.json',
    expectedBytes: 357,
    expectedSha256: '76627201405723633f5319a208ed7dea63c42acbf3ca997671bccdca9d9186b2',
  },
  {
    fileName: 'text.onnx',
    downloadUrl: 'https://huggingface.co/ozcancelik/ema-lightning-onnx/resolve/main/text.onnx',
    expectedBytes: 4806400,
    expectedSha256: 'ad5d4885b5d218f63d976a6e562334ea0194aec54847a6c6482d328e784089f0',
  },
  {
    fileName: 'sound.onnx',
    downloadUrl: 'https://huggingface.co/ozcancelik/ema-lightning-onnx/resolve/main/sound.onnx',
    expectedBytes: 18120655,
    expectedSha256: '958364217360cecaa92dc5ff2170d19f3c9f6995fd5e61241ea4068971a46a59',
  },
  {
    fileName: 'decoder.onnx',
    downloadUrl: 'https://huggingface.co/ozcancelik/ema-lightning-onnx/resolve/main/decoder.onnx',
    expectedBytes: 12031945,
    expectedSha256: '396c06a8e5711fd40bfd2c3f4f33851feb2ad07a86485833844e0ae8ff637b17',
  },
];

export const EMA_META_VOCAB: readonly string[] = [
  '<pad>', '<unk>', ' ', '!', '"', '%', '&', "'", '(', ')', ',', '-', '.', '/', ':', ';', '?',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's',
  't', 'u', 'v', 'w', 'x', 'y', 'z', 'ç', 'ö', 'ü', 'ğ', 'ı', 'ş',
];

const VOCAB_INDEX = new Map<string, number>(EMA_META_VOCAB.map((tok, i) => [tok, i]));
const ALPHA_CHARS = new Set<string>(EMA_META_VOCAB.filter((tok) => tok.length === 1));
const TURKISH_LOWER_SPECIAL = new Set<string>(['ç', 'ğ', 'ı', 'ö', 'ş', 'ü']);

const TYPOGRAPHY_MAP: Record<string, string> = {
  '’': "'",
  '‘': "'",
  'ʼ': "'",
  '´': "'",
  '`': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '«': '"',
  '»': '"',
  '–': '-',
  '—': '-',
  '−': '-',
  '…': '...',
};

const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
const SCALES = ['', 'bin', 'milyon', 'milyar', 'trilyon'];

function hundredsToTurkish(n: number): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  const parts: string[] = [];
  if (h > 0) parts.push(h === 1 ? 'yüz' : `${ONES[h]} yüz`);
  if (t > 0) parts.push(TENS[t]);
  if (o > 0) parts.push(ONES[o]);
  return parts.join(' ');
}

export function integerToTurkishWords(rawDigits: string): string {
  const digits = rawDigits.replace(/^0+/, '') || '0';
  if (digits === '0') return 'sıfır';
  if (rawDigits.length > 1 && rawDigits.startsWith('0')) {
    // Codes like 00042 -> digit by digit
    return [...rawDigits].map((d) => (d === '0' ? 'sıfır' : ONES[Number(d)])).join(' ');
  }
  const num = Number(digits);
  if (!Number.isSafeInteger(num) || digits.length > 15) {
    return [...rawDigits].map((d) => (d === '0' ? 'sıfır' : ONES[Number(d)] || d)).join(' ');
  }
  const groups: number[] = [];
  let rem = num;
  while (rem > 0) {
    groups.push(rem % 1000);
    rem = Math.floor(rem / 1000);
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g === 0) continue;
    if (i === 1 && g === 1) {
      parts.push('bin');
    } else {
      const words = hundredsToTurkish(g);
      parts.push(SCALES[i] ? `${words} ${SCALES[i]}` : words);
    }
  }
  return parts.join(' ');
}

function turkishOrdinalSuffix(word: string): string {
  const trimmed = word.trim();
  const lastVowelMatch = [...trimmed].reverse().find((c) => 'aeıioöuü'.includes(c));
  const endsWithVowel = 'aeıioöuü'.includes(trimmed.slice(-1));
  if (trimmed.endsWith('dört')) {
    return trimmed.slice(0, -1) + 'üncü';
  }
  if (!lastVowelMatch) return `${trimmed}'ıncı`;
  let suffix: string;
  if ('aı'.includes(lastVowelMatch)) suffix = endsWithVowel ? 'ncı' : 'ıncı';
  else if ('ei'.includes(lastVowelMatch)) suffix = endsWithVowel ? 'nci' : 'inci';
  else if ('ou'.includes(lastVowelMatch)) suffix = endsWithVowel ? 'ncu' : 'uncu';
  else suffix = endsWithVowel ? 'ncü' : 'üncü';
  return `${trimmed}${suffix}`;
}

/**
 * Pure Turkish spoken-form normalization + alphabet filtering matching `ozcancelik/ema-lightning-onnx` frontend.
 */
export function normalizeTurkishForEma(rawText: string): string {
  if (!rawText || !rawText.trim()) return '';
  let text = rawText
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/[’‘ʼ´`“”„«»–—−…]/g, (ch) => TYPOGRAPHY_MAP[ch] ?? ch)
    .replace(/@/g, '')
    .replace(/[_/\\]+/g, ' ');

  // Abbreviations & units
  text = text
    .replace(/\bDr\./gi, 'Doktor')
    .replace(/\bProf\./gi, 'Profesör')
    .replace(/\bHz\./gi, 'Hazreti')
    .replace(/\bSt\./gi, 'Saat')
    .replace(/(\d+)\s*kg\b/gi, '$1 kilogram')
    .replace(/(\d+)\s*km\b/gi, '$1 kilometre')
    .replace(/(\d+)\s*dk\b/gi, '$1 dakika')
    .replace(/(\d+)\s*sn\b/gi, '$1 saniye')
    .replace(/₺\s*(\d+(?:,\d+)?)/g, '$1 Türk lirası')
    .replace(/(\d+(?:,\d+)?)\s*TL\b/g, '$1 Türk lirası');

  // Times like 14:30
  text = text.replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, hh: string, mm: string) => {
    const hWord = integerToTurkishWords(String(Number(hh)));
    const mNum = Number(mm);
    if (mNum === 0) return `${hWord} sıfır sıfır`;
    if (mm.startsWith('0')) return `${hWord} sıfır ${integerToTurkishWords(String(mNum))}`;
    return `${hWord} ${integerToTurkishWords(mm)}`;
  });

  // Percentages like %15 or % 15
  text = text.replace(/%\s*(\d+(?:[,.]\d+)?)/g, (_m, val: string) => `yüzde ${val}`);

  // Decimals like 12,5
  text = text.replace(/\b(\d+),(\d+)\b/g, (_m, a: string, b: string) => {
    return `${integerToTurkishWords(a)} virgül ${integerToTurkishWords(b)}`;
  });

  // Ordinals like 36. sure
  text = text.replace(/\b(\d+)\.(?=\s+[A-Za-zÇĞİÖŞÜçğıöşü])/g, (_m, numStr: string) => {
    return turkishOrdinalSuffix(integerToTurkishWords(numStr));
  });

  // Standalone integers
  text = text.replace(/\b\d+\b/g, (numStr) => integerToTurkishWords(numStr));

  // Turkish lowercasing + NFKD combining accent strip (while preserving ç, ğ, ı, ö, ş, ü)
  const lowered = text.replace(/İ/g, 'i').replace(/I/g, 'ı').toLocaleLowerCase('tr-TR');
  let out = '';
  for (const rawCh of lowered) {
    let ch = rawCh;
    if (!TURKISH_LOWER_SPECIAL.has(ch)) {
      ch = ch.normalize('NFKD').replace(/\p{M}/gu, '');
    }
    if (ch && [...ch].every((c) => ALPHA_CHARS.has(c))) {
      out += ch;
    } else {
      out += ' ';
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

export interface EmaPiece {
  text: string;
  pauseSec: number;
}

const LETTERS_PER_SECOND = 18.0;
const MAX_SECONDS = 10.0;
const MAX_LETTERS = 250;
const SENTENCE_PAUSE = 0.25;
const CLAUSE_PAUSE = 0.12;
const CUT_PATTERNS: Array<[RegExp, number]> = [
  [/[.!?]+["')]*(?= )/g, SENTENCE_PAUSE],
  [/[,;:](?= )/g, CLAUSE_PAUSE],
  [/\S(?= )/g, CLAUSE_PAUSE],
];

function finishPiece(piece: string): string {
  const stripped = piece.replace(/["')]+$/, '');
  if (/[.!?]$/.test(stripped)) return piece;
  return piece.replace(/[,;:\- ]+$/, '') + '.';
}

export function chunkTextForEma(normalizedText: string, speed = 1.0): EmaPiece[] {
  const safeSpeed = Math.max(0.25, Math.min(4.0, speed));
  const limit = Math.floor(Math.min(MAX_LETTERS, LETTERS_PER_SECOND * MAX_SECONDS * safeSpeed));
  const pieces: EmaPiece[] = [];
  let rest = (normalizedText || '').trim();
  while (rest.length > 0) {
    let cut = rest.length;
    let pauseSec = 0;
    if (rest.length > limit) {
      cut = limit;
      const head = rest.slice(0, limit + 1);
      for (const [pattern, gap] of CUT_PATTERNS) {
        const matches = [...head.matchAll(pattern)];
        if (matches.length > 0) {
          const last = matches[matches.length - 1];
          cut = (last.index ?? 0) + last[0].length;
          pauseSec = gap;
          break;
        }
      }
    }
    const piece = rest.slice(0, cut).trim();
    rest = rest.slice(cut).trim();
    if (/\p{L}/u.test(piece)) {
      pieces.push({ text: finishPiece(piece), pauseSec });
    }
  }
  if (pieces.length > 0) {
    pieces[pieces.length - 1] = { ...pieces[pieces.length - 1], pauseSec: 0 };
  }
  return pieces;
}

export function encodeEmaVocabIds(pieceText: string): number[] {
  return [...pieceText].map((ch) => VOCAB_INDEX.get(ch) ?? 1);
}

export function computeEmaWords(pieceText: string): { cw: number[]; wstart: number[] } {
  const starts: number[] = [];
  for (let i = 0; i < pieceText.length; i++) {
    if (pieceText[i] !== ' ' && (i === 0 || pieceText[i - 1] === ' ')) {
      starts.push(i);
    }
  }
  if (starts.length === 0) starts.push(0);
  const bounds = [0, ...starts.slice(1), pieceText.length];
  const cw: number[] = [];
  const wstart: number[] = [];
  for (let w = 0; w + 1 < bounds.length; w++) {
    for (let i = bounds[w]; i < bounds[w + 1]; i++) {
      cw.push(w);
      wstart.push(bounds[w]);
    }
  }
  return { cw, wstart };
}

export function planEmaFrames(
  cw: number[],
  wstart: number[],
  dur: Float32Array | number[],
  speed = 1.0
): { T: number; fw: Int32Array; cg: Float32Array; fg: Float32Array } {
  const L = cw.length;
  const nWords = cw[L - 1] + 1;
  const safeSpeed = Math.max(0.25, Math.min(4.0, speed));
  const d = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    d[i] = (dur[i] ?? 0) / safeSpeed;
  }
  const sums = new Float64Array(nWords);
  for (let i = 0; i < L; i++) {
    sums[cw[i]] += d[i];
  }
  const counts = Array.from(sums, (s) => Math.min(250, Math.max(1, Math.round(s))));
  const T = Math.min(
    counts.reduce((acc, v) => acc + v, 0),
    3000
  );
  const fw = new Int32Array(T);
  const fp = new Float32Array(T);
  for (let w = 0, f = 0; w < nWords; w++) {
    for (let j = 0; j < counts[w] && f < T; j++, f++) {
      fw[f] = w;
      fp[f] = j / counts[w];
    }
  }
  const c = new Float32Array(L);
  const done = new Float32Array(L);
  const total = new Float32Array(nWords);
  for (let i = 0, acc = 0; i < L; i++) {
    c[i] = Math.max(d[i], 1e-4);
    acc += c[i];
    done[i] = acc;
    total[cw[i]] += c[i];
  }
  const wlen = new Float32Array(nWords);
  for (const w of cw) wlen[w] += 1;
  const woff = new Float32Array(nWords);
  for (let w = 1; w < nWords; w++) {
    woff[w] = woff[w - 1] + Math.max(wlen[w - 1], 1);
  }
  const cg = new Float32Array(L);
  const fg = new Float32Array(T);
  for (let i = 0; i < L; i++) {
    const beforeWStart = done[wstart[i]] - c[wstart[i]];
    const cp = Math.min(
      1,
      Math.max(0, (done[i] - beforeWStart - 0.5 * c[i]) / Math.max(total[cw[i]], 1e-8))
    );
    cg[i] = woff[cw[i]] + cp * Math.max(wlen[cw[i]], 1);
  }
  for (let f = 0; f < T; f++) {
    fg[f] = woff[fw[f]] + fp[f] * Math.max(wlen[fw[f]], 1);
  }
  return { T, fw, cg, fg };
}

export function computeEmaDecoderWindows(
  frames: number,
  firstWindow = 25,
  windowSize = 100
): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (let s = 0; s < frames; ) {
    const e = Math.min(frames, s + (s === 0 ? firstWindow : windowSize));
    spans.push([s, e]);
    s = e;
  }
  return spans;
}

export interface EmaBenchmarkPreset {
  id: 'short_greeting' | 'mid_prayer' | 'long_prayer' | 'long_speech' | 'closing_ithaf';
  label: string;
  targetDescription: string;
  text: string;
}

export const EMA_BENCHMARK_PRESETS: readonly EmaBenchmarkPreset[] = [
  {
    id: 'short_greeting',
    label: '1. Kısa Selamlama (1–10 jeton)',
    targetDescription: 'Kısa giriş / takipçi selamlaması',
    text: 'Selâmün aleyküm, Ahmet Yılmaz! NUR-I DUA ailemize hoş geldin. Allah razı olsun.',
  },
  {
    id: 'mid_prayer',
    label: '2. 2–3 Cümlelik Dua (11–35 jeton)',
    targetDescription: 'Orta uzunlukta kişiselleştirilmiş dua',
    text: 'Allah’ım, Fatma Nur kardeşimize sağlık, huzur, bereket ve hayırlı bir ömür nasip eyle. Gönlündeki bütün güzel muratlarını hayırlısıyla ihsan eyle, kendisini ve sevdiklerini her türlü kaza ve beladan muhafaza eyle. Âmin.',
  },
  {
    id: 'long_prayer',
    label: '3. 30–60 Saniyelik Uzun Dua',
    targetDescription: 'Çok cümleli şifa, rızık ve aile duası',
    text: 'Bismillâhirrahmânirrahîm. Ey yerlerin ve göklerin sahibi olan Yüce Rabbimiz! Bu mübarek saatte ellerimizi sana açtık; Mehmet Demir kardeşimize ve bütün izleyicilerimize beden sağlığı, gönül ferahlığı, helalinden bol rızık ve hanelerine huzur ihsan eyle. Hastalarımıza şifa, dertlilerimize deva, borçlularımıza eda nasip eyle. Evlatlarımızı salih ve saliha kullarından eyle, büyüklerimize hayırlı ve bereketli ömürler lütfeyle. Üzerimizden rahmetini, merhametini ve mağfiretini bir an bile eksik eyleme Allah’ım. Dualarımızı Peygamber Efendimiz hürmetine kabul eyle. Âmin.',
  },
  {
    id: 'long_speech',
    label: '4. 2–3 Dakikalık Uzun Konuşma Metni',
    targetDescription: 'Uzun akışta parça bazlı streaming ve bellek kararlılığı testi',
    text: 'Bismillâhirrahmânirrahîm. Aziz ve muhterem kardeşlerimiz, kıymetli gönül dostlarımız; yayınımıza hoş geldiniz, sefalar getirdiniz. Rabbimiz bizleri güzel niyetler, hayır dualar ve samimi muhabbet etrafında bir araya getirdi. İnsanoğlunun en kıymetli sermayesi, birbirine ettiği samimi duadır; zira kardeşin kardeşe gıyabında ettiği dua, kabul kapısına en yakın dualardandır. Bu vesileyle her birinizin niyetini, muradını, sıkıntısını ve şükrünü Yüce Mevlamızın sonsuz rahmetine arz ediyoruz. Kimin hanesinde bir hastalık varsa, Şâfî ismi şerifinle acil şifalar ihsan eyle Allah’ım. Kimin işinde ve kazancında bir darlık varsa, Rezzâk ismi şerifinle ummadığı yerlerden helal kapılar aç Allah’ım. Anne ve babalarımıza hürmet etmeyi, onların hayır duasını almayı bizlere nasip eyle; ahirete irtihal etmiş bütün büyüklerimizin ruhlarını şad eyle. Kalplerimize sekînet, evlerimize muhabbet, ömürlerimize bereket ver. Birlik ve beraberliğimizi daim eyle, bizleri doğruluktan, merhametten ve güzel ahlaktan ayırma. Âmin, velhamdülillâhi rabbil-âlemîn.',
  },
  {
    id: 'closing_ithaf',
    label: '5. Uzun Kapanış / İthaf Metni (Yâsîn)',
    targetDescription: 'Yâsîn-i Şerîf kapanış teşekkür ve ithaf şablonu',
    text: 'Sadakallâhülazîm. Okunan bu mübarek Yâsîn-i Şerîf’ten hâsıl olan sevabı evvelâ Sevgili Peygamberimiz Hazreti Muhammed Mustafa sallallâhu aleyhi ve sellem Efendimizin mübarek ruh-i şerîflerine hediye eyledik, vasıl eyle Allah’ım. Kıymetli Hüseyin Kaya kardeşimize bu güzel ikramı ve hayır niyeti için gönülden teşekkür ediyoruz. Yüce Rabbim; Hüseyin Kaya kardeşimizin, muhterem anne ve babasının, aile fertlerinin, evlatlarının ve bütün akrabalarının dünya ve ahiret saadetini daim eyle; sağlık, afiyet, helal rızık ve hanelerine huzur ve bereket ihsan eyle. Bilhassa Hüseyin Kaya kardeşimizin ve cümlemizin ahirete irtihal etmiş anne, baba, dede, nine ve bütün vefat etmiş yakınlarının ruhlarını şad eyle, kabirlerini pür-nur eyle, taksiratlarını affeyle ve cennetinle, cemalinle müşerref eyle. Âmin, ve selâmün alel-mürselîn, velhamdülillâhi rabbil-âlemîn.',
  },
];
