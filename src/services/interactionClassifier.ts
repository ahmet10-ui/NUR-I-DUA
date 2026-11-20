import { DEFAULT_TIER_RULES } from '../data/defaults';
import {
  GiftPriority,
  InteractionTierId,
  TierRuleConfig,
  TikTokRelayFollowPayload,
  TikTokRelayGiftPayload,
} from '../types/nuridua';
import { renderPersonalizedPrayer, sanitizeUsername } from '../utils/sanitize';

export type GiftClassificationRejectReason =
  | 'streak_incomplete'
  | 'invalid_coin_value'
  | 'below_min_threshold'
  | 'tier_disabled';

export interface GiftClassificationResult {
  shouldEnqueue: boolean;
  reason?: GiftClassificationRejectReason;
  tier: Exclude<InteractionTierId, 'follower'> | null;
  /**
   * Number of queue items generated for this single finalized gift event.
   * For any single completed gift event >= yasinMinCoins (e.g. 300, 600, 1000),
   * this is strictly 1.
   */
  eventCount: 0 | 1;
  unitCoins: number;
  repeatCount: number;
  eventCoins: number;
  priority: GiftPriority;
  requiresPrayer: boolean;
  renderedGreeting?: string;
}

export interface FollowClassificationResult {
  shouldEnqueue: boolean;
  reason?: 'follower_disabled';
  tier: 'follower';
  eventCount: 0 | 1;
  username: string;
  renderedGreeting: string;
  priority: GiftPriority;
}

export function resolveTierRules(override?: Partial<TierRuleConfig> | null): TierRuleConfig {
  const base = DEFAULT_TIER_RULES;
  if (!override) return { ...base };

  const smallGiftMinCoins =
    Number.isFinite(Number(override.smallGiftMinCoins)) && Number(override.smallGiftMinCoins) >= 1
      ? Math.floor(Number(override.smallGiftMinCoins))
      : base.smallGiftMinCoins;

  const yasinMinCoins =
    Number.isFinite(Number(override.yasinMinCoins)) && Number(override.yasinMinCoins) >= 2
      ? Math.floor(Number(override.yasinMinCoins))
      : base.yasinMinCoins;

  const highGiftMinCoins =
    Number.isFinite(Number(override.highGiftMinCoins)) &&
    Number(override.highGiftMinCoins) > smallGiftMinCoins &&
    Number(override.highGiftMinCoins) < yasinMinCoins
      ? Math.floor(Number(override.highGiftMinCoins))
      : Math.min(base.highGiftMinCoins, Math.max(smallGiftMinCoins + 2, yasinMinCoins - 1));

  const midGiftMinCoins =
    Number.isFinite(Number(override.midGiftMinCoins)) &&
    Number(override.midGiftMinCoins) > smallGiftMinCoins &&
    Number(override.midGiftMinCoins) < highGiftMinCoins
      ? Math.floor(Number(override.midGiftMinCoins))
      : Math.min(base.midGiftMinCoins, Math.max(smallGiftMinCoins + 1, highGiftMinCoins - 1));

  return {
    smallGiftMinCoins,
    smallGiftMaxCoins: midGiftMinCoins - 1,
    midGiftMinCoins,
    midGiftMaxCoins: highGiftMinCoins - 1,
    highGiftMinCoins,
    highGiftMaxCoins: yasinMinCoins - 1,
    yasinMinCoins,
    coinEvaluationMode: override.coinEvaluationMode === 'unit_only' ? 'unit_only' : 'event_total',
    followerEnabled:
      typeof override.followerEnabled === 'boolean' ? override.followerEnabled : base.followerEnabled,
    smallGiftEnabled:
      typeof override.smallGiftEnabled === 'boolean' ? override.smallGiftEnabled : base.smallGiftEnabled,
    midGiftEnabled:
      typeof override.midGiftEnabled === 'boolean' ? override.midGiftEnabled : base.midGiftEnabled,
    highGiftEnabled:
      typeof override.highGiftEnabled === 'boolean' ? override.highGiftEnabled : base.highGiftEnabled,
    yasinEnabled:
      typeof override.yasinEnabled === 'boolean' ? override.yasinEnabled : base.yasinEnabled,
    followerGreetingTemplate:
      typeof override.followerGreetingTemplate === 'string' && override.followerGreetingTemplate.trim()
        ? override.followerGreetingTemplate.trim()
        : base.followerGreetingTemplate,
    smallGiftGreetingTemplate:
      typeof override.smallGiftGreetingTemplate === 'string' && override.smallGiftGreetingTemplate.trim()
        ? override.smallGiftGreetingTemplate.trim()
        : base.smallGiftGreetingTemplate,
  };
}

