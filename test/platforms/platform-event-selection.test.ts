import { jest } from "@jest/globals";
import type { OpenSeaAssetEvent } from "../../src/types";

// Basic env required for platform initialization
process.env.DISCORD_TOKEN = "x";
process.env.TWITTER_CONSUMER_KEY = "x";
process.env.TWITTER_CONSUMER_SECRET = "y";
process.env.TWITTER_ACCESS_TOKEN = "z";
process.env.TWITTER_ACCESS_TOKEN_SECRET = "w";

type MockChannel = {
  send: jest.Mock;
  id: string;
  isTextBased: () => boolean;
  isSendable: () => boolean;
};

const channelsMap: Record<string, MockChannel> = {};

// Minimal Discord.js mock for routing verification
jest.mock("discord.js", () => {
  const Events = { ClientReady: "clientReady" };
  const Client = jest.fn().mockImplementation(
    () =>
      ({
        on: (event: string, cb: () => void) => {
          if (event === Events.ClientReady) {
            cb();
          }
        },
        login: jest.fn(),
        destroy: jest.fn(),
        channels: {
          fetch: (id: string) => {
            if (!channelsMap[id]) {
              channelsMap[id] = {
                send: jest.fn(),
                id,
                isTextBased: () => true,
                isSendable: () => true,
              };
            }
            return Promise.resolve(channelsMap[id]);
          },
        },
      }) as unknown as object
  );

  const EmbedBuilder = jest.fn().mockImplementation(() => {
    const obj = {
      setColor: () => obj,
      setTitle: () => obj,
      setFields: () => obj,
      setURL: () => obj,
      setImage: () => obj,
      setThumbnail: () => obj,
    };
    return obj;
  });

  return { Client, EmbedBuilder, Events };
});

// Stub utils to avoid real timeouts/network image fetches
jest.mock("../../src/utils/utils", () => {
  const actual = jest.requireActual<typeof import("../../src/utils/utils")>(
    "../../src/utils/utils"
  );

  const fetchImageBuffer: typeof actual.fetchImageBuffer = jest.fn(
    async () => ({
      buffer: Buffer.from([1, 2, 3]),
      mimeType: "image/png",
    })
  );

  return {
    ...actual,
    fetchImageBuffer,
    timeout: jest.fn(() => Promise.resolve()),
  } satisfies typeof import("../../src/utils/utils");
});

// Shared OpenSea mock used by both platforms
jest.mock("../../src/opensea", () => ({
  opensea: {
    collectionURL: () => "https://opensea.io/collection/test",
  },
  EventType: {
    listing: "listing",
    offer: "offer",
    trait_offer: "trait_offer",
    collection_offer: "collection_offer",
    mint: "mint",
    sale: "sale",
    transfer: "transfer",
  },
  username: jest.fn(async () => "user"),
  getCollectionSlug: jest.fn(() => "test-collection"),
  fetchNFT: jest.fn(async () => {
    // No-op: avoid network calls when Discord refetches mint metadata in tests
  }),
}));

// Stable Twitter client mock
jest.mock("twitter-api-v2", () => {
  const uploadMedia = jest.fn(async () => "media-id");
  const tweet = jest.fn(async () => ({ data: { id: "1", text: "ok" } }));
  const readWrite = { v1: { uploadMedia }, v2: { tweet } };
  const TwitterApi = jest.fn().mockImplementation(() => ({ readWrite }));
  return { TwitterApi, __mockReadWrite: readWrite };
});

describe("platform event selection independence", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    jest.clearAllMocks();
    for (const key of Object.keys(channelsMap)) {
      delete channelsMap[key];
    }
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("allows Discord and Twitter to listen to different event types independently", async () => {
    // Discord listens only for mints; Twitter listens only for sales
    process.env.DISCORD_EVENTS = "d1=mint";
    process.env.TWITTER_EVENTS = "sale";
    process.env.TWITTER_QUEUE_DELAY_MS = "0";
    process.env.TWITTER_EVENT_GROUP_SETTLE_MS = "60000";
    process.env.TWITTER_EVENT_GROUP_MIN_GROUP_SIZE = "2";

    const baseTimestamp = 1_000_000_000;

    const mintEvent = {
      event_type: "transfer",
      event_timestamp: baseTimestamp,
      chain: "ethereum",
      quantity: 1,
      from_address: "0x0000000000000000000000000000000000000000",
      to_address: "0x1111110000000000000000000000000000000000",
      nft: { identifier: "1", opensea_url: "https://example.com/nft/1" },
    } as unknown as OpenSeaAssetEvent;

    const saleEvent = {
      event_type: "sale",
      event_timestamp: baseTimestamp + 1,
      chain: "ethereum",
      quantity: 1,
      buyer: "0x2222220000000000000000000000000000000000",
      payment: {
        quantity: "1000000000000000000",
        decimals: 18,
        symbol: "ETH",
        token_address: "",
      },
      nft: {
        identifier: "2",
        opensea_url: "https://example.com/nft/2",
        name: "Test NFT #2",
      },
    } as unknown as OpenSeaAssetEvent;

    const { messageEvents } = await import(
      "../../src/platforms/discord/discord"
    );
    const { tweetEvents } = await import("../../src/platforms/twitter/twitter");

    const events = [mintEvent, saleEvent] as OpenSeaAssetEvent[];

    // Twitter processes only the sale event
    tweetEvents(events);
    // Discord processes only the mint event
    await messageEvents(events);

    const twitterModule = require("twitter-api-v2") as {
      __mockReadWrite: { v2: { tweet: jest.Mock } };
    };

    await jest.runAllTimersAsync();

    const tweetMock = twitterModule.__mockReadWrite.v2.tweet as jest.Mock;
    const tweetCalls = tweetMock.mock.calls;

    // Only the sale should be tweeted
    expect(tweetCalls.length).toBe(1);
    const tweetText = (tweetCalls[0][0] as { text: string }).text.toLowerCase();
    expect(tweetText).toContain("purchased");

    // Only the mint should be sent to Discord
    expect(channelsMap.d1.send).toHaveBeenCalledTimes(1);
  });
});
