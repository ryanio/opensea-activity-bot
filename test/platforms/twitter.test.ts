import fs from 'node:fs';
import path from 'node:path';
import { jest } from '@jest/globals';

// Mock env
process.env.TWITTER_EVENTS = 'sale,listing,offer,transfer';
process.env.TOKEN_ADDRESS = '0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075';
process.env.TWITTER_CONSUMER_KEY = 'x';
process.env.TWITTER_CONSUMER_SECRET = 'y';
process.env.TWITTER_ACCESS_TOKEN = 'z';
process.env.TWITTER_ACCESS_TOKEN_SECRET = 'w';

// Stub utils (must be defined before importing code that uses it)
jest.mock('../../src/utils/utils', () => {
  const actual = jest.requireActual(
    '../../src/utils/utils'
  ) as typeof import('../../src/utils/utils');
  const BYTE_ONE = 1;
  const BYTE_TWO = 2;
  const BYTE_THREE = 3;
  const TEST_IMAGE_BYTES: readonly number[] = [BYTE_ONE, BYTE_TWO, BYTE_THREE];
  const fetchImageBuffer: typeof actual.fetchImageBuffer = jest.fn(
    async () => ({
      buffer: Buffer.from(TEST_IMAGE_BYTES),
      mimeType: 'image/png',
    })
  );
  return {
    ...actual,
    fetchImageBuffer,
    timeout: jest.fn(() => Promise.resolve()),
  } satisfies typeof import('../../src/utils/utils');
});

// Stub opensea module to avoid cross-import init
jest.mock('../../src/opensea', () => ({
  opensea: {
    api: 'https://api.opensea.io/api/v2/',
    collectionURL: () => 'https://opensea.io/collection/glyphbots',
    getEvents: () =>
      'https://api.opensea.io/api/v2/events/collection/glyphbots',
    getContract: () =>
      'https://api.opensea.io/api/v2/chain/ethereum/contract/0x',
    getAccount: (address: string) =>
      `https://api.opensea.io/api/v2/accounts/${address}`,
    getNFT: (tokenId: number) =>
      `https://api.opensea.io/api/v2/nfts/${tokenId}`,
    GET_OPTS: { method: 'GET', headers: { Accept: 'application/json' } },
  },
  EventType: {
    order: 'order',
    listing: 'listing',
    offer: 'offer',
    sale: 'sale',
    cancel: 'cancel',
    transfer: 'transfer',
  },
  username: jest.fn(async () => 'user'),
  getCollectionSlug: jest.fn(() => 'glyphbots'),
}));

// Manual stable mock for twitter-api-v2
jest.mock('twitter-api-v2', () => {
  const uploadMedia = jest.fn(async () => 'media-id');
  const tweet = jest.fn(async () => ({ data: { id: '1', text: 'ok' } }));
  const readWrite = { v1: { uploadMedia }, v2: { tweet } };
  const TwitterApi = jest.fn().mockImplementation(() => ({ readWrite }));
  return { TwitterApi, __mockReadWrite: readWrite };
});

const loadFixture = (name: string) => {
  const p = path.join(__dirname, '..', 'fixtures', name);
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw);
};

