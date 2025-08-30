// Shared event selection type for config (do not use TS enum per project rules)

export const BotEvent = {
  listing: 'listing',
  offer: 'offer',
  sale: 'sale',
  transfer: 'transfer',
} as const;

export type BotEvent = (typeof BotEvent)[keyof typeof BotEvent];

export const allBotEvents = [
  BotEvent.listing,
  BotEvent.offer,
  BotEvent.sale,
  BotEvent.transfer,
] as const satisfies readonly BotEvent[];

export const botEventSet: ReadonlySet<string> = new Set(allBotEvents);

// OpenSea API Response Types

export type OpenSeaPayment = {
  quantity: string;
  token_address: string;
  decimals: number;
  symbol: string;
};

export type OpenSeaTrait = {
  trait_type: string;
  display_type: string | null;
  max_value: string | null;
  value: string;
};

export type OpenSeaOwner = {
  address: string;
  quantity: number;
};

export type OpenSeaRarity = {
  strategy_id: string;
  strategy_version: string;
  rank: number;
};

export type OpenSeaNFT = {
  identifier: string;
  collection: string;
  contract: string;
  token_standard: string;
  name: string;
  description: string;
  image_url: string;
  display_image_url: string;
  display_animation_url: string | null;
  metadata_url: string | null;
  opensea_url: string;
  updated_at: string;
  is_disabled: boolean;
  is_nsfw: boolean;
  animation_url?: string | null;
  is_suspicious?: boolean;
  creator?: string;
  traits?: OpenSeaTrait[];
  owners?: OpenSeaOwner[];
  rarity?: OpenSeaRarity;
};

export type OpenSeaAssetEvent = {
  event_type: 'sale' | 'order' | 'transfer' | 'listing' | 'offer' | 'cancel';
  event_timestamp: number;
  transaction?: string;
  order_hash?: string;
  protocol_address?: string;
  chain: string;
  payment?: OpenSeaPayment;
  closing_date?: number;
  seller?: string;
  buyer?: string;
  quantity: number;
  nft?: OpenSeaNFT;
  asset?: OpenSeaNFT;
  order_type?: string;
  start_date?: number;
  expiration_date?: number;
  maker?: string;
  taker?: string;
  criteria?: unknown;
  is_private_listing?: boolean;
  from_address?: string;
  to_address?: string;
};

export type OpenSeaEventsResponse = {
  asset_events: OpenSeaAssetEvent[];
  next?: string;
};

export type OpenSeaSocialMediaAccount = {
  platform: string;
  username: string;
};

export type OpenSeaAccount = {
  address: string;
  username?: string;
  profile_image_url?: string;
  banner_image_url?: string;
  website?: string;
  social_media_accounts?: OpenSeaSocialMediaAccount[];
  bio?: string;
  joined_date?: string;
};

export type OpenSeaContract = {
  address: string;
  chain: string;
};

export type OpenSeaFee = {
  fee: number;
  recipient: string;
  required: boolean;
};

export type OpenSeaCollectionRarity = {
  calculated_at: string;
  max_rank: number;
  total_supply: number;
  strategy_id: string;
  strategy_version: string;
};

export type OpenSeaCollection = {
  collection: string;
  name: string;
  description: string;
  image_url: string;
  banner_image_url: string;
  owner: string;
  safelist_status: string;
  category: string;
  is_disabled: boolean;
  is_nsfw: boolean;
  trait_offers_enabled: boolean;
  collection_offers_enabled: boolean;
  opensea_url: string;
  project_url: string;
  wiki_url: string;
  discord_url: string;
  telegram_url: string;
  twitter_username: string;
  instagram_username: string;
  contracts: OpenSeaContract[];
  editors: string[];
  fees: OpenSeaFee[];
  rarity: OpenSeaCollectionRarity;
  total_supply: number;
  created_date: string;
  payment_tokens: unknown[];
};

export type OpenSeaNFTResponse = {
  nft: OpenSeaNFT;
};

export type OpenSeaContractResponse = {
  collection: string;
};

export type OpenSeaListingItem = {
  itemType: number;
  token: string;
  identifierOrCriteria: string;
  startAmount: string;
  endAmount: string;
  recipient?: string;
};

export type OpenSeaListingParameters = {
  offerer: string;
  offer: OpenSeaListingItem[];
  consideration: OpenSeaListingItem[];
  startTime: string;
  endTime: string;
  orderType: number;
  zone: string;
  zoneHash: string;
  salt: string;
  conduitKey: string;
  totalOriginalConsiderationItems: number;
  counter: number;
};

export type OpenSeaListingProtocolData = {
  parameters: OpenSeaListingParameters;
  signature: string | null;
};

export type OpenSeaListing = {
  created_date: string;
  closing_date: string;
  listing_time: number;
  expiration_time: number;
  order_hash: string;
  protocol_data: OpenSeaListingProtocolData;
  protocol_address: string;
  current_price: string;
  maker: OpenSeaAccount;
  taker: OpenSeaAccount | null;
  maker_fees: OpenSeaFee[];
  taker_fees: OpenSeaFee[];
  side: string;
  order_type: string;
  cancelled: boolean;
  finalized: boolean;
  marked_invalid: boolean;
  remaining_quantity: number;
  relay: string;
  criteria?: unknown;
};

export type OpenSeaListingsResponse = {
  orders: OpenSeaListing[];
  next?: string;
};
