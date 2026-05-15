/**
 * Tests for the food content filter — extracted verbatim from the
 * monolith, so the parity goal is "behave identically to
 * FoodstrFeedOptimized's local helpers".
 */

import { describe, it, expect } from 'vitest';
import {
  contentContainsFoodWords,
  hasFoodHashtag,
  getHashtagCount,
  createFoodFilter,
  FOOD_HASHTAGS,
  MAX_HASHTAGS
} from './foodFilter';

describe('contentContainsFoodWords', () => {
  it('returns false for empty / whitespace content', () => {
    expect(contentContainsFoodWords('')).toBe(false);
    expect(contentContainsFoodWords('   ')).toBe(false);
  });

  it('returns true for a food hashtag in content', () => {
    expect(contentContainsFoodWords('Lunch was great #foodstr')).toBe(true);
    expect(contentContainsFoodWords('Trying a new #recipestr')).toBe(true);
  });

  it('returns true for a single HARD-word match', () => {
    expect(contentContainsFoodWords('Sharing a new recipe today')).toBe(true);
    expect(contentContainsFoodWords('Made pasta from scratch')).toBe(true);
  });

  it('requires 2 SOFT-word matches', () => {
    // Only "food" → not enough.
    expect(contentContainsFoodWords('thinking about food')).toBe(false);
    // "food" + "spicy" → two soft matches.
    expect(contentContainsFoodWords('thinking about spicy food')).toBe(true);
  });

  it('excludes "excluding food and energy" macro phrase unless strong signal', () => {
    // Macro phrase alone with one soft hit → excluded.
    expect(
      contentContainsFoodWords(
        'Core CPI excludes food and energy according to the report'
      )
    ).toBe(false);
    // Macro phrase + a hard hit → still included.
    expect(
      contentContainsFoodWords(
        'Core CPI excludes food and energy; meanwhile my recipe rocks'
      )
    ).toBe(true);
  });

  it('excludes content with the standalone word "root"', () => {
    expect(contentContainsFoodWords('root cause of the issue is recipes')).toBe(false);
  });

  it("doesn't trigger on substrings of food words", () => {
    expect(contentContainsFoodWords('this is a great article about politics')).toBe(false);
  });
});

describe('hasFoodHashtag', () => {
  it('returns true when a t tag matches the canonical list', () => {
    expect(hasFoodHashtag({ tags: [['t', 'foodstr']] })).toBe(true);
    expect(hasFoodHashtag({ tags: [['t', 'COOKING']] })).toBe(true); // case-insensitive
  });

  it('returns false for non-food tags', () => {
    expect(hasFoodHashtag({ tags: [['t', 'bitcoin']] })).toBe(false);
  });

  it('returns false when there are no tags', () => {
    expect(hasFoodHashtag({ tags: [] })).toBe(false);
    expect(hasFoodHashtag({})).toBe(false);
  });

  it('ignores non-t tags', () => {
    expect(hasFoodHashtag({ tags: [['p', 'foodstr']] })).toBe(false);
  });

  it('verifies the canonical list contains expected entries', () => {
    expect(FOOD_HASHTAGS).toContain('foodstr');
    expect(FOOD_HASHTAGS).toContain('recipe');
    expect(FOOD_HASHTAGS).toContain('cooking');
  });
});

describe('getHashtagCount', () => {
  it('counts t tags', () => {
    expect(
      getHashtagCount({
        tags: [
          ['t', 'foodstr'],
          ['t', 'cooking'],
          ['e', 'parent'] // not counted
        ]
      })
    ).toBe(2);
  });

  it('counts inline #hashtags in content', () => {
    expect(
      getHashtagCount({
        content: 'enjoying #foodstr and #pasta and #italian today',
        tags: []
      })
    ).toBe(3);
  });

  it('returns the higher of inline vs tag counts', () => {
    expect(
      getHashtagCount({
        content: '#a #b #c #d #e',
        tags: [
          ['t', 'a'],
          ['t', 'b']
        ]
      })
    ).toBe(5);
  });

  it('returns 0 when no content / tags', () => {
    expect(getHashtagCount({})).toBe(0);
  });

  it('MAX_HASHTAGS spam threshold is 5', () => {
    expect(MAX_HASHTAGS).toBe(5);
  });
});

describe('createFoodFilter', () => {
  it('memoizes results by content string', () => {
    const filter = createFoodFilter();
    const content = 'I love cooking recipes';
    // Same content twice → memo hit.
    expect(filter.classifyContent(content)).toBe(true);
    expect(filter.classifyContent(content)).toBe(true);
  });

  it('returns the same answer as the pure function', () => {
    const filter = createFoodFilter();
    const samples = [
      'My new pasta recipe',
      'thinking about politics',
      '#foodstr lunch was great',
      'excluding food and energy from CPI',
      '',
      'pasta and pizza tonight',
      'spicy food today'
    ];
    for (const c of samples) {
      expect(filter.classifyContent(c)).toBe(contentContainsFoodWords(c));
    }
  });

  it('reset() clears the cache', () => {
    const filter = createFoodFilter();
    filter.classifyContent('My recipe today');
    filter.reset();
    // After reset, re-classify still works correctly.
    expect(filter.classifyContent('My recipe today')).toBe(true);
  });

  it('returns false for empty content without caching', () => {
    const filter = createFoodFilter();
    expect(filter.classifyContent('')).toBe(false);
    expect(filter.classifyContent('')).toBe(false);
  });
});