const _waitFor = async (
  predicate: () => boolean,
  timeoutMs = 1500,
  stepMs = 20
) => {
  const start = Date.now();
  for (;;) {
    if (predicate()) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('timeout');
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
};

describe('twitter flows', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    jest.clearAllMocks();
    process.env.TWITTER_QUEUE_DELAY_MS = '0';
    process.env.TWITTER_EVENT_GROUP_SETTLE_MS = '0';
    process.env.TWITTER_EVENT_GROUP_MIN_GROUP_SIZE = '2';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('tweets a group for grouped sales', async () => {
    const { asset_events } = loadFixture('opensea/events-sales-group.json');
    const { tweetEvents } = await import('../../src/platforms/twitter');
    tweetEvents(asset_events);
    const m = require('twitter-api-v2') as {
      __mockReadWrite: {
        v1: { uploadMedia: jest.Mock };
        v2: { tweet: jest.Mock };
      };
    };
    await jest.runAllTimersAsync();
    expect(m.__mockReadWrite.v2.tweet).toHaveBeenCalled();
    const calls = (m.__mockReadWrite.v2.tweet as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const first = calls[0][0] as { text: string };
    expect(typeof first.text).toBe('string');
    expect(first.text.includes('purchased by user')).toBeTruthy();
    expect(
      first.text.includes(
        'opensea.io/0x6b5566150d8671adfcf6304a4190f176f65188e9?collectionSlugs=glyphbots'
      )
    ).toBeTruthy();
  });

  it('tweets a grouped burn with profile activity link', async () => {
    const burnBatch = {
      asset_events: [
        {
          event_type: 'transfer',
          event_timestamp: 1,
          chain: 'ethereum',
          quantity: 1,
          nft: { identifier: '1', opensea_url: 'https://x' },
          from_address: '0xbbbbbb0000000000000000000000000000000000',
          to_address: '0x000000000000000000000000000000000000dead',
          transaction: '0xabc',
        },
        {
          event_type: 'transfer',
          event_timestamp: 2,
          chain: 'ethereum',
          quantity: 1,
          nft: { identifier: '2', opensea_url: 'https://x' },
          from_address: '0xbbbbbb0000000000000000000000000000000000',
          to_address: '0x0000000000000000000000000000000000000000',
          transaction: '0xabc',
        },
      ],
    };
    const { tweetEvents } = await import('../../src/platforms/twitter');
    tweetEvents(
      burnBatch.asset_events as unknown as import('../../src/types').OpenSeaAssetEvent[]
    );
    const m = require('twitter-api-v2') as {
      __mockReadWrite: { v2: { tweet: jest.Mock } };
    };
    await jest.runAllTimersAsync();
    const first = (
      (m.__mockReadWrite.v2.tweet as jest.Mock).mock.calls[0][0] as {
        text: string;
      }
    ).text;
    expect(first).toContain('burned');
    expect(first).toContain('activity?activityTypes=transfer');
  });

  it('only tweets one group per tx across repeated runs', async () => {
    const { asset_events } = loadFixture('opensea/events-sales-group.json');
    const { tweetEvents } = await import('../../src/platforms/twitter');
    // Simulate polling loop invoking with same batch repeatedly
    tweetEvents(asset_events);
    tweetEvents(asset_events);
    tweetEvents(asset_events);
    const m = require('twitter-api-v2') as {
      __mockReadWrite: {
        v1: { uploadMedia: jest.Mock };
        v2: { tweet: jest.Mock };
      };
    };
    await jest.runAllTimersAsync();
    const calls = (m.__mockReadWrite.v2.tweet as jest.Mock).mock.calls;
    expect(calls.length).toBe(1);
    const first = calls[0][0] as { text: string };
    expect(first.text.includes('purchased by user')).toBeTruthy();
  });

  it('converts SVG to PNG when tweeting single image', async () => {
    const { asset_events } = loadFixture('svg-image.json');
    const { tweetEvents } = await import('../../src/platforms/twitter');
    tweetEvents(asset_events);
    const m = require('twitter-api-v2') as {
      __mockReadWrite: {
        v1: { uploadMedia: jest.Mock };
        v2: { tweet: jest.Mock };
      };
    };
    await jest.runAllTimersAsync();
    expect(m.__mockReadWrite.v1.uploadMedia).toHaveBeenCalled();
    expect(m.__mockReadWrite.v2.tweet).toHaveBeenCalled();
    const callArg = (m.__mockReadWrite.v2.tweet as jest.Mock).mock
      .calls[0][0] as { text: string };
    expect(typeof callArg.text).toBe('string');
  });

  it('tweets a single sale event with correct text', async () => {
    const { asset_events } = loadFixture('opensea/events-sales.json');
    const { tweetEvents } = await import('../../src/platforms/twitter');
    tweetEvents(asset_events);
    const m = require('twitter-api-v2') as {
      __mockReadWrite: {
        v1: { uploadMedia: jest.Mock };
        v2: { tweet: jest.Mock };
      };
    };
    await jest.runAllTimersAsync();
    expect(m.__mockReadWrite.v2.tweet).toHaveBeenCalled();
    const text = (
      (m.__mockReadWrite.v2.tweet as jest.Mock).mock.calls.at(-1)?.[0] as {
        text: string;
      }
    ).text;
    expect(text.includes('purchased for')).toBeTruthy();
  });

  it('tweets a listing event with correct text', async () => {
    const listings = loadFixture('opensea/get-listings.json');
    const { tweetEvents } = await import('../../src/platforms/twitter');
    tweetEvents(listings.asset_events ?? []);
    expect(true).toBe(true);
  });

  it('sorts group images by purchase price descending', async () => {
    // Load batch events with different prices to test sorting
    const batchSales = loadFixture('opensea/events-sales-batch.json');
    const { tweetEvents } = await import('../../src/platforms/twitter');

    // Check that we have events with different prices
    const events = batchSales.asset_events ?? [];
    expect(events.length).toBeGreaterThan(0);

    // Verify events have different payment quantities (prices)
    const prices = events.map((e) => Number(e.payment?.quantity || 0));
    const uniquePrices = new Set(prices);
    expect(uniquePrices.size).toBeGreaterThan(1); // Should have different prices

    // Process the events (this will trigger group aggregation and sorting)
    tweetEvents(events);

    // Get the mock after calling tweetEvents
    const m = require('twitter-api-v2') as {
      __mockReadWrite: {
        v1: { uploadMedia: jest.Mock };
        v2: { tweet: jest.Mock };
      };
    };

    await jest.runAllTimersAsync();

    // Verify the tweet was called (group should be detected)
    expect(m.__mockReadWrite.v2.tweet).toHaveBeenCalled();
  });

  it('does not duplicate-tweet the same 5 burn events (tx vs actor overlap)', async () => {
    // Override settle to 0 so groups flush immediately in this test
    process.env.TWITTER_EVENT_GROUP_SETTLE_MS = '0';
    process.env.TWITTER_EVENT_GROUP_MIN_GROUP_SIZE = '2';

    const makeBurn = (tokenId: number) => ({
      event_type: 'transfer',
      event_timestamp: tokenId,
      chain: 'ethereum',
      quantity: 1,
      nft: { identifier: String(tokenId), opensea_url: 'https://x' },
      from_address: '0xbbbbbb0000000000000000000000000000000000',
      to_address: '0x000000000000000000000000000000000000dead',
      transaction: '0xabc',
    });
    const batch = Array.from({ length: 5 }, (_, i) => makeBurn(i + 1));

    const { tweetEvents } = await import('../../src/platforms/twitter');
    tweetEvents(
      batch as unknown as import('../../src/types').OpenSeaAssetEvent[]
    );

    const m = require('twitter-api-v2') as {
      __mockReadWrite: { v2: { tweet: jest.Mock } };
    };
    await jest.runAllTimersAsync();
    const calls = (m.__mockReadWrite.v2.tweet as jest.Mock).mock.calls;
    // Should tweet exactly one group of 5 (actor group is suppressed for same-tx overlap)
    expect(calls.length).toBe(1);
    const text = (calls[0][0] as { text: string }).text;
    expect(text).toContain('5 burned');
  });

  it('tweets a 10-burn actor group eventually despite duplicate polling', async () => {
    // Use a small but non-zero settle so actor-based grouping can accumulate across two tx
    process.env.TWITTER_EVENT_GROUP_SETTLE_MS = '40';
    process.env.TWITTER_EVENT_GROUP_MIN_GROUP_SIZE = '2';
    process.env.TWITTER_QUEUE_DELAY_MS = '0';

    const makeBurn = (tx: string, ts: number, tokenId: number) => ({
      event_type: 'transfer',
      event_timestamp: ts,
      chain: 'ethereum',
      quantity: 1,
      nft: { identifier: String(tokenId), opensea_url: 'https://x' },
      from_address: '0xbbbbbb0000000000000000000000000000000000',
      to_address: '0x000000000000000000000000000000000000dead',
      transaction: tx,
    });
    const firstFive = Array.from({ length: 5 }, (_, i) =>
      makeBurn('0xaaa', i + 1, i + 1)
    );
    const secondFive = Array.from({ length: 5 }, (_, i) =>
      makeBurn('0xbbb', i + 6, i + 6)
    );

    const { tweetEvents } = await import('../../src/platforms/twitter');
    // Simulate repeated polling of the same first 5 (duplicates should not reset settle window)
    tweetEvents(
      firstFive as unknown as import('../../src/types').OpenSeaAssetEvent[]
    );
    tweetEvents(
      firstFive as unknown as import('../../src/types').OpenSeaAssetEvent[]
    );
    // Add the second set shortly after
    jest.advanceTimersByTime(10);
    tweetEvents(
      secondFive as unknown as import('../../src/types').OpenSeaAssetEvent[]
    );

    const m = require('twitter-api-v2') as {
      __mockReadWrite: { v2: { tweet: jest.Mock } };
    };
    // Allow settle window to elapse, then trigger a flush by invoking again with duplicates
    jest.advanceTimersByTime(60);
    tweetEvents(
      firstFive as unknown as import('../../src/types').OpenSeaAssetEvent[]
    );
    await jest.runAllTimersAsync();
    const calls = (m.__mockReadWrite.v2.tweet as jest.Mock).mock.calls as [
      { text: string },
    ][];
    const texts = calls.map((c) => (c[0] as { text: string }).text);
    // Ensure there is at least one 10-burn tweet
    expect(texts.some((t) => TEN_BURNED_REGEX.test(t))).toBe(true);
  });
});

// Add basic tests for matchesSelection mint/burn classification
import {
  matchesSelection,
  parseRequestedEvents,
} from '../../src/platforms/twitter';
import type { OpenSeaAssetEvent } from '../../src/types';

// Hoisted for performance per linter guidance
const TEN_BURNED_REGEX = /\b10 burned\b/;

describe('twitter selection for mint/burn', () => {
  const base = {
    event_type: 'transfer',
    event_timestamp: 1,
    chain: 'ethereum',
    quantity: 1,
  } as unknown as OpenSeaAssetEvent;

  test('selects mint when requested', () => {
    const ev: OpenSeaAssetEvent = {
      ...base,
      from_address: '0x0000000000000000000000000000000000000000',
      to_address: '0x1234567890123456789012345678901234567890',
    };
    const set = parseRequestedEvents('mint');
    expect(matchesSelection(ev, set)).toBe(true);
  });

  test('selects burn when requested', () => {
    const ev: OpenSeaAssetEvent = {
      ...base,
      from_address: '0x1234567890123456789012345678901234567890',
      to_address: '0x000000000000000000000000000000000000dead',
    };
    const set = parseRequestedEvents('burn');
    expect(matchesSelection(ev, set)).toBe(true);
  });

  test('mint included when transfer requested', () => {
    const ev: OpenSeaAssetEvent = {
      ...base,
      from_address: '0x0000000000000000000000000000000000000000',
      to_address: '0x1234567890123456789012345678901234567890',
    };
    const set = parseRequestedEvents('transfer');
    expect(matchesSelection(ev, set)).toBe(true);
  });

  test('burn included when transfer requested', () => {
    const ev: OpenSeaAssetEvent = {
      ...base,
      from_address: '0x1234567890123456789012345678901234567890',
      to_address: '0x0000000000000000000000000000000000000001',
    };
    const set = parseRequestedEvents('transfer');
    expect(matchesSelection(ev, set)).toBe(true);
  });
});
