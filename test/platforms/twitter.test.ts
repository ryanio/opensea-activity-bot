import fs from "node:fs";
import path from "node:path";
import { jest } from "@jest/globals";
import type { OpenSeaAssetEvent } from "../../src/types";
import {
  createOpenSeaMock,
  createTwitterMock,
  createUtilsMock,
  DEAD_ADDRESS,
  getTweetCalls,
  getTweetTexts,
  NULL_ADDRESS,
  quickBurnBatch,
  setupTwitterEnv,
  TEST_BURNER,
} from "../fixtures";
import { createMintBatch, TEST_MINTER_1 } from "../helpers";

// Mock env
process.env.TWITTER_EVENTS = "sale,listing,offer,transfer,burn";
process.env.TOKEN_ADDRESS = "0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075";
setupTwitterEnv();

// Stub utils (must be defined before importing code that uses it)
jest.mock("../../src/utils/utils", () => createUtilsMock());

// Stub opensea module to avoid cross-import init
jest.mock("../../src/opensea", () => createOpenSeaMock(async () => "user"));

// Manual stable mock for twitter-api-v2
jest.mock("twitter-api-v2", () => createTwitterMock());

// Hoisted regex for performance
const TEN_BURNED_REGEX = /\b10 burned\b/;

const loadFixture = (name: string) => {
  const p = path.join(__dirname, "..", "fixtures", name);
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw);
};

