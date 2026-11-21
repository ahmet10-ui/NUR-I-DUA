import { InteractionTierId, QueueEvent } from '../types/nuridua';

export interface TopTierBarItem {
  tier: Exclude<InteractionTierId, 'follower'>;
  range: string;
  label: string;
  weight: number;
  nowrapRange: boolean;
}

export const TOP_TIER_BAR_ITEMS: readonly TopTierBarItem[] = [
  {
    tier: 'small_gift',
    range: '1–49',
    label: 'Selamlama',
    weight: 0.85,
    nowrapRange: false,
  },
  {
    tier: 'mid_gift',
    range: '50–149',
    label: 'Açılış duası',
    weight: 1.0,
    nowrapRange: false,
  },
  {
    tier: 'high_gift',
    range: '150–299',
    label: 'Kapsamlı dua',
    weight: 1.5,
    nowrapRange: true,
  },
  {
    tier: 'yasin_300',
    range: '300+',
    label: 'Yâsîn',
    weight: 0.85,
    nowrapRange: false,
  },
] as const;

export const TOP_TIER_BAR_GRID_COLUMNS = TOP_TIER_BAR_ITEMS.map((item) => `${item.weight}fr`).join(' ');

/**
 * Cleans and safely truncates a TikTok username for the compact broadcast notification card.
 */
export function cleanNotificationUsername(
  username?: string,
  displayUsername?: string,
  maxLength = 24
): string {
  const raw = (displayUsername || username || '').trim();
  const stripped = raw
    .replace(/^@+/, '')
    .replace(/[\u0000-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!stripped) return 'Kardeşimiz';
  if (stripped.length <= maxLength) return stripped;
  return `${stripped.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

/**
 * Formats the compact prayer notification shown on the broadcast screen ONLY while playback is actively running.
 *
 * Rules:
 * - Never displays while idle, queued, or before playback actually starts (`hasPlaybackStarted === false`).
 * - Never displays Arabic text or Turkish meal.
 * - `small_gift` (1–49) and `follower`: greeting speech only; returns `null` (no prayer notification on screen).
 * - `mid_gift` (50–149): `"{Kullanıcı Adı} isimli kardeşimizin {Dua Adı} duası okunuyor."`
 * - `high_gift` (150–299): `"{Kullanıcı Adı} isimli kardeşimizin {Dua Adı} duası okunuyor."`
 * - `yasin_300` (300+): strictly `'Yâsîn-i Şerîf okunuyor'` with NO username.
 */
export function formatBroadcastPrayerNotification(
  event: QueueEvent | null,
  hasPlaybackStarted: boolean
): string | null {
  if (!event || !hasPlaybackStarted) return null;

  if (event.eventType === 'follow' || event.tier === 'follower' || event.tier === 'small_gift') {
    return null;
  }

  if (event.tier === 'yasin_300') {
    return 'Yâsîn-i Şerîf okunuyor';
  }

  const cleanUser = cleanNotificationUsername(event.username, event.displayUsername);
  const cleanTitle = (event.prayerTitle || 'Dua')
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return `${cleanUser} isimli kardeşimizin ${cleanTitle || 'Dua'} duası okunuyor.`;
}

/**
 * Returns the active coin-tier ID highlighted in the top bar while playback is actively running.
 */
export function getActiveTopTierId(
  event: QueueEvent | null,
  hasPlaybackStarted: boolean
): TopTierBarItem['tier'] | null {
  if (!event || !hasPlaybackStarted) return null;
  if (
    event.tier === 'small_gift' ||
    event.tier === 'mid_gift' ||
    event.tier === 'high_gift' ||
    event.tier === 'yasin_300'
  ) {
    return event.tier;
  }
  return null;
}
