import type { OpenSeaAssetEvent } from "../src/types";
import { eventKeyFor } from "../src/utils/event-grouping";
import { LRUCache } from "../src/utils/lru-cache";

// Import JSON fixture
const salesFixture = require("./fixtures/opensea/events-sales.json");

describe("Event Deduplication System", () => {
  describe("Event Key Generation", () => {
    it("should generate consistent event keys for the same event", () => {
      // Use real event from fixture
      const event = salesFixture.asset_events[0] as OpenSeaAssetEvent;

      const key1 = eventKeyFor(event);
      const key2 = eventKeyFor(event);

      expect(key1).toBe(key2);
      expect(key1).toBe(
        `${event.event_timestamp}|${event.nft?.identifier}|${event.event_type}`
      );
    });

    it("should generate different keys for different events", () => {
      const events = salesFixture.asset_events as OpenSeaAssetEvent[];
      const keys = events.map(eventKeyFor);

      // All keys should be unique (assuming different events in fixture)
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it("should handle events without nft.identifier", () => {
      const event: Partial<OpenSeaAssetEvent> = {
        event_timestamp: 1_756_492_379,
        event_type: "sale",
        // No nft field
      };

      const key = eventKeyFor(event as OpenSeaAssetEvent);
      expect(key).toBe("1756492379||sale");
    });
  });

  describe("OpenSea Fetch Cache", () => {
    const CACHE_SIZE = 100;
    let fetchCache: LRUCache<string, boolean>;

    beforeEach(() => {
      fetchCache = new LRUCache<string, boolean>(CACHE_SIZE);
    });

    it("should prevent duplicate events from being returned", () => {
      const event = salesFixture.asset_events[0] as OpenSeaAssetEvent;
      const eventKey = eventKeyFor(event);

      // First time - event should be processed
      expect(fetchCache.get(eventKey)).toBeUndefined();
      fetchCache.put(eventKey, true);

      // Second time - event should be filtered out
      expect(fetchCache.get(eventKey)).toBe(true);
    });

    it("should handle cache eviction properly", () => {
      const smallCache = new LRUCache<string, boolean>(2);

      smallCache.put("event1", true);
      smallCache.put("event2", true);
      smallCache.put("event3", true); // Should evict event1

      expect(smallCache.get("event1")).toBeUndefined();
      expect(smallCache.get("event2")).toBe(true);
      expect(smallCache.get("event3")).toBe(true);
    });
  });

  describe("Twitter Tweet Cache", () => {
    const CACHE_SIZE = 100;
    let tweetCache: LRUCache<string, boolean>;

    beforeEach(() => {
      tweetCache = new LRUCache<string, boolean>(CACHE_SIZE);
    });

    it("should prevent duplicate tweets", () => {
      const event = salesFixture.asset_events[0] as OpenSeaAssetEvent;
      const eventKey = eventKeyFor(event);

      // First tweet attempt
      expect(tweetCache.get(eventKey)).toBeUndefined();

      // After successful tweet
      tweetCache.put(eventKey, true);

      // Subsequent attempts should be blocked
      expect(tweetCache.get(eventKey)).toBe(true);
    });
  });

  describe("Cache Independence", () => {
    it("should demonstrate that both caches serve different purposes", () => {
      const CACHE_SIZE = 100;
      const fetchCache = new LRUCache<string, boolean>(CACHE_SIZE);
      const tweetCache = new LRUCache<string, boolean>(CACHE_SIZE);
      const event = salesFixture.asset_events[0] as OpenSeaAssetEvent;
      const eventKey = eventKeyFor(event);

      // Scenario 1: Event fetched but not yet tweeted
      fetchCache.put(eventKey, true);
      expect(fetchCache.get(eventKey)).toBe(true);
      expect(tweetCache.get(eventKey)).toBeUndefined();

      // Event would be filtered from subsequent fetches but could still be tweeted

      // Scenario 2: Event successfully tweeted
      tweetCache.put(eventKey, true);
      expect(fetchCache.get(eventKey)).toBe(true);
      expect(tweetCache.get(eventKey)).toBe(true);

      // Now both caches prevent reprocessing
    });

    it("should handle tweet failure scenarios", () => {
      const CACHE_SIZE = 100;
      const fetchCache = new LRUCache<string, boolean>(CACHE_SIZE);
      const tweetCache = new LRUCache<string, boolean>(CACHE_SIZE);
      const event = salesFixture.asset_events[0] as OpenSeaAssetEvent;
      const eventKey = eventKeyFor(event);

      // Event is fetched and cached
      fetchCache.put(eventKey, true);

      // Tweet fails - event is NOT added to tweet cache
      // (this is what the current implementation does)

      // On retry, event won't be re-fetched (good)
      expect(fetchCache.get(eventKey)).toBe(true);

      // But tweet can be retried (good)
      expect(tweetCache.get(eventKey)).toBeUndefined();

      // After successful retry
      tweetCache.put(eventKey, true);
      expect(tweetCache.get(eventKey)).toBe(true);
    });
  });
});
