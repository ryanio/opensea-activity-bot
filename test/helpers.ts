import type { OpenSeaAssetEvent } from "../src/types";

// ============================================================================
// Test Event Builders
// Based on fixture data from OpenSea API in `test/fixtures/opensea`
// ============================================================================

/**
 * Creates a mint transfer event (from null address)
 */
export const createMintEvent = (
  identifier: string,
  toAddress: string,
  timestamp: number
): OpenSeaAssetEvent => ({
  event_type: "transfer",
  event_timestamp: timestamp,
  chain: "ethereum",
  quantity: 1,
  transaction: `0xmint${identifier}`,
  from_address: "0x0000000000000000000000000000000000000000",
  to_address: toAddress,
  nft: {
    identifier,
    collection: "test-collection",
    contract: "0x123",
    token_standard: "erc721",
    name: `Test NFT #${identifier}`,
    description: "Test NFT",
    image_url: `https://example.com/${identifier}.png`,
    display_image_url: `https://example.com/${identifier}.png`,
    display_animation_url: null,
    metadata_url: null,
    opensea_url: `https://opensea.io/assets/ethereum/0x123/${identifier}`,
    updated_at: "2023-01-01T00:00:00Z",
    is_disabled: false,
    is_nsfw: false,
  },
});

/**
 * Creates a burn transfer event (to dead address)
 */
export const createBurnEvent = (
  identifier: string,
  fromAddress: string,
  timestamp: number
): OpenSeaAssetEvent => ({
  event_type: "transfer",
  event_timestamp: timestamp,
  chain: "ethereum",
  quantity: 1,
  transaction: `0xburn${identifier}`,
  from_address: fromAddress,
  to_address: "0x000000000000000000000000000000000000dead",
  nft: {
    identifier,
    collection: "test-collection",
    contract: "0x123",
    token_standard: "erc721",
    name: `Test NFT #${identifier}`,
    description: "Test NFT",
    image_url: `https://example.com/${identifier}.png`,
    display_image_url: `https://example.com/${identifier}.png`,
    display_animation_url: null,
    metadata_url: null,
    opensea_url: `https://opensea.io/assets/ethereum/0x123/${identifier}`,
    updated_at: "2023-01-01T00:00:00Z",
    is_disabled: false,
    is_nsfw: false,
  },
});

/**
 * Creates a regular transfer event (not mint or burn)
 */
export const createTransferEvent = (
  identifier: string,
  fromAddress: string,
  toAddress: string,
  timestamp: number
): OpenSeaAssetEvent => ({
  event_type: "transfer",
  event_timestamp: timestamp,
  chain: "ethereum",
  quantity: 1,
  transaction: `0xtransfer${identifier}`,
  from_address: fromAddress,
  to_address: toAddress,
  nft: {
    identifier,
    collection: "test-collection",
    contract: "0x123",
    token_standard: "erc721",
    name: `Test NFT #${identifier}`,
    description: "Test NFT",
    image_url: `https://example.com/${identifier}.png`,
    display_image_url: `https://example.com/${identifier}.png`,
    display_animation_url: null,
    metadata_url: null,
    opensea_url: `https://opensea.io/assets/ethereum/0x123/${identifier}`,
    updated_at: "2023-01-01T00:00:00Z",
    is_disabled: false,
    is_nsfw: false,
  },
});

/**
 * Creates a sale event
 */
export const createSaleEvent = (
  identifier: string,
  buyer: string,
  seller: string,
  priceWei: string
): OpenSeaAssetEvent => ({
  event_type: "sale",
  event_timestamp: Date.now(),
  transaction: `0xsale${identifier}`,
  order_hash: `0xorder${identifier}`,
  protocol_address: "0x0000000000000068f116a894984e2db1123eb395",
  chain: "ethereum",
  payment: {
    quantity: priceWei,
    token_address: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    symbol: "ETH",
  },
  closing_date: Date.now(),
  seller,
  buyer,
  quantity: 1,
  nft: {
    identifier,
    collection: "test-collection",
    contract: "0x123",
    token_standard: "erc721",
    name: `Test NFT #${identifier}`,
    description: "Test NFT",
    image_url: `https://example.com/${identifier}.png`,
    display_image_url: `https://example.com/${identifier}.png`,
    display_animation_url: null,
    metadata_url: null,
    opensea_url: `https://opensea.io/assets/ethereum/0x123/${identifier}`,
    updated_at: "2023-01-01T00:00:00Z",
    is_disabled: false,
    is_nsfw: false,
  },
});