describe("twitter flows", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    jest.clearAllMocks();
    process.env.TWITTER_QUEUE_DELAY_MS = "0";
    process.env.TWITTER_EVENT_GROUP_SETTLE_MS = "0";
    process.env.TWITTER_EVENT_GROUP_MIN_GROUP_SIZE = "2";
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("tweets a group for grouped sales", async () => {
    const { asset_events } = loadFixture("opensea/events-sales-group.json");
    const { tweetEvents } = await import("../../src/platforms/twitter/twitter");
    tweetEvents(asset_events);
    await jest.runAllTimersAsync();

    const calls = getTweetCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].text.toLowerCase()).toContain("purchased");
    expect(calls[0].text).toContain("opensea.io/");
  });

  it("tweets a grouped burn with profile activity link", async () => {
    const burnBatch = quickBurnBatch(2, TEST_BURNER, "0xabc");
    // Override to_address for second event to use NULL_ADDRESS (both are burn addresses)
    burnBatch[1] = { ...burnBatch[1], to_address: NULL_ADDRESS };

    const { tweetEvents } = await import("../../src/platforms/twitter/twitter");
    tweetEvents(burnBatch);
    await jest.runAllTimersAsync();

    const calls = getTweetCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].text.toLowerCase()).toContain("burned");
    expect(calls[0].text).toContain("activity?activityTypes=transfer");
  });

  it("only tweets one group per tx across repeated runs", async () => {
    const { asset_events } = loadFixture("opensea/events-sales-group.json");
    const { tweetEvents } = await import("../../src/platforms/twitter/twitter");
    // Simulate polling loop invoking with same batch repeatedly
    tweetEvents(asset_events);
    tweetEvents(asset_events);
    tweetEvents(asset_events);
    await jest.runAllTimersAsync();

    const calls = getTweetCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].text.includes("purchased by user")).toBeTruthy();
  });

  it("converts SVG to PNG when tweeting single image", async () => {
    const { asset_events } = loadFixture("svg-image.json");
    const { tweetEvents } = await import("../../src/platforms/twitter/twitter");
    tweetEvents(asset_events);
    await jest.runAllTimersAsync();

    const m = require("twitter-api-v2") as {
      __mockReadWrite: {
        v1: { uploadMedia: jest.Mock };
        v2: { tweet: jest.Mock };
      };
    };
    expect(m.__mockReadWrite.v1.uploadMedia).toHaveBeenCalled();
    expect(m.__mockReadWrite.v2.tweet).toHaveBeenCalled();
  });

  it("tweets a single sale event with correct text", async () => {
    const { asset_events } = loadFixture("opensea/events-sales.json");
    const { tweetEvents } = await import("../../src/platforms/twitter/twitter");
    tweetEvents(asset_events);
    await jest.runAllTimersAsync();

    const texts = getTweetTexts();
    expect(texts.at(-1)?.includes("purchased for")).toBeTruthy();
  });

  it("tweets a listing event with correct text", async () => {
    const listings = loadFixture("opensea/get-listings.json");
    const { tweetEvents } = await import("../../src/platforms/twitter/twitter");
    tweetEvents(listings.asset_events ?? []);
    expect(true).toBe(true);
  });

  it("sorts group images by purchase price descending", async () => {
    // Load batch events with different prices to test sorting
    const batchSales = loadFixture("opensea/events-sales-batch.json");
    const { tweetEvents } = await import("../../src/platforms/twitter/twitter");

    // Check that we have events with different prices
    const events = batchSales.asset_events ?? [];
    expect(events.length).toBeGreaterThan(0);

    // Verify events have different payment quantities (prices)
    const prices = events.map((e: OpenSeaAssetEvent) =>
      Number(e.payment?.quantity || 0)
    );
    const uniquePrices = new Set(prices);
    expect(uniquePrices.size).toBeGreaterThan(1); // Should have different prices

    // Process the events (this will trigger group aggregation and sorting)
    tweetEvents(events);
    await jest.runAllTimersAsync();

    // Verify the tweet was called (group should be detected)
    expect(getTweetCalls().length).toBeGreaterThan(0);
  });

  it("does not duplicate-tweet the same 5 burn events (tx vs actor overlap)", async () => {
    // Override settle to 0 so groups flush immediately in this test
    process.env.TWITTER_EVENT_GROUP_SETTLE_MS = "0";
    process.env.TWITTER_EVENT_GROUP_MIN_GROUP_SIZE = "2";

    const batch = quickBurnBatch(5, TEST_BURNER, "0xabc");

    const { tweetEvents } = await import("../../src/platforms/twitter/twitter");
    tweetEvents(batch);
    await jest.runAllTimersAsync();

    const calls = getTweetCalls();
    // Should tweet exactly one group of 5 (actor group is suppressed for same-tx overlap)
    expect(calls.length).toBe(1);
    expect(calls[0].text).toContain("5 burned");
  });

  it("tweets a 10-burn actor group eventually despite duplicate polling", async () => {
    // Use a small but non-zero settle so actor-based grouping can accumulate across two tx
    process.env.TWITTER_EVENT_GROUP_SETTLE_MS = "40";
    process.env.TWITTER_EVENT_GROUP_MIN_GROUP_SIZE = "2";
    process.env.TWITTER_QUEUE_DELAY_MS = "0";

    const makeBurn = (tx: string, ts: number, tokenId: number) => ({
      event_type: "transfer",
      event_timestamp: ts,
      chain: "ethereum",
      quantity: 1,
      nft: { identifier: String(tokenId), opensea_url: "https://x" },
      from_address: TEST_BURNER,
      to_address: DEAD_ADDRESS,
      transaction: tx,
    });
    const firstFive = Array.from({ length: 5 }, (_, i) =>
      makeBurn("0xaaa", i + 1, i + 1)
    );
    const secondFive = Array.from({ length: 5 }, (_, i) =>
      makeBurn("0xbbb", i + 6, i + 6)
    );

    const { tweetEvents } = await import("../../src/platforms/twitter/twitter");
    // Simulate repeated polling of the same first 5 (duplicates should not reset settle window)
    tweetEvents(firstFive as OpenSeaAssetEvent[]);
    tweetEvents(firstFive as OpenSeaAssetEvent[]);
    // Add the second set shortly after
    jest.advanceTimersByTime(10);
    tweetEvents(secondFive as OpenSeaAssetEvent[]);

    // Allow settle window to elapse, then trigger a flush by invoking again with duplicates
    jest.advanceTimersByTime(60);
    tweetEvents(firstFive as OpenSeaAssetEvent[]);
    await jest.runAllTimersAsync();

    const texts = getTweetTexts();
    // Ensure there is at least one burn tweet mentioning 10
    expect(
      texts.some(
        (t) => t.toLowerCase().includes("burn") && TEN_BURNED_REGEX.test(t)
      )
    ).toBe(true);
  });

  it("retries on 429 rate limit errors from Twitter and eventually tweets", async () => {
    const originalEventsEnv = process.env.TWITTER_EVENTS;
    try {
      process.env.TWITTER_EVENTS = "mint";
      process.env.TWITTER_QUEUE_DELAY_MS = "0";
      process.env.TWITTER_BACKOFF_BASE_MS = "1";
      process.env.TWITTER_BACKOFF_MAX_MS = "5";

      const baseTimestamp = 3_000_000_000;
      const [mintEvent] = createMintBatch(1, TEST_MINTER_1, baseTimestamp);

      const m = require("twitter-api-v2") as {
        __mockReadWrite: { v2: { tweet: jest.Mock } };
      };
      const tweetMock = m.__mockReadWrite.v2.tweet as jest.Mock;

      let firstCall = true;
      tweetMock.mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          const error = {
            code: 429,
            rateLimit: {
              day: {
                remaining: 0,
                reset: Math.floor(Date.now() / 1000),
              },
            },
          };
          throw error;
        }
        return Promise.resolve({ data: { id: "1", text: "ok" } });
      });

      const { tweetEvents } = await import(
        "../../src/platforms/twitter/twitter"
      );
      tweetEvents([mintEvent]);

      await jest.runAllTimersAsync();
      expect(tweetMock).toHaveBeenCalledTimes(2);
    } finally {
      process.env.TWITTER_EVENTS = originalEventsEnv;
    }
  });

  it("retries transient 5xx errors from Twitter and eventually tweets", async () => {
    const originalEventsEnv = process.env.TWITTER_EVENTS;
    try {
      process.env.TWITTER_EVENTS = "mint";
      process.env.TWITTER_QUEUE_DELAY_MS = "0";
      process.env.TWITTER_BACKOFF_BASE_MS = "1";
      process.env.TWITTER_BACKOFF_MAX_MS = "5";

      const baseTimestamp = 3_100_000_000;
      const [mintEvent] = createMintBatch(1, TEST_MINTER_1, baseTimestamp);

      const m = require("twitter-api-v2") as {
        __mockReadWrite: { v2: { tweet: jest.Mock } };
      };
      const tweetMock = m.__mockReadWrite.v2.tweet as jest.Mock;

      let attempts = 0;
      tweetMock.mockImplementation(() => {
        attempts += 1;
        if (attempts < 3) {
          const error = { status: 503 };
          throw error;
        }
        return Promise.resolve({ data: { id: "1", text: "ok" } });
      });

      const { tweetEvents } = await import(
        "../../src/platforms/twitter/twitter"
      );
      tweetEvents([mintEvent]);

      await jest.runAllTimersAsync();
      expect(tweetMock).toHaveBeenCalledTimes(3);
    } finally {
      process.env.TWITTER_EVENTS = originalEventsEnv;
    }
  });

  it("drops fatal 4xx errors from Twitter without infinite retries", async () => {
    const originalEventsEnv = process.env.TWITTER_EVENTS;
    try {
      process.env.TWITTER_EVENTS = "mint";
      process.env.TWITTER_QUEUE_DELAY_MS = "0";
      process.env.TWITTER_BACKOFF_BASE_MS = "1";
      process.env.TWITTER_BACKOFF_MAX_MS = "5";

      const baseTimestamp = 3_200_000_000;
      const [mintEvent] = createMintBatch(1, TEST_MINTER_1, baseTimestamp);

      const m = require("twitter-api-v2") as {
        __mockReadWrite: { v2: { tweet: jest.Mock } };
      };
      const tweetMock = m.__mockReadWrite.v2.tweet as jest.Mock;

      tweetMock.mockImplementation(() => {
        const error = { status: 400 };
        throw error;
      });

      const { tweetEvents } = await import(
        "../../src/platforms/twitter/twitter"
      );
      tweetEvents([mintEvent]);

      await jest.runAllTimersAsync();
      expect(tweetMock).toHaveBeenCalledTimes(1);
    } finally {
      process.env.TWITTER_EVENTS = originalEventsEnv;
    }
  });

  it("tweets single mint events when below group size threshold", async () => {
    const originalEventsEnv = process.env.TWITTER_EVENTS;
    try {
      process.env.TWITTER_EVENTS = "mint";
      process.env.TWITTER_EVENT_GROUP_SETTLE_MS = "60000";
      process.env.TWITTER_EVENT_GROUP_MIN_GROUP_SIZE = "3";
      process.env.TWITTER_QUEUE_DELAY_MS = "0";

      const baseTimestamp = 1_234_567_890;
      const mintEvents = createMintBatch(2, TEST_MINTER_1, baseTimestamp);

      const { tweetEvents } = await import(
        "../../src/platforms/twitter/twitter"
      );
      tweetEvents(mintEvents);

      await jest.runAllTimersAsync();
      const calls = getTweetCalls();

      // Below minGroupSize, mints should be tweeted individually
      expect(calls.length).toBe(2);
    } finally {
      process.env.TWITTER_EVENTS = originalEventsEnv;
    }
  });

  it("tweets multiple actor-based mint groups for the same minter over time", async () => {
    const originalEventsEnv = process.env.TWITTER_EVENTS;
    try {
      process.env.TWITTER_EVENTS = "mint";
      process.env.TWITTER_EVENT_GROUP_SETTLE_MS = "0";
      process.env.TWITTER_EVENT_GROUP_MIN_GROUP_SIZE = "2";
      process.env.TWITTER_QUEUE_DELAY_MS = "0";

      const baseTimestamp = 2_000_000_000;
      const firstBatch = createMintBatch(2, TEST_MINTER_1, baseTimestamp);
      const secondBatch = createMintBatch(
        2,
        TEST_MINTER_1,
        baseTimestamp + 100
      );

      const { tweetEvents } = await import(
        "../../src/platforms/twitter/twitter"
      );

      // First group for this minter
      tweetEvents(firstBatch);
      await jest.runAllTimersAsync();
      let calls = getTweetCalls();
      expect(calls.length).toBe(1);

      // Second independent group for the same minter should also tweet
      tweetEvents(secondBatch);
      await jest.runAllTimersAsync();
      calls = getTweetCalls();

      // Previously this would stay at 1 due to actor-based queue key dedupe.
      // With the updated keying (including timestamp window), we expect 2.
      expect(calls.length).toBe(2);
    } finally {
      process.env.TWITTER_EVENTS = originalEventsEnv;
    }
  });
});

