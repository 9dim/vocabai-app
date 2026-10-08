/**
 * Spaced Repetition Engine implementing SuperMemo SM-2 with enhancements:
 * 1. Multi-failure repeat penalties (accelerated review and extra ease factor reduction).
 * 2. Revision queue prioritization (Due Today, Leech/Struggling, Dormant/Long-interval).
 */

export const SM2_CONSTANTS = {
  MIN_EASE_FACTOR: 1.3,
  DEFAULT_EASE_FACTOR: 2.5,
  FAIL_THRESHOLD: 3, // Quality score < 3 is considered a fail in SM-2
  MULTI_FAIL_COUNT: 2, // 2 or more consecutive fails triggers leech penalty
  DORMANT_DAYS: 30, // Words with interval >= 30 or not reviewed for 30 days
};

/**
 * Calculates updated SM-2 parameters for a word after a review.
 * @param {Object} word - The current word item.
 * @param {number} quality - Review grade from 0 to 5.
 * @returns {Object} Updated spaced repetition metrics.
 */
export function calculateSM2(word, quality) {
  let repetitions = word.repetitions || 0;
  let interval = word.interval || 0;
  let easeFactor = word.easeFactor || SM2_CONSTANTS.DEFAULT_EASE_FACTOR;
  let consecutiveFails = word.consecutiveFails || 0;
  let history = Array.isArray(word.history) ? [...word.history] : [];

  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  if (quality >= SM2_CONSTANTS.FAIL_THRESHOLD) {
    // Successful recall
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
    consecutiveFails = 0; // Reset failure streak on success
  } else {
    // Failed recall (quality < 3)
    repetitions = 0;
    consecutiveFails += 1;

    // Standard SM-2 resets interval to 1
    // Enhanced rule: Multi-failure penalty
    if (consecutiveFails >= SM2_CONSTANTS.MULTI_FAIL_COUNT) {
      // Leech penalty: review in 0.5 day (12 hours) or same day (accelerated), plus additional ease reduction
      interval = 0.5;
      easeFactor = Math.max(SM2_CONSTANTS.MIN_EASE_FACTOR, easeFactor - 0.2);
    } else {
      interval = 1;
    }
  }

  // Calculate new Ease Factor:
  // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  const qDelta = 5 - quality;
  easeFactor = easeFactor + (0.1 - qDelta * (0.08 + qDelta * 0.02));

  if (easeFactor < SM2_CONSTANTS.MIN_EASE_FACTOR) {
    easeFactor = SM2_CONSTANTS.MIN_EASE_FACTOR;
  }

  // Round easeFactor to 2 decimal places
  easeFactor = Math.round(easeFactor * 100) / 100;

  // Next due date
  const dueDate = now + Math.round(interval * ONE_DAY_MS);

  history.push({
    timestamp: now,
    quality,
    interval,
    easeFactor
  });

  return {
    repetitions,
    interval,
    easeFactor,
    consecutiveFails,
    dueDate,
    lastReviewed: now,
    history
  };
}

/**
 * Filter and categorize word queues.
 * @param {Array} words - Array of all words.
 * @returns {Object} Categorized queues: dueToday, struggling, dormant, all.
 */
export function getRevisionQueues(words = []) {
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const DORMANT_MS = SM2_CONSTANTS.DORMANT_DAYS * ONE_DAY_MS;

  const dueToday = [];
  const struggling = [];
  const dormant = [];

  for (const word of words) {
    // Due today if dueDate <= now or no lastReviewed (never reviewed)
    const isDue = !word.dueDate || word.dueDate <= now;
    if (isDue) {
      dueToday.push(word);
    }

    // Struggling if consecutiveFails >= 2 or low ease factor
    if ((word.consecutiveFails && word.consecutiveFails >= SM2_CONSTANTS.MULTI_FAIL_COUNT) || (word.easeFactor && word.easeFactor <= 1.5)) {
      struggling.push(word);
    }

    // Dormant if reviewed before and last reviewed > 30 days ago, or high interval (>= 30 days)
    if (word.lastReviewed && (now - word.lastReviewed >= DORMANT_MS || (word.interval && word.interval >= SM2_CONSTANTS.DORMANT_DAYS))) {
      dormant.push(word);
    }
  }

  // Sort dueToday: earliest due date or highest consecutive fails first
  dueToday.sort((a, b) => {
    if ((b.consecutiveFails || 0) !== (a.consecutiveFails || 0)) {
      return (b.consecutiveFails || 0) - (a.consecutiveFails || 0);
    }
    return (a.dueDate || 0) - (b.dueDate || 0);
  });

  // Sort struggling: highest consecutive fails first
  struggling.sort((a, b) => (b.consecutiveFails || 0) - (a.consecutiveFails || 0));

  // Sort dormant: oldest reviewed first
  dormant.sort((a, b) => (a.lastReviewed || 0) - (b.lastReviewed || 0));

  return {
    dueToday,
    struggling,
    dormant,
    all: words
  };
}
