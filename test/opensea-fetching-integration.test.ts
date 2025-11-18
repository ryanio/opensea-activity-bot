import type { OpenSeaAssetEvent } from "../src/types";
import { eventKeyFor } from "../src/utils/event-grouping";
import { LRUCache } from "../src/utils/lru-cache";

// Import JSON fixture
const salesFixture = require("./fixtures/opensea/events-sales.json");

describe("OpenSea Fetching Integration", () => {
  const CACHE_SIZE = 1000;
  let fetchedEventsCache: LRUCache<string, boolean>;
  let lastEventTimestamp: number;

  beforeEach(() => {
    fetchedEventsCache = new LRUCache<string, boolean>(CACHE_SIZE);
    lastEventTimestamp = 0;
  });

  const simulateFetchEvents = (
    apiResponse: OpenSeaAssetEvent[]
  ): OpenSeaAssetEvent[] => {
    // Simulate the filtering logic from src/opensea.ts
    let events = [...apiResponse];

    // Reverse so that oldest events are processed first
    events = events.reverse();

    // Update last seen event timestamp
    if (events.length > 0) {
      const lastEvent = events.at(-1);
      if (lastEvent) {
        // Increment by 1 to ensure we don't fetch events with the same timestamp again
        lastEventTimestamp = lastEvent.event_timestamp + 1;
      }
    }

    // Filter out events that have already been fetched/processed
    const eventsPreDedup = events.length;
    events = events.filter((event) => {
      const eventKey = eventKeyFor(event);
      if (fetchedEventsCache.get(eventKey)) {
        return false; // Already seen this event
      }
      // Mark as seen
      fetchedEventsCache.put(eventKey, true);
      return true;
    });

    // Track deduplicated events (for logging/debugging if needed)
    const eventsDeduplicated = eventsPreDedup - events.length;
    if (eventsDeduplicated > 0) {
      // Events were deduplicated
    }

    return events;
  };

  it("should prevent duplicate events on repeated API calls", () => {
    const apiEvents = salesFixture.asset_events as OpenSeaAssetEvent[];

    // First fetch - should return all events
    const firstFetch = simulateFetchEvents(apiEvents);
    expect(firstFetch.length).toBe(apiEvents.length);

    // Second fetch with same data - should return no events (all deduplicated)
    const secondFetch = simulateFetchEvents(apiEvents);
    expect(secondFetch.length).toBe(0);

    // Verify cache has entries
    for (const event of apiEvents) {
      const eventKey = eventKeyFor(event);
      expect(fetchedEventsCache.get(eventKey)).toBe(true);
    }
  });

  it("should handle mixed new and duplicate events", () => {
    const apiEvents = salesFixture.asset_events as OpenSeaAssetEvent[];
    const halfEvents = apiEvents.slice(0, Math.floor(apiEvents.length / 2));

    // First fetch with half the events
    const firstFetch = simulateFetchEvents(halfEvents);
    expect(firstFetch.length).toBe(halfEvents.length);

    // Second fetch with all events (includes previously seen ones)
    const secondFetch = simulateFetchEvents(apiEvents);
    const expectedNewEvents = apiEvents.length - halfEvents.length;
    expect(secondFetch.length).toBe(expectedNewEvents);
  });

  it("should properly update lastEventTimestamp", () => {
    const apiEvents = salesFixture.asset_events as OpenSeaAssetEvent[];
    const initialTimestamp = lastEventTimestamp;

    simulateFetchEvents(apiEvents);

    // Should be updated to last event timestamp + 1
    const expectedTimestamp =
      Math.max(...apiEvents.map((e) => e.event_timestamp)) + 1;
    expect(lastEventTimestamp).toBe(expectedTimestamp);
    expect(lastEventTimestamp).toBeGreaterThan(initialTimestamp);
  });

  it("should handle events with same timestamp correctly", () => {
    // Create events with identical timestamps
    const baseEvent = salesFixture.asset_events[0] as OpenSeaAssetEvent;
    const EXPECTED_EVENT_COUNT = 3;
    const eventsWithSameTimestamp: OpenSeaAssetEvent[] = [
      {
        ...baseEvent,
        nft: baseEvent.nft
          ? { ...baseEvent.nft, identifier: "1001" }
          : undefined,
      },
      {
        ...baseEvent,
        nft: baseEvent.nft
          ? { ...baseEvent.nft, identifier: "1002" }
          : undefined,
      },
      {
        ...baseEvent,
        nft: baseEvent.nft
          ? { ...baseEvent.nft, identifier: "1003" }
          : undefined,
      },
    ];

    // First fetch should return all events
    const firstFetch = simulateFetchEvents(eventsWithSameTimestamp);
    expect(firstFetch.length).toBe(EXPECTED_EVENT_COUNT);

    // Second fetch should return none (all cached)
    const secondFetch = simulateFetchEvents(eventsWithSameTimestamp);
    expect(secondFetch.length).toBe(0);

    // Timestamp should be incremented beyond the common timestamp
    expect(lastEventTimestamp).toBe(baseEvent.event_timestamp + 1);
  });

  it("should demonstrate the fix for the original issue", () => {
    // Simulate the scenario from the user's logs
    const saleEvent: OpenSeaAssetEvent = {
      event_timestamp: 1_726_503_751, // Common timestamp
      event_type: "sale",
      chain: "ethereum",
      quantity: 1,
      nft: {
        identifier: "7691",
        collection: "glyphbots",
        contract: "0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075",
        token_standard: "erc721",
        name: "Prismspark #7691",
        description: "",
        image_url: "",
        display_image_url: "",
        display_animation_url: null,
        metadata_url: null,
        opensea_url: "",
        updated_at: "",
        is_disabled: false,
        is_nsfw: false,
      },
      payment: {
        quantity: "560000000000000",
        token_address: "0x0000000000000000000000000000000000000000",
        decimals: 18,
        symbol: "ETH",
      },
      transaction: "0xtest123",
      buyer: "0xralxz",
      seller: "0xseller",
    };

    // First call - event is new
    let events = simulateFetchEvents([saleEvent]);
    expect(events.length).toBe(1);
    expect(lastEventTimestamp).toBe(saleEvent.event_timestamp + 1);

    // Subsequent calls - event should be filtered out
    const TEST_ITERATIONS = 5;
    for (let i = 0; i < TEST_ITERATIONS; i++) {
      events = simulateFetchEvents([saleEvent]);
      expect(events.length).toBe(0); // Should be 0, not 1 like in the original bug
    }

    // Verify the event is cached
    const eventKey = eventKeyFor(saleEvent);
    expect(fetchedEventsCache.get(eventKey)).toBe(true);
  });
});
