/**
 * Food content filter — extracted from FoodstrFeedOptimized.svelte.
 *
 * Identical constants, regexes, and scoring logic as the monolith so
 * parity is preserved when sources are validated via the `?newfeed=1`
 * toggle. The functions are pure — no Svelte stores or component
 * state — and memoize via per-instance caches the caller creates with
 * `createFoodFilter()`. Each FeedSource holds its own cache; the
 * monolith continues to hold its own. Phase 7 cleanup will retire the
 * monolith's copy of the constants.
 */

// ────────────────────────────────────────────────────────────────────
// Hashtags
// ────────────────────────────────────────────────────────────────────

/** Tag values (no `#` prefix) used as `#t` filter on relay subscriptions
 * AND as the canonical lookup for `event.tags` hashtag matches. */
export const FOOD_HASHTAGS: readonly string[] = [
  'foodstr',
  'cook',
  'cookstr',
  'zapcooking',
  'cooking',
  'drinkstr',
  'foodies',
  'carnivor',
  'carnivorediet',
  'soup',
  'soupstr',
  'drink',
  'eat',
  'burger',
  'steak',
  'steakstr',
  'dine',
  'dinner',
  'lunch',
  'breakfast',
  'supper',
  'yum',
  'snack',
  'snackstr',
  'dessert',
  'beef',
  'chicken',
  'bbq',
  'coffee',
  'mealprep',
  'meal',
  'recipe',
  'recipestr',
  'recipes',
  'food',
  'foodie',
  'foodporn',
  'instafood',
  'foodstagram',
  'foodblogger',
  'homecooking',
  'fromscratch',
  'baking',
  'baker',
  'pastry',
  'chef',
  'chefs',
  'cuisine',
  'gourmet',
  'restaurant',
  'restaurants',
  'pasta',
  'pizza',
  'sushi',
  'tacos',
  'taco',
  'burrito',
  'sandwich',
  'salad',
  'soup',
  'stew',
  'curry',
  'stirfry',
  'grill',
  'grilled',
  'roast',
  'roasted',
  'fried',
  'baked',
  'smoked',
  'fermented',
  'pickled',
  'preserved',
  'homemade',
  'vegan',
  'vegetarian',
  'keto',
  'paleo',
  'glutenfree',
  'dairyfree',
  'healthy',
  'nutrition',
  'nutritionist',
  'dietitian',
  'mealplan',
  'mealprep',
  'batchcooking'
];

// ────────────────────────────────────────────────────────────────────
// Hard/soft word lists (content scoring)
// ────────────────────────────────────────────────────────────────────

/** Strong-signal hashtag terms used in the FOOD_HASHTAG_REGEX. */
const FOOD_HASHTAG_TERMS: readonly string[] = [
  'foodstr',
  'cookstr',
  'zapcooking',
  'recipestr',
  'soupstr',
  'drinkstr',
  'snackstr',
  'steakstr',
  'mealprep',
  'foodies',
  'carnivor',
  'carnivorediet'
];

/** HARD words — very low false-positive risk; 1 hit is enough. */
const HARD_FOOD_WORDS: readonly string[] = [
  // Recipes & cooking intent
  'recipe',
  'recipes',
  'recipestr',
  'cooking',
  'baking',
  'bake',
  'chef',
  'chefs',
  'kitchen',
  'ingredient',
  'ingredients',
  'seasoned',
  'seasoning',
  'marinated',
  'saute',
  'sauteed',
  'simmer',
  'braised',
  'fermented',
  'pickled',
  'smoked',
  'slow cooked',
  'air fried',
  // Meals (strong real-world food signal)
  'breakfast',
  'lunch',
  'dinner',
  'dessert',
  'mealprep',
  'meal prep',
  'homecooking',
  'home cooked',
  'fromscratch',
  'homemade',
  // Food items & dishes
  'pasta',
  'pizza',
  'sushi',
  'taco',
  'tacos',
  'burrito',
  'sandwich',
  'salad',
  'soup',
  'stew',
  'curry',
  'burger',
  'steak',
  'bbq',
  'coffee',
  // Ingredients & staples
  'garlic',
  'onion',
  'tomato',
  'cheese',
  'butter',
  'olive oil',
  'rice',
  'beans',
  'eggs',
  'flour',
  // Diets & preferences (safe as hard)
  'vegan',
  'vegetarian',
  'keto',
  'paleo',
  'glutenfree',
  'gluten free',
  'dairyfree',
  'dairy free',
  // Restaurants (strong enough on Nostr)
  'restaurant',
  'restaurants'
];

/** SOFT words — common in metaphor / news; require 2 hits. */
const SOFT_FOOD_WORDS: readonly string[] = [
  'food',
  'meal',
  'supper',
  'spicy',
  'sweet',
  'flavor',
  'healthy',
  'organic',
  'grill',
  'grilled',
  'roast',
  'roasted',
  'italian',
  'mexican',
  'thai',
  'indian',
  'mediterranean',
  'japanese',
  'korean'
];

// ────────────────────────────────────────────────────────────────────
// Regex helpers
// ────────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Convert a list term to a word-boundary regex pattern. Multi-word
 * phrases match flexible whitespace between the words. */