export function isGiftStreakCompleted(gift: Pick<Partial<TikTokRelayGiftPayload>, 'giftType' | 'repeatEnd'>): boolean {
  // TikTok streakable gift (`giftType === 1`) is incomplete unless `repeatEnd === true`.
  if (gift.giftType === 1 && gift.repeatEnd !== true) {
    return false;
  }
  return true;
}

export function calculateGiftCoins(
  gift: Pick<Partial<TikTokRelayGiftPayload>, 'unitCoins' | 'diamondCount' | 'repeatCount' | 'quantity'>,
  coinEvaluationMode: 'event_total' | 'unit_only' = 'event_total'
): {
  valid: boolean;
  unitCoins: number;
  repeatCount: number;
  eventCoins: number;
} {
  const rawUnit =
    gift.unitCoins !== undefined ? Number(gift.unitCoins) : Number(gift.diamondCount);

  if (!Number.isFinite(rawUnit) || rawUnit <= 0) {
    return { valid: false, unitCoins: 0, repeatCount: 0, eventCoins: 0 };
  }

  const hasExplicitRepeat = gift.repeatCount !== undefined || gift.quantity !== undefined;
  const rawRepeat = gift.repeatCount !== undefined ? Number(gift.repeatCount) : Number(gift.quantity ?? 1);

  if (hasExplicitRepeat && (!Number.isFinite(rawRepeat) || rawRepeat <= 0)) {
    return { valid: false, unitCoins: 0, repeatCount: 0, eventCoins: 0 };
  }

  const repeatCount = Math.max(1, Math.floor(rawRepeat || 1));
  const unitCoins = rawUnit;
  const eventCoins = coinEvaluationMode === 'unit_only' ? unitCoins : unitCoins * repeatCount;

  if (!Number.isFinite(eventCoins) || eventCoins <= 0) {
    return { valid: false, unitCoins: 0, repeatCount: 0, eventCoins: 0 };
  }

  return {
    valid: true,
    unitCoins,
    repeatCount,
    eventCoins,
  };
}

/**
 * Pure, stateless per-event gift tier classifier.
 * - Never classifies an incomplete streak (`giftType === 1 && repeatEnd !== true`).
 * - Never accumulates separate gift events across time.
 * - Produces strictly 1 Yâsîn event per completed gift event reaching `>= yasinMinCoins`
 *   (including 300, 600, 1000+ coin single events).
 * - Never triggers Yâsîn on missing, zero, negative, or non-finite coin values.
 */
