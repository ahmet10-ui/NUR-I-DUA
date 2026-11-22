import { normalizeTurkishForEma } from './emaTextFrontend';

/**
 * Zerre-TTS SES-A (MK) Frontend & Verified Manifest
 *
 * Reference repository: https://github.com/erkinemreta1/zerre-tts (Apache-2.0 code)
 * Notice from upstream docs/data_sources.md:
 *   Training corpus metadata states audiobook sources (`omersaidd/tts_mazlum_kiper_tur`
 *   listed as MIT by uploader, not independently verified for commercial redistribution).
 *   NUR-I DUA keeps Seslen-TTS Hasan as default and exposes SES-A (MK) strictly opt-in.
 */

export interface ZerreArtifactSpec {
  id: 'model_config' | 'lexicon' | 'model_onnx';
  fileName: string;
  expectedBytes: number;
  sha256: string;
  url: string;
  purpose: string;
}

export const ZERRE_RAW_BASE_URL =
  'https://raw.githubusercontent.com/erkinemreta1/zerre-tts/main/web/public';

export const ZERRE_VOICE_INDEX_MK = 0; // "MK" = SES-A male narrator; index 1 ("NK") = female, never used
export const ZERRE_SAMPLE_RATE = 24000;
export const ZERRE_MAX_TOKENS = 512;
export const ZERRE_TOTAL_BYTES = 9724638;

export const ZERRE_LEGAL_WARNING =
  'Zerre SES-A (MK) kodları Apache-2.0 olsa da upstream docs/data_sources.md belgesine göre eğitim verisi sesli kitap kaynaklıdır (yükleyici MIT beyanı). Ticari veya genel canlı yayın öncesinde kendi hukuki değerlendirmenizi yapın.';

export const ZERRE_ARTIFACT_MANIFEST: ZerreArtifactSpec[] = [
  {
    id: 'model_config',
    fileName: 'model.json',
    expectedBytes: 893,
    sha256: '6676fda5a30fa4a3aefe6b7a453bec8ae92d2128be0646706ac262b267ca9ec9',
    url: `${ZERRE_RAW_BASE_URL}/model.json`,
    purpose: 'Zerre model yapılandırması (sample_rate=24000, voices=["MK","NK"], max_tokens=512)',
  },
  {
    id: 'lexicon',
    fileName: 'lexicon-tr.json',
    expectedBytes: 1174675,
    sha256: '31ea64f92811e555885f4d80dba01444db078ef45963f3cf67e86ffffeb64e8f',
    url: `${ZERRE_RAW_BASE_URL}/lexicon-tr.json`,
    purpose: 'Türkçe fonem ve vurgu sözlüğü + sembol tablosu',
  },
  {
    id: 'model_onnx',
    fileName: 'model.onnx',
    expectedBytes: 8549070,
    sha256: '4c3d0d989a0376675f27645e4a6116bbff0dd8cd12208185c8069b6f7330115e',
    url: `${ZERRE_RAW_BASE_URL}/model.onnx`,
    purpose: 'Zerre SES-A INT8 ONNX akustik modeli (~8.55 MB)',
  },
];

export const ZERRE_SYMBOLS: string[] = [
  '<pad>',
  '<bos>',
  '<eos>',
  '<sp>',
  '<unk>',
  ',',
  '.',
  '?',
  '!',
  ';',
  ':',
  '"',
  "'",
  '(',
  ')',
  '—',
  '…',
  'p',
  'b',
  't',
  'd',
  'c',
  'ɟ',
  'k',
  'g',
  'f',
  'v',
  's',
  'z',
  'ʃ',
  'ʒ',
  'h',
  'm',
  'n',
  'ɲ',
  'ŋ',
  'l',
  'ɫ',
  'ɾ',
  'r',
  'j',
  'w',
  'tʃ',
  'dʒ',
  'a',
  'e',
  'i',
  'o',
  'u',
  'y',
  'ø',
  'œ',
  'ɯ',
  'aː',
  'eː',
  'iː',
  'oː',
  'uː',
  'yː',
  'øː',
  'œː',
  'ɯː',
];

const VOWEL_PHONE = new Set(['a', 'e', 'i', 'o', 'u', 'y', 'ø', 'œ', 'ɯ']);
const BACK_VOWELS = new Set(['a', 'ı', 'o', 'u']);
const BASE_PHONES: Record<string, string> = {
  a: 'a',
  b: 'b',
  c: 'dʒ',
  ç: 'tʃ',
  d: 'd',
  e: 'e',
  f: 'f',
  g: 'g',
  h: 'h',
  ı: 'ɯ',
  i: 'i',
  j: 'ʒ',
  k: 'k',
  l: 'l',
  m: 'm',
  n: 'n',
  o: 'o',
  ö: 'œ',
  p: 'p',
  r: 'ɾ',
  s: 's',
  ş: 'ʃ',
  t: 't',
  u: 'u',
  ü: 'y',
  v: 'v',
  y: 'j',
  z: 'z',
};