function termToPattern(term: string): string {
  const parts = term.trim().split(/\s+/).map(escapeRegex);
  if (parts.length === 1) return `\\b${parts[0]}\\b`;
  return `\\b${parts.join('\\s+')}\\b`;
}

/** Pre-compiled regex over hashtags in note content (`#foodstr`, etc). */
export const FOOD_HASHTAG_REGEX = new RegExp(
  `(?:^|\\s)#(${FOOD_HASHTAG_TERMS.map(escapeRegex).join('|')})\\b`,
  'i'
);
/** Pre-compiled regex matching any HARD food word. */
export const HARD_FOOD_REGEX = new RegExp(
  HARD_FOOD_WORDS.map(termToPattern).join('|'),
  'ig'
);
/** Pre-compiled regex matching any SOFT food word. */
export const SOFT_FOOD_REGEX = new RegExp(
  SOFT_FOOD_WORDS.map(termToPattern).join('|'),
  'ig'
);
/** Common economics phrase ("excluding food and energy") which would
 * otherwise score a "food" soft match. */
export const MACRO_EXCLUDING_FOOD_ENERGY_REGEX =
  /\b(excluding|exclude)\s+food\s+and\s+energy\b/i;

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/** Snapshot of an event tag list — what we need for hashtag checks
 * without depending on the NDKEvent class directly (keeps this module
 * pure and trivially testable). */
interface TaggedEventLike {
  content?: string;
  tags?: string[][];
}

/**
 * Test note content for food relevance. Pure function, but expensive
 * for long content; the wrapper returned by `createFoodFilter()`
 * memoizes against a per-instance Map so the regex passes happen once
 * per content string.
 *
 * Scoring (identical to the monolith):
 *   - Content containing the standalone word "root" is excluded
 *     (avoids false positives like "root cause").
 *   - A food hashtag in content → include.
 *   - ≥ 1 HARD-word match → include.
 *   - ≥ 2 SOFT-word matches → include.
 *   - The "excluding food and energy" macro phrase suppresses a single
 *     soft-only match.
 */
export function contentContainsFoodWords(content: string): boolean {
  if (!content) return false;
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (/\broot\b/i.test(normalized)) return false;
  if (FOOD_HASHTAG_REGEX.test(normalized)) return true;
  HARD_FOOD_REGEX.lastIndex = 0;
  SOFT_FOOD_REGEX.lastIndex = 0;
  const hardCount = (normalized.match(HARD_FOOD_REGEX) ?? []).length;
  const softCount = (normalized.match(SOFT_FOOD_REGEX) ?? []).length;
  if (MACRO_EXCLUDING_FOOD_ENERGY_REGEX.test(normalized)) {
    if (hardCount === 0 && softCount < 2) return false;
  }
  if (hardCount >= 1) return true;
  if (softCount >= 2) return true;
  return false;
}

/** True if the event carries any food hashtag via `t` tags. */
export function hasFoodHashtag(event: TaggedEventLike): boolean {
  const tags = event.tags;
  if (!Array.isArray(tags)) return false;
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== 't') continue;
    const value = (tag[1] || '').toLowerCase();
    if (FOOD_HASHTAGS.includes(value)) return true;
  }
  return false;
}

/**
 * Compute hashtag density for spam detection. Counts the higher of
 * inline `#tag` mentions in content and `t` tags on the event.
 */
export function getHashtagCount(event: TaggedEventLike): number {
  const content = event.content || '';
  const inline = content.match(/(^|\s)#([^\s#]+)/g);
  const inlineCount = inline ? inline.length : 0;
  const tagCount = Array.isArray(event.tags)
    ? event.tags.filter((t) => Array.isArray(t) && t[0] === 't').length
    : 0;
  return Math.max(inlineCount, tagCount);
}

/** Hashtag spam threshold — events with more than this many hashtags
 * are excluded. */
export const MAX_HASHTAGS = 5;

/**
 * Factory for a per-instance, memoized content classifier. Each
 * `FeedSource` calls this once and reuses the returned function for
 * every event it considers.
 */
export interface FoodClassifier {
  /** Returns true if the content qualifies as food-related. Memoized
   * by content string. */
  classifyContent(content: string): boolean;
  /** Reset the memoization cache. Useful if external signals change
   * (e.g. word-list updates in a future tab settings UI). */
  reset(): void;
}

export function createFoodFilter(): FoodClassifier {
  const cache = new Map<string, boolean>();
  const MAX_ENTRIES = 1000;
  const EVICT_TARGET = 900;
  return {
    classifyContent(content: string): boolean {
      if (!content) return false;
      if (cache.size > MAX_ENTRIES) {
        const keys = cache.keys();
        while (cache.size > EVICT_TARGET) {
          const next = keys.next();
          if (next.done) break;
          cache.delete(next.value);
        }
      }
      const cached = cache.get(content);
      if (cached !== undefined) return cached;
      const result = contentContainsFoodWords(content);
      cache.set(content, result);
      return result;
    },
    reset() {
      cache.clear();
    }
  };
}