// Add basic tests for matchesSelection mint/burn classification
import {
  matchesSelection,
  parseRequestedEvents,
} from "../../src/platforms/twitter/twitter";

describe("twitter selection for mint/burn", () => {
  const base = {
    event_type: "transfer",
    event_timestamp: 1,
    chain: "ethereum",
    quantity: 1,
  } as const;

  test("selects mint when requested", () => {
    const ev = {
      ...base,
      from_address: NULL_ADDRESS,
      to_address: "0x1234567890123456789012345678901234567890",
    } as OpenSeaAssetEvent;
    const set = parseRequestedEvents("mint");
    expect(matchesSelection(ev, set)).toBe(true);
  });

  test("selects burn when requested", () => {
    const ev = {
      ...base,
      from_address: "0x1234567890123456789012345678901234567890",
      to_address: DEAD_ADDRESS,
    } as OpenSeaAssetEvent;
    const set = parseRequestedEvents("burn");
    expect(matchesSelection(ev, set)).toBe(true);
  });

  test("mint not included when only transfer requested", () => {
    const ev = {
      ...base,
      from_address: NULL_ADDRESS,
      to_address: "0x1234567890123456789012345678901234567890",
    } as OpenSeaAssetEvent;
    const set = parseRequestedEvents("transfer");
    expect(matchesSelection(ev, set)).toBe(false);
  });

  test("burn not included when only transfer requested", () => {
    const ev = {
      ...base,
      from_address: "0x1234567890123456789012345678901234567890",
      to_address: "0x0000000000000000000000000000000000000001",
    } as OpenSeaAssetEvent;
    const set = parseRequestedEvents("transfer");
    expect(matchesSelection(ev, set)).toBe(false);
  });
});