export type ZerreLexiconMap = Record<string, [string, string]>;

export function clampZerreSpeed(rate: number | undefined): number {
  const numeric = typeof rate === 'number' && Number.isFinite(rate) ? rate : 0.94;
  return Math.max(0.65, Math.min(1.45, Number(numeric.toFixed(2))));
}

/**
 * Normalize Turkish digits, symbols, religious transliterations, and punctuation
 * into clean Turkish prose before Zerre lexicon lookup & phonemization.
 */
export function normalizeTurkishForZerre(raw: string): string {
  return normalizeTurkishForEma(raw)
    .replace(/\u2019|\u2018/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Exact TypeScript mirror of Zerre `phonemize-tr.js` fallbackPhones.
 */
export function fallbackPhonesZerre(word: string): { phones: string[]; stress: number[] } {
  const lower = word.toLocaleLowerCase('tr');
  const phones: string[] = [];
  const stress: number[] = [];

  for (let i = 0; i < lower.length; i += 1) {
    const letter = lower[i];
    if (letter === 'ğ') {
      if (phones.length > 0 && i > 0 && /[aeıioöuü]/.test(lower[i - 1])) {
        phones[phones.length - 1] += 'ː';
      }
      continue;
    }
    if (!(letter in BASE_PHONES)) continue;

    const following = lower[i + 1];
    const front = Boolean(following && /[eiöü]/.test(following));
    let phone = BASE_PHONES[letter];
    if (letter === 'k' && front) phone = 'c';
    if (letter === 'g' && front) phone = 'ɟ';
    if (letter === 'l' && i > 0 && BACK_VOWELS.has(lower[i - 1])) phone = 'ɫ';
    phones.push(phone);
    stress.push(0);
  }

  for (let i = phones.length - 1; i >= 0; i -= 1) {
    if (VOWEL_PHONE.has(phones[i].replace('ː', ''))) {
      stress[i] = 1;
      break;
    }
  }

  return { phones, stress };
}

/**
 * Exact TypeScript mirror of Zerre `phonemize-tr.js` phonemize().
 */
export function phonemizeZerreSentence(
  text: string,
  lexiconWords: ZerreLexiconMap = {},
  symbols: string[] = ZERRE_SYMBOLS
): { ids: number[]; stress: number[]; symbols: string[] } {
  const index = new Map(symbols.map((symbol, position) => [symbol, position]));
  const ids: number[] = [];
  const stress: number[] = [];

  const push = (symbol: string, level: number) => {
    const id = index.get(symbol);
    if (id === undefined) return;
    ids.push(id);
    stress.push(level || 0);
  };

  push('<bos>', 0);
  let lastWasWord = false;
  const tokens = text.match(/[\p{L}]+|[.,!?;:—…]/gu) || [];

  for (const token of tokens) {
    if (/^[\p{L}]+$/u.test(token)) {
      if (lastWasWord) push('<sp>', 0);
      const key = token.toLocaleLowerCase('tr');
      const entry = lexiconWords[key];
      let phones: string[];
      let levels: number[];
      if (entry) {
        phones = entry[0].split(' ').filter(Boolean);
        levels = entry[1].split('').map((n) => Number(n) || 0);
      } else {
        ({ phones, stress: levels } = fallbackPhonesZerre(key));
      }
      phones.forEach((phone, pos) => push(phone, levels[pos] || 0));
      lastWasWord = true;
    } else {
      push(token, 0);
      lastWasWord = false;
    }
  }

  push('<eos>', 0);
  return {
    ids,
    stress,
    symbols: ids.map((id) => symbols[id]),
  };
}

/**
 * Split normalized Turkish text into sentence chunks sized safely inside Zerre max_tokens (512).
 */
export function splitZerreSentences(rawText: string, maxChars = 220): string[] {
  const normalized = normalizeTurkishForZerre(rawText);
  if (!normalized) return [];

  const rawSentences = normalized
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const sentence of rawSentences) {
    if (sentence.length <= maxChars) {
      out.push(sentence);
      continue;
    }
    const words = sentence.split(/\s+/);
    let current = '';
    for (const w of words) {
      const candidate = current ? `${current} ${w}` : w;
      if (candidate.length > maxChars && current) {
        out.push(current.trim());
        current = w;
      } else {
        current = candidate;
      }
    }
    if (current.trim()) out.push(current.trim());
  }
  return out;
}
