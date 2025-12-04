import { jest } from "@jest/globals";
import type { OpenSeaAssetEvent, OpenSeaNFT } from "../src/types";

// ============================================================================
// Test Addresses
// ============================================================================

export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
export const TEST_ADDRESS_1 = "0x1111110000000000000000000000000000000000";
export const TEST_ADDRESS_2 = "0x2222220000000000000000000000000000000000";
export const TEST_ADDRESS_3 = "0x3333330000000000000000000000000000000000";
export const TEST_BURNER = "0xbbbbbb0000000000000000000000000000000000";
export const TEST_MAKER = "0x9999990000000000000000000000000000000000";

// ============================================================================
// Minimal NFT for quick test events
// ============================================================================

export const minimalNFT = (
  identifier: string,
  overrides?: Partial<OpenSeaNFT>
): OpenSeaNFT =>
  ({
    identifier,
    opensea_url: `https://opensea.io/assets/ethereum/0x123/${identifier}`,
    ...overrides,
  }) as OpenSeaNFT;

// ============================================================================
// Quick Event Builders (minimal required fields)
// ============================================================================

const baseEvent = {
  chain: "ethereum",
  quantity: 1,
} as const;

export const quickMintEvent = (
  identifier: string,
  toAddress = TEST_ADDRESS_1,
  timestamp = 1
): OpenSeaAssetEvent =>
  ({
    ...baseEvent,
    event_type: "transfer",
    event_timestamp: timestamp,
    from_address: NULL_ADDRESS,
    to_address: toAddress,
    nft: minimalNFT(identifier),
  }) as OpenSeaAssetEvent;

export const quickBurnEvent = (
  identifier: string,
  fromAddress = TEST_BURNER,
  timestamp = 1
): OpenSeaAssetEvent =>
  ({
    ...baseEvent,
    event_type: "transfer",
    event_timestamp: timestamp,
    from_address: fromAddress,
    to_address: DEAD_ADDRESS,
    nft: minimalNFT(identifier),
  }) as OpenSeaAssetEvent;

export const quickTransferEvent = (
  identifier: string,
  fromAddress = TEST_ADDRESS_1,
  toAddress = TEST_ADDRESS_2,
  timestamp = 1
): OpenSeaAssetEvent =>
  ({
    ...baseEvent,
    event_type: "transfer",
    event_timestamp: timestamp,
    from_address: fromAddress,
    to_address: toAddress,
    nft: minimalNFT(identifier),
  }) as OpenSeaAssetEvent;

export const quickSaleEvent = (
  identifier: string,
  buyer = TEST_ADDRESS_1,
  timestamp = 1,
  priceWei = "1000000000000000000"
): OpenSeaAssetEvent =>
  ({
    ...baseEvent,
    event_type: "sale",
    event_timestamp: timestamp,
    buyer,
    payment: {
      quantity: priceWei,
      decimals: 18,
      symbol: "ETH",
      token_address: "",
    },
    nft: minimalNFT(identifier, { name: `Test NFT #${identifier}` }),
  }) as OpenSeaAssetEvent;

export const quickOfferEvent = (
  identifier: string,
  maker = TEST_MAKER,
  timestamp = 1
): OpenSeaAssetEvent =>
  ({
    ...baseEvent,
    event_type: "offer",
    event_timestamp: timestamp,
    order_type: "item_offer",
    maker,
    expiration_date: Math.floor(Date.now() / 1000) + 3600,
    payment: {
      quantity: "1000000000000000",
      decimals: 18,
      symbol: "ETH",
      token_address: "",
    },
    nft: minimalNFT(identifier),
  }) as OpenSeaAssetEvent;

export const quickListingEvent = (
  identifier: string,
  maker = TEST_MAKER,
  timestamp = 1
): OpenSeaAssetEvent =>
  ({
    ...baseEvent,
    event_type: "listing",
    event_timestamp: timestamp,
    order_type: "listing",
    maker,
    expiration_date: Math.floor(Date.now() / 1000) + 3600,
    payment: {
      quantity: "2000000000000000",
      decimals: 18,
      symbol: "ETH",
      token_address: "",
    },
    nft: minimalNFT(identifier),
  }) as OpenSeaAssetEvent;

export const quickERC1155MintEvent = (
  identifier: string,
  toAddress = TEST_ADDRESS_1,
  quantity = 5,
  timestamp = 1
): OpenSeaAssetEvent =>
  ({
    ...baseEvent,
    event_type: "transfer",
    event_timestamp: timestamp,
    quantity,
    from_address: NULL_ADDRESS,
    to_address: toAddress,
    nft: minimalNFT(identifier, { token_standard: "erc1155" }),
  }) as OpenSeaAssetEvent;

// ============================================================================
// Batch Builders
// ============================================================================