export function classifyGiftInteraction(
  gift: Partial<TikTokRelayGiftPayload>,
  tierConfig?: Partial<TierRuleConfig> | null
): GiftClassificationResult {
  const rules = resolveTierRules(tierConfig);

  if (!isGiftStreakCompleted(gift)) {
    return {
      shouldEnqueue: false,
      reason: 'streak_incomplete',
      tier: null,
      eventCount: 0,
      unitCoins: 0,
      repeatCount: 0,
      eventCoins: 0,
      priority: 'normal',
      requiresPrayer: false,
    };
  }

  const coinStats = calculateGiftCoins(gift, rules.coinEvaluationMode);
  if (!coinStats.valid) {
    return {
      shouldEnqueue: false,
      reason: 'invalid_coin_value',
      tier: null,
      eventCount: 0,
      unitCoins: 0,
      repeatCount: 0,
      eventCoins: 0,
      priority: 'normal',
      requiresPrayer: false,
    };
  }

  const { unitCoins, repeatCount, eventCoins } = coinStats;
  const safeUser = sanitizeUsername(gift.username || gift.nickname || 'Misafir');

  if (eventCoins >= rules.yasinMinCoins) {
    if (rules.yasinEnabled === false) {
      return {
        shouldEnqueue: false,
        reason: 'tier_disabled',
        tier: 'yasin_300',
        eventCount: 0,
        unitCoins,
        repeatCount,
        eventCoins,
        priority: 'urgent',
        requiresPrayer: false,
      };
    }
    return {
      shouldEnqueue: true,
      tier: 'yasin_300',
      eventCount: 1,
      unitCoins,
      repeatCount,
      eventCoins,
      priority: 'urgent',
      requiresPrayer: true,
    };
  }

  if (eventCoins >= rules.highGiftMinCoins) {
    if (rules.highGiftEnabled === false) {
      return {
        shouldEnqueue: false,
        reason: 'tier_disabled',
        tier: 'high_gift',
        eventCount: 0,
        unitCoins,
        repeatCount,
        eventCoins,
        priority: 'high',
        requiresPrayer: false,
      };
    }
    return {
      shouldEnqueue: true,
      tier: 'high_gift',
      eventCount: 1,
      unitCoins,
      repeatCount,
      eventCoins,
      priority: 'high',
      requiresPrayer: true,
    };
  }

  if (eventCoins >= rules.midGiftMinCoins) {
    if (rules.midGiftEnabled === false) {
      return {
        shouldEnqueue: false,
        reason: 'tier_disabled',
        tier: 'mid_gift',
        eventCount: 0,
        unitCoins,
        repeatCount,
        eventCoins,
        priority: 'normal',
        requiresPrayer: false,
      };
    }
    return {
      shouldEnqueue: true,
      tier: 'mid_gift',
      eventCount: 1,
      unitCoins,
      repeatCount,
      eventCoins,
      priority: 'normal',
      requiresPrayer: true,
    };
  }

  if (eventCoins >= rules.smallGiftMinCoins) {
    if (rules.smallGiftEnabled === false) {
      return {
        shouldEnqueue: false,
        reason: 'tier_disabled',
        tier: 'small_gift',
        eventCount: 0,
        unitCoins,
        repeatCount,
        eventCoins,
        priority: 'normal',
        requiresPrayer: false,
      };
    }
    return {
      shouldEnqueue: true,
      tier: 'small_gift',
      eventCount: 1,
      unitCoins,
      repeatCount,
      eventCoins,
      priority: 'normal',
      requiresPrayer: false,
      renderedGreeting: renderPersonalizedPrayer(rules.smallGiftGreetingTemplate, safeUser),
    };
  }

  return {
    shouldEnqueue: false,
    reason: 'below_min_threshold',
    tier: null,
    eventCount: 0,
    unitCoins,
    repeatCount,
    eventCoins,
    priority: 'normal',
    requiresPrayer: false,
  };
}

export function classifyFollowInteraction(
  follow: Partial<TikTokRelayFollowPayload>,
  tierConfig?: Partial<TierRuleConfig> | null
): FollowClassificationResult {
  const rules = resolveTierRules(tierConfig);
  const safeUser = sanitizeUsername(follow.username || follow.nickname || 'Misafir');
  const renderedGreeting = renderPersonalizedPrayer(rules.followerGreetingTemplate, safeUser);

  if (!rules.followerEnabled) {
    return {
      shouldEnqueue: false,
      reason: 'follower_disabled',
      tier: 'follower',
      eventCount: 0,
      username: safeUser,
      renderedGreeting,
      priority: 'normal',
    };
  }

  return {
    shouldEnqueue: true,
    tier: 'follower',
    eventCount: 1,
    username: safeUser,
    renderedGreeting,
    priority: 'normal',
  };
}
