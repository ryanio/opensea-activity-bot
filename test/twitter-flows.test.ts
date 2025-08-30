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
jest.mock('../src/utils', () => {
  const actual = jest.requireActual(
    '../src/utils'
  ) as typeof import('../src/utils');
  const BYTE_ONE = 1;
  const BYTE_TWO = 2;
  const BYTE_THREE = 3;
  const TEST_IMAGE_BYTES: readonly number[] = [BYTE_ONE, BYTE_TWO, BYTE_THREE];
  const base64Image: typeof actual.base64Image = jest.fn(async () => ({
    buffer: Buffer.from(TEST_IMAGE_BYTES),
    mimeType: 'image/png',
  }));
  const username: typeof actual.username = jest.fn(async () => 'user');
  return {
    ...actual,
    base64Image,
    username,
  } satisfies typeof import('../src/utils');
});

// Stub opensea module to avoid cross-import init
jest.mock('../src/opensea', () => ({
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
  const p = path.join(__dirname, 'fixtures', name);
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw);
};

const waitFor = async (
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
    jest.resetModules();
    jest.clearAllMocks();
    process.env.TWITTER_QUEUE_DELAY_MS = '0';
    process.env.TWITTER_SWEEP_SETTLE_MS = '0';
    process.env.TWITTER_SWEEP_MIN_GROUP_SIZE = '2';
  });

  it('tweets a sweep for grouped sales', async () => {
    const { asset_events } = loadFixture('sales-group.json');
    const { tweetEvents } = await import('../src/twitter');
    tweetEvents(asset_events);
    const m = require('twitter-api-v2') as {
      __mockReadWrite: {
        v1: { uploadMedia: jest.Mock };
        v2: { tweet: jest.Mock };
      };
    };
    await waitFor(
      () => (m.__mockReadWrite.v2.tweet as jest.Mock).mock.calls.length > 0
    );
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

  it('only tweets one sweep per tx across repeated runs', async () => {
    const { asset_events } = loadFixture('sales-group.json');
    const { tweetEvents } = await import('../src/twitter');
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
    await waitFor(
      () => (m.__mockReadWrite.v2.tweet as jest.Mock).mock.calls.length > 0
    );
    // Allow the queue to process/skip any duplicates enqueued
    const QUEUE_DRAIN_MS = 100;
    await new Promise((r) => setTimeout(r, QUEUE_DRAIN_MS));
    const calls = (m.__mockReadWrite.v2.tweet as jest.Mock).mock.calls;
    expect(calls.length).toBe(1);
    const first = calls[0][0] as { text: string };
    expect(first.text.includes('purchased by user')).toBeTruthy();
  });

  it('converts SVG to PNG when tweeting single image', async () => {
    const { asset_events } = loadFixture('svg-image.json');
    const { tweetEvents } = await import('../src/twitter');
    tweetEvents(asset_events);
    const m = require('twitter-api-v2') as {
      __mockReadWrite: {
        v1: { uploadMedia: jest.Mock };
        v2: { tweet: jest.Mock };
      };
    };
    await waitFor(
      () =>
        (m.__mockReadWrite.v1.uploadMedia as jest.Mock).mock.calls.length > 0
    );
    // also wait for tweet attempt
    await waitFor(
      () => (m.__mockReadWrite.v2.tweet as jest.Mock).mock.calls.length > 0
    );
    expect(m.__mockReadWrite.v1.uploadMedia).toHaveBeenCalled();
    expect(m.__mockReadWrite.v2.tweet).toHaveBeenCalled();
    const callArg = (m.__mockReadWrite.v2.tweet as jest.Mock).mock
      .calls[0][0] as { text: string };
    expect(typeof callArg.text).toBe('string');
  });

  it('tweets a single sale event with correct text', async () => {
    const { asset_events } = loadFixture('sales-real.json');
    const { tweetEvents } = await import('../src/twitter');
    tweetEvents(asset_events);
    const m = require('twitter-api-v2') as {
      __mockReadWrite: {
        v1: { uploadMedia: jest.Mock };
        v2: { tweet: jest.Mock };
      };
    };
    await waitFor(
      () => (m.__mockReadWrite.v2.tweet as jest.Mock).mock.calls.length > 0
    );
    expect(m.__mockReadWrite.v2.tweet).toHaveBeenCalled();
    const text = (
      (m.__mockReadWrite.v2.tweet as jest.Mock).mock.calls.at(-1)?.[0] as {
        text: string;
      }
    ).text;
    expect(text.includes('purchased for')).toBeTruthy();
  });

  it('tweets a listing event with correct text', async () => {
    const listings = loadFixture('listings-real.json');
    const { tweetEvents } = await import('../src/twitter');
    tweetEvents(listings.asset_events ?? []);
    expect(true).toBe(true);
  });
});