export const quickBurnBatch = (
  count: number,
  fromAddress = TEST_BURNER,
  transaction = "0xabc"
): OpenSeaAssetEvent[] =>
  Array.from({ length: count }, (_, i) => ({
    ...quickBurnEvent(String(i + 1), fromAddress, i + 1),
    transaction,
  }));

export const quickMintBatch = (
  count: number,
  toAddress = TEST_ADDRESS_1,
  baseTimestamp = 1
): OpenSeaAssetEvent[] =>
  Array.from({ length: count }, (_, i) =>
    quickMintEvent(String(i + 1), toAddress, baseTimestamp + i)
  );

// ============================================================================
// Mock Channel Type
// ============================================================================

export type MockChannel = {
  send: jest.Mock;
  id: string;
  isTextBased: () => boolean;
  isSendable: () => boolean;
};

// ============================================================================
// Mock Factories
// ============================================================================

/**
 * Creates a Discord.js mock with channel tracking
 */
export const createDiscordMock = (channelsMap: Record<string, MockChannel>) => {
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
};

/**
 * Creates a Twitter API v2 mock
 */
export const createTwitterMock = () => {
  const uploadMedia = jest.fn(async () => "media-id");
  const tweet = jest.fn(async () => ({ data: { id: "1", text: "ok" } }));
  const readWrite = { v1: { uploadMedia }, v2: { tweet } };
  const TwitterApi = jest.fn().mockImplementation(() => ({ readWrite }));
  return { TwitterApi, __mockReadWrite: readWrite };
};

/**
 * Creates an OpenSea module mock
 */
export const createOpenSeaMock = (
  usernameImpl: (addr: string) => Promise<string> = async () => "user"
) => ({
  opensea: {
    api: "https://api.opensea.io/api/v2/",
    collectionURL: () => "https://opensea.io/collection/test",
    getEvents: () => "https://api.opensea.io/api/v2/events/collection/test",
    getContract: () =>
      "https://api.opensea.io/api/v2/chain/ethereum/contract/0x",
    getAccount: (address: string) =>
      `https://api.opensea.io/api/v2/accounts/${address}`,
    getNFT: (tokenId: number) =>
      `https://api.opensea.io/api/v2/nfts/${tokenId}`,
    GET_OPTS: { method: "GET", headers: { Accept: "application/json" } },
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
  username: jest.fn(usernameImpl),
  getCollectionSlug: jest.fn(() => "test-collection"),
  fetchNFT: jest.fn(async () => {
    // No-op mock
  }),
});

/**
 * Creates a utils module mock (no timeouts, mock image fetch)
 */
export const createUtilsMock = () => {
  const actual =
    jest.requireActual<typeof import("../src/utils/utils")>(
      "../src/utils/utils"
    );
  return {
    ...actual,
    fetchImageBuffer: jest.fn(async () => ({
      buffer: Buffer.from([1, 2, 3]),
      mimeType: "image/png",
    })),
    timeout: jest.fn(() => Promise.resolve()),
  } satisfies typeof import("../src/utils/utils");
};

// ============================================================================
// Environment Setup Helpers
// ============================================================================

export const setupDiscordEnv = () => {
  process.env.DISCORD_TOKEN = "x";
};

export const setupTwitterEnv = () => {
  process.env.TWITTER_CONSUMER_KEY = "x";
  process.env.TWITTER_CONSUMER_SECRET = "y";
  process.env.TWITTER_ACCESS_TOKEN = "z";
  process.env.TWITTER_ACCESS_TOKEN_SECRET = "w";
};

export const setupTwitterTestEnv = () => {
  setupTwitterEnv();
  process.env.TWITTER_QUEUE_DELAY_MS = "0";
  process.env.TWITTER_EVENT_GROUP_SETTLE_MS = "0";
  process.env.TWITTER_EVENT_GROUP_MIN_GROUP_SIZE = "2";
};

export const setupAllPlatformEnv = () => {
  setupDiscordEnv();
  setupTwitterEnv();
};

// ============================================================================
// Test Helper: Get Twitter Mock Calls
// ============================================================================

export type TwitterMockModule = {
  __mockReadWrite: {
    v1: { uploadMedia: jest.Mock };
    v2: { tweet: jest.Mock };
  };
};

export const getTwitterMock = (): TwitterMockModule =>
  require("twitter-api-v2") as TwitterMockModule;

export const getTweetCalls = (): Array<{ text: string }> => {
  const m = getTwitterMock();
  return (m.__mockReadWrite.v2.tweet as jest.Mock).mock.calls.map(
    (call) => call[0] as { text: string }
  );
};

export const getTweetTexts = (): string[] =>
  getTweetCalls().map((call) => call.text);

// ============================================================================
// Channels Map Helper
// ============================================================================

export const createChannelsMap = (): Record<string, MockChannel> => ({});

export const clearChannelsMap = (
  channelsMap: Record<string, MockChannel>
): void => {
  for (const key of Object.keys(channelsMap)) {
    delete channelsMap[key];
  }
};
