/**
 * Input validation, username sanitization, and safe prayer personalization.
 */

export function sanitizeUsername(raw: string): string {
  if (!raw || typeof raw !== 'string') return 'Misafir';
  // Remove HTML tags, control characters, zero-width chars, and trim
  const cleaned = raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '')
    .replace(/[@#$%^&*()+={}[\]|\\:;"'<>?,/]/g, '')
    .trim();

  if (!cleaned) return 'Misafir';
  return cleaned.slice(0, 32);
}

/**
 * Formats a TikTok username into a natural, respectful spoken Turkish name
 * when substituting into `{isim}` while keeping display handle clean.
 */
export function formatSpokenName(sanitizedHandle: string): string {
  // Replace dots/underscores with spaces and strip trailing numbers for smoother TTS pronunciation
  const spaced = sanitizedHandle
    .replace(/[._-]+/g, ' ')
    .replace(/\d+$/g, '')
    .trim();
  if (!spaced) return sanitizedHandle;
  return spaced
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase('tr-TR') + part.slice(1))
    .join(' ');
}

export const DEFAULT_MAX_PRAYER_LENGTH = 8000;

const ARABIC_DIACRITIC_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/;

function safeUnicodeSlice(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let end = maxLength;
  // Avoid cutting inside a UTF-16 surrogate pair
  if (end > 0) {
    const lastCode = text.charCodeAt(end - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
      end -= 1;
    }
  }
  // If the cut lands right before trailing Arabic combining marks (harekeler),
  // step back to before the base character so the final character doesn't lose its hareke.
  if (end < text.length && ARABIC_DIACRITIC_RE.test(text[end])) {
    while (end > 0 && ARABIC_DIACRITIC_RE.test(text[end])) {
      end -= 1;
    }
    if (end > 0) {
      end -= 1;
    }
  }
  return text.slice(0, end).trimEnd();
}

export function sanitizePrayerTemplate(raw: string, maxLength = DEFAULT_MAX_PRAYER_LENGTH): string {
  if (!raw || typeof raw !== 'string') return '';
  const limit = Math.max(100, Math.floor(Number(maxLength) || DEFAULT_MAX_PRAYER_LENGTH));
  const cleaned = raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .trim();
  return safeUnicodeSlice(cleaned, limit);
}

export function sanitizeGiftName(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, 40);
}

export function renderPersonalizedPrayer(template: string, username: string): string {
  const safeHandle = sanitizeUsername(username);
  const spokenName = formatSpokenName(safeHandle);
  return template.replace(/\{isim\}/gi, spokenName);
}

export function sanitizeTikTokHandle(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9._]/g, '')
    .slice(0, 32);
}

let idSeq = 0;

export function createUniqueId(prefix: string): string {
  idSeq = (idSeq + 1) % 100000;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}-${idSeq}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${idSeq}-${Math.random().toString(36).slice(2, 6)}`;
}
