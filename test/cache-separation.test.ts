import type { OpenSeaAssetEvent } from '../src/types';
import { eventKeyFor } from '../src/utils/event-grouping';
import { LRUCache } from '../src/utils/lru-cache';

// Import JSON fixture
const salesFixture = require('./fixtures/opensea/events-sales.json');

describe('Cache Separation - Why Both Caches Are Needed', () => {
  const FETCH_CACHE_SIZE = 1000;
  const TWEET_CACHE_SIZE = 2000;

  let fetchedEventsCache: LRUCache<string, boolean>;
  let tweetedEventsCache: LRUCache<string, boolean>;
  let mockEvent: OpenSeaAssetEvent;

  beforeEach(() => {
    fetchedEventsCache = new LRUCache<string, boolean>(FETCH_CACHE_SIZE);
    tweetedEventsCache = new LRUCache<string, boolean>(TWEET_CACHE_SIZE);
    mockEvent = salesFixture.asset_events[0] as OpenSeaAssetEvent;
  });

  it('should demonstrate why OpenSea cache cannot replace Twitter cache', () => {
    const eventKey = eventKeyFor(mockEvent);

    // Scenario: Event is fetched and cached at OpenSea level
    fetchedEventsCache.put(eventKey, true);

    // Event goes through Twitter filtering and is determined to be relevant
    // Event is added to tweet queue, but tweeting fails (network error, rate limit, etc.)
    const tweetSuccessful = false; // Simulate tweet failure

    if (!tweetSuccessful) {
      // Event is NOT added to tweeted cache because it failed
      // This is correct behavior - we want to retry failed tweets
    }

    // Later: OpenSea fetches again
    const shouldSkipFetch = fetchedEventsCache.get(eventKey);
    expect(shouldSkipFetch).toBe(true); // Correctly skip re-fetching

    // But Twitter should still be able to retry the tweet
    const shouldSkipTweet = tweetedEventsCache.get(eventKey);
    expect(shouldSkipTweet).toBeUndefined(); // Should be able to retry tweet

    // This demonstrates that the caches serve different purposes:
    // - Fetch cache prevents unnecessary API calls
    // - Tweet cache prevents duplicate successful tweets
  });

  it('should demonstrate queue deduplication scenarios', () => {
    const eventKey = eventKeyFor(mockEvent);

    // Event gets added to tweet queue multiple times due to retries/errors
    const queueItems = [
      { event: mockEvent, attempt: 1 },
      { event: mockEvent, attempt: 2 }, // Retry
      { event: mockEvent, attempt: 3 }, // Another retry
    ];

    // Only the first attempt should be processed
    for (const _item of queueItems) {
      const isAlreadyTweeted = tweetedEventsCache.get(eventKey);

      if (!isAlreadyTweeted) {
        // Process tweet (simulate success on first attempt)
        tweetedEventsCache.put(eventKey, true);
        break;
      }
    }

    // Verify subsequent attempts are blocked
    expect(tweetedEventsCache.get(eventKey)).toBe(true);
  });

  it('should demonstrate event group aggregation deduplication', () => {
    // Create multiple events that could be part of a group
    const groupEvents: OpenSeaAssetEvent[] = [
      {
        ...mockEvent,
        nft: mockEvent.nft
          ? { ...mockEvent.nft, identifier: '1001' }
          : undefined,
      },
      {
        ...mockEvent,
        nft: mockEvent.nft
          ? { ...mockEvent.nft, identifier: '1002' }
          : undefined,
      },
      {
        ...mockEvent,
        nft: mockEvent.nft
          ? { ...mockEvent.nft, identifier: '1003' }
          : undefined,
      },
    ];

    // All events are fetched and cached
    for (const event of groupEvents) {
      const eventKey = eventKeyFor(event);
      fetchedEventsCache.put(eventKey, true);
    }

    // Events are aggregated into a group
    const groupKey = 'group_tx_hash_123';

    // Individual events should not be tweeted if they're part of a group
    // Mark the group as tweeted, but also mark individual events to prevent duplicate processing
    tweetedEventsCache.put(groupKey, true);

    for (const event of groupEvents) {
      const eventKey = eventKeyFor(event);
      tweetedEventsCache.put(eventKey, true);
    }

    // Verify individual events won't be tweeted again
    for (const event of groupEvents) {
      const eventKey = eventKeyFor(event);
      expect(tweetedEventsCache.get(eventKey)).toBe(true);
    }
  });

  it('should demonstrate platform-specific caching needs', () => {
    const eventKey = eventKeyFor(mockEvent);

    // Event is fetched once
    fetchedEventsCache.put(eventKey, true);

    // Different platforms might have different filtering criteria
    const _twitterRelevant = true; // Event matches Twitter filter
    const _discordRelevant = false; // Event doesn't match Discord filter
    const DISCORD_CACHE_SIZE = 500;

    // Twitter processes and tweets the event (since twitterRelevant is true)
    tweetedEventsCache.put(eventKey, true);

    // Discord has its own cache and processing logic
    const discordCache = new LRUCache<string, boolean>(DISCORD_CACHE_SIZE);

    // Discord event would be processed here if relevant
    // Since discordRelevant is false, we don't add to Discord cache

    // Each platform maintains its own processing state
    expect(fetchedEventsCache.get(eventKey)).toBe(true); // Event was fetched
    expect(tweetedEventsCache.get(eventKey)).toBe(true); // Event was tweeted
    expect(discordCache.get(eventKey)).toBeUndefined(); // Event was not posted to Discord

    // This shows why platform-specific caches are necessary
    // Each platform has different timing, retries, and success criteria
  });

  it('should demonstrate memory efficiency of separate caches', () => {
    const OPENSEA_CACHE_SIZE = 1000;
    const TWITTER_CACHE_SIZE = 2000;

    // OpenSea cache: Shorter retention, higher capacity for API deduplication
    const openSeaCache = new LRUCache<string, boolean>(OPENSEA_CACHE_SIZE);

    // Twitter cache: Longer retention, focused on tweet deduplication
    const twitterCache = new LRUCache<string, boolean>(TWITTER_CACHE_SIZE);

    // This separation allows for different cache policies:
    // - OpenSea cache can be smaller since it only needs to prevent duplicate API calls within a short window
    // - Twitter cache can be larger to prevent accidental duplicate tweets over a longer period

    expect(openSeaCache).toBeDefined();
    expect(twitterCache).toBeDefined();

    // Different cache sizes reflect different use cases and requirements
  });
});