/**
 * Creates an ERC1155 sale event with multiple editions
 */
export const createERC1155SaleEvent = (
  identifier: string,
  buyer: string,
  seller: string,
  priceWei: string
): OpenSeaAssetEvent => {
  const baseEvent = createSaleEvent(identifier, buyer, seller, priceWei);
  return {
    ...baseEvent,
    quantity: 1,
    nft: {
      identifier,
      collection: "test-collection",
      contract: "0x123",
      token_standard: "erc1155",
      name: `Test NFT #${identifier}`,
      description: "Test NFT",
      image_url: `https://example.com/${identifier}.png`,
      display_image_url: `https://example.com/${identifier}.png`,
      display_animation_url: null,
      metadata_url: null,
      opensea_url: `https://opensea.io/assets/ethereum/0x123/${identifier}`,
      updated_at: "2023-01-01T00:00:00Z",
      is_disabled: false,
      is_nsfw: false,
    },
  };
};

/**
 * Creates an offer order event
 */
export const createOfferEvent = (
  identifier: string,
  maker: string,
  timestamp: number
): OpenSeaAssetEvent => ({
  event_type: "offer",
  event_timestamp: timestamp,
  order_hash: `0xoffer${identifier}`,
  order_type: "criteria_offer",
  chain: "ethereum",
  protocol_address: "0x0000000000000068f116a894984e2db1123eb395",
  maker,
  payment: {
    quantity: "1000000000000000",
    token_address: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    symbol: "WETH",
  },
  quantity: 1,
  nft: {
    identifier,
    collection: "test-collection",
    contract: "0x123",
    token_standard: "erc721",
    name: `Test NFT #${identifier}`,
    description: "Test NFT",
    image_url: `https://example.com/${identifier}.png`,
    display_image_url: `https://example.com/${identifier}.png`,
    display_animation_url: null,
    metadata_url: null,
    opensea_url: `https://opensea.io/assets/ethereum/0x123/${identifier}`,
    updated_at: "2023-01-01T00:00:00Z",
    is_disabled: false,
    is_nsfw: false,
  },
});

/**
 * Creates a listing order event
 */
export const createListingEvent = (
  identifier: string,
  maker: string,
  timestamp: number
): OpenSeaAssetEvent => ({
  event_type: "listing",
  event_timestamp: timestamp,
  order_hash: `0xlisting${identifier}`,
  order_type: "listing",
  chain: "ethereum",
  protocol_address: "0x0000000000000068f116a894984e2db1123eb395",
  maker,
  payment: {
    quantity: "2000000000000000",
    token_address: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    symbol: "ETH",
  },
  quantity: 1,
  nft: {
    identifier,
    collection: "test-collection",
    contract: "0x123",
    token_standard: "erc721",
    name: `Test NFT #${identifier}`,
    description: "Test NFT",
    image_url: `https://example.com/${identifier}.png`,
    display_image_url: `https://example.com/${identifier}.png`,
    display_animation_url: null,
    metadata_url: null,
    opensea_url: `https://opensea.io/assets/ethereum/0x123/${identifier}`,
    updated_at: "2023-01-01T00:00:00Z",
    is_disabled: false,
    is_nsfw: false,
  },
});

// ============================================================================
// Fixture Data (based on real OpenSea API responses)
// ============================================================================

/**
 * GlyphBot NFT from fixtures
 */
export const GLYPHBOT_NFT = {
  identifier: "9933",
  collection: "glyphbots",
  contract: "0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075",
  token_standard: "erc721" as const,
  name: "GlyphBot #9933 - Neon the Gentle",
  description:
    "Onchain text robots assembled from Unicode glyphs. Deterministic per tokenId.",
  image_url:
    "https://raw2.seadn.io/ethereum/0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075/0077809d059943b9d2ffb6c08afcbd/c70077809d059943b9d2ffb6c08afcbd.svg",
  display_image_url:
    "https://raw2.seadn.io/ethereum/0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075/0077809d059943b9d2ffb6c08afcbd/c70077809d059943b9d2ffb6c08afcbd.svg",
  display_animation_url: null,
  metadata_url: null,
  opensea_url:
    "https://opensea.io/assets/ethereum/0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075/9933",
  updated_at: "2025-08-29T19:10:39.907681",
  is_disabled: false,
  is_nsfw: false,
};

/**
 * Sample sale event from fixtures
 */
export const FIXTURE_SALE_EVENT: OpenSeaAssetEvent = {
  event_type: "sale",
  event_timestamp: 1_756_492_379,
  transaction:
    "0xc2cddd634ddfe6c6e5d3f9f5f4f73d669787b4b7ce91bb30b91dca7ed06ea31d",
  order_hash:
    "0x72f9de4cf6826cd799bd72e927a66963d14e2da49ceee8a4f14f4d9ed79d5ab9",
  protocol_address: "0x0000000000000068f116a894984e2db1123eb395",
  chain: "ethereum",
  payment: {
    quantity: "520000000000000",
    token_address: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    symbol: "ETH",
  },
  closing_date: 1_756_492_379,
  seller: "0xfebb9ead7c0ea188822731887d078dc9d560c748",
  buyer: "0x6b5566150d8671adfcf6304a4190f176f65188e9",
  quantity: 1,
  nft: GLYPHBOT_NFT,
};

/**
 * Sample transfer event from fixtures
 */
export const FIXTURE_TRANSFER_EVENT: OpenSeaAssetEvent = {
  event_type: "transfer",
  event_timestamp: 1_756_492_379,
  transaction:
    "0xc2cddd634ddfe6c6e5d3f9f5f4f73d669787b4b7ce91bb30b91dca7ed06ea31d",
  chain: "ethereum",
  from_address: "0xfebb9ead7c0ea188822731887d078dc9d560c748",
  to_address: "0x6b5566150d8671adfcf6304a4190f176f65188e9",
  nft: GLYPHBOT_NFT,
  quantity: 1,
};

// ============================================================================
// Test Addresses
// ============================================================================

export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
export const TEST_BUYER_1 = "0x6b5566150d8671adfcf6304a4190f176f65188e9";
export const TEST_SELLER_1 = "0xfebb9ead7c0ea188822731887d078dc9d560c748";
export const TEST_MINTER_1 = "0x0ff01f45d1182d0bbed1cdeca3d2fa04a418b9f0";
export const TEST_BURNER_1 = "0xf4fae83ce8b2f8a968947c13f247f47c840f58a7";

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Creates a batch of sale events with the same buyer and transaction
 */
export const createSaleBatch = (
  count: number,
  buyer: string,
  transaction: string
): OpenSeaAssetEvent[] =>
  Array.from({ length: count }, (_, i) => ({
    ...createSaleEvent(
      String(i + 1),
      buyer,
      `0xseller${i}`,
      "1000000000000000" // 0.001 ETH
    ),
    transaction,
  }));

/**
 * Creates a batch of mint events with the same recipient
 */
export const createMintBatch = (
  count: number,
  toAddress: string,
  baseTimestamp: number
): OpenSeaAssetEvent[] =>
  Array.from({ length: count }, (_, i) =>
    createMintEvent(String(i + 1), toAddress, baseTimestamp)
  );

/**
 * Creates a batch of burn events with the same burner
 */
export const createBurnBatch = (
  count: number,
  fromAddress: string,
  baseTimestamp: number
): OpenSeaAssetEvent[] =>
  Array.from({ length: count }, (_, i) =>
    createBurnEvent(String(i + 1), fromAddress, baseTimestamp)
  );

/**
 * Creates a batch of offer events with the same maker
 */
export const createOfferBatch = (
  count: number,
  maker: string,
  baseTimestamp: number
): OpenSeaAssetEvent[] =>
  Array.from({ length: count }, (_, i) =>
    createOfferEvent(String(i + 1), maker, baseTimestamp)
  );

/**
 * Creates a batch of listing events with the same maker
 */
export const createListingBatch = (
  count: number,
  maker: string,
  baseTimestamp: number
): OpenSeaAssetEvent[] =>
  Array.from({ length: count }, (_, i) =>
    createListingEvent(String(i + 1), maker, baseTimestamp)
  );
