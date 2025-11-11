import { URLSearchParams } from 'node:url';
import { FixedNumber } from 'ethers';
import { channelsWithEvents } from './platforms/discord';
import type {
  OpenSeaAccount,
  OpenSeaAssetEvent,
  OpenSeaContractResponse,
  OpenSeaEventsResponse,
  OpenSeaNFT,
  OpenSeaNFTResponse,
} from './types';
import { effectiveEventTypeFor } from './utils/event-types';
import { parseEvents, wantsOpenSeaEventTypes } from './utils/events';
import { logger } from './utils/logger';
import { LRUCache } from './utils/lru-cache';
import { chain, minOfferETH, shortAddr, unixTimestamp } from './utils/utils';

const {
  OPENSEA_API_TOKEN,
  TOKEN_ADDRESS,
  TWITTER_EVENTS,
  LAST_EVENT_TIMESTAMP,
} = process.env;

let lastEventTimestamp = unixTimestamp(new Date());
if (LAST_EVENT_TIMESTAMP) {
  logger.info(`Using LAST_EVENT_TIMESTAMP: ${LAST_EVENT_TIMESTAMP}`);
  lastEventTimestamp = Number.parseInt(LAST_EVENT_TIMESTAMP, 10);
}

// Global event cache to prevent reprocessing the same events
const FETCHED_EVENTS_CACHE_CAPACITY = 1000;
const fetchedEventsCache = new LRUCache<string, boolean>(
  FETCHED_EVENTS_CACHE_CAPACITY
);

// Pagination constants
const SUBSTRING_LENGTH_FOR_CURSOR_LOG = 20;
const MAX_PAGINATION_PAGES = 10;

export const opensea = {
  api: 'https://api.opensea.io/api/v2/',
  collectionURL: () => `https://opensea.io/collection/${collectionSlug}`,
  getEvents: () => `${opensea.api}events/collection/${collectionSlug}`,
  getContract: () => `${opensea.api}chain/${chain}/contract/${TOKEN_ADDRESS}`,
  getAccount: (address: string) => `${opensea.api}accounts/${address}`,
  getNFT: (tokenId: number) =>
    `${opensea.api}chain/${chain}/contract/${TOKEN_ADDRESS}/nfts/${tokenId}`,
  GET_OPTS: {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-API-KEY': OPENSEA_API_TOKEN ?? '',
    } as Record<string, string>,
  } as RequestInit,
};

/**
 * OpenSea utils and helpers
 */
export const openseaGet = async <T = unknown>(
  url: string
): Promise<T | undefined> => {
  try {
    const response = await fetch(url, opensea.GET_OPTS);
    if (!response.ok) {
      logger.error(
        `Fetch Error for ${url} - ${response.status}: ${response.statusText}`,
        process.env.LOG_LEVEL === 'debug' ? await response.text() : undefined
      );
      return;
    }
    const result = (await response.json()) as T;
    return result;
  } catch (error) {
    const message =
      typeof (error as { message?: unknown })?.message === 'string'
        ? (error as { message: string }).message
        : String(error);
    logger.error(`Fetch Error for ${url}: ${message}`);
  }
};

/**
 * Processes an OpenSea user object and returns, in order:
 * 1. An OpenSea username
 * 2. A short formatted address
 */
const USERNAME_CACHE_CAPACITY = 100;
const usernameCache = new LRUCache<string, string>(USERNAME_CACHE_CAPACITY);
const formatUsername = (name: string, address: string) =>
  name === '' ? shortAddr(address) : name;
export const username = async (address: string) => {
  const cached = usernameCache.get(address);
  if (cached) {
    return formatUsername(cached, address);
  }

  const account = await fetchAccount(address);
  const fetchedName = account?.username ?? '';
  usernameCache.put(address, fetchedName);
  return formatUsername(fetchedName, address);
};

const fetchAccount = async (
  address: string
): Promise<OpenSeaAccount | undefined> => {
  const url = opensea.getAccount(address);
  const result = await openseaGet<OpenSeaAccount>(url);
  return result;
};

/**
 * Fetches fresh NFT metadata from OpenSea API by token ID.
 * Useful for mints where metadata may not be immediately available.
 */
export const fetchNFT = async (
  tokenId: string | number
): Promise<OpenSeaNFT | undefined> => {
  const url = opensea.getNFT(Number(tokenId));
  const result = await openseaGet<OpenSeaNFTResponse>(url);
  return result?.nft;
};

export const EventType = {
  listing: 'listing',
  offer: 'offer',
  trait_offer: 'trait_offer',
  collection_offer: 'collection_offer',
  mint: 'mint',
  sale: 'sale',
  transfer: 'transfer',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

const addDiscordDeclaredEventTypes = (set: Set<string>) => {
  for (const [_channelId, discordEventTypes] of channelsWithEvents()) {
    for (const eventType of discordEventTypes) {
      set.add(eventType);
    }
  }
};

const enabledEventTypes = (): string[] => {
  const eventTypes = new Set<string>();
  addDiscordDeclaredEventTypes(eventTypes);

  // Parse TWITTER_EVENTS and map to OpenSea event_type(s)
  const tw = parseEvents(TWITTER_EVENTS);
  const wantedFromTwitter = wantsOpenSeaEventTypes(tw);
  for (const t of wantedFromTwitter) {
    eventTypes.add(t);
  }

  if (eventTypes.size === 0) {
    throw new Error(
      'No events enabled. Please specify DISCORD_EVENTS or TWITTER_EVENTS'
    );
  }
  return [...eventTypes];
};

let collectionSlug: string;
const fetchCollectionSlug = async (address: string): Promise<string> => {
  if (collectionSlug) {
    return collectionSlug;
  }
  logger.info(`🔍 Fetching collection metadata for ${address} on ${chain}...`);
  const url = opensea.getContract();
  const result = await openseaGet<OpenSeaContractResponse>(url);
  if (!result?.collection) {
    logger.error(`❌ No collection found for ${address} on chain ${chain}`);
    throw new Error(`No collection found for ${address} on chain ${chain}`);
  }
  logger.info(`✅ Collection identified: ${result.collection}`);
  collectionSlug = result.collection;
  return result.collection;
};

export const getCollectionSlug = (): string => {
  return collectionSlug;
};

const filterPrivateListings = (
  events: OpenSeaAssetEvent[]
): OpenSeaAssetEvent[] => {
  return events.filter((event) => {
    if (event.order_type === EventType.listing && event.is_private_listing) {
      return false;
    }
    return true;
  });
};

const filterLowValueOffers = (
  events: OpenSeaAssetEvent[]
): {
  filtered: OpenSeaAssetEvent[];
  count: number;
} => {
  const preFilter = events.length;
  const filtered = events.filter((event) => {
    if (
      event.order_type?.includes('offer') &&
      event.payment?.symbol === 'WETH'
    ) {
      const offerValue = FixedNumber.fromValue(
        event.payment.quantity,
        event.payment.decimals
      );
      return offerValue.gte(minOfferETH);
    }
    return true;
  });
  return { filtered, count: preFilter - filtered.length };
};

const deduplicateEvents = (
  events: OpenSeaAssetEvent[]
): {
  deduplicated: OpenSeaAssetEvent[];
  count: number;
} => {
  const preDedup = events.length;
  const deduplicated = events.filter((event) => {
    // Use canonical event key so 'mint' and transfer-mint dedupe together
    const nft = (event?.nft ?? event?.asset) as
      | { identifier?: string }
      | undefined;
    const tokenId = String(nft?.identifier ?? '');
    const canonicalType = String(effectiveEventTypeFor(event));
    const eventKey = `${event.event_timestamp}|${tokenId}|${canonicalType}`;
    if (fetchedEventsCache.get(eventKey)) {
      return false;
    }
    fetchedEventsCache.put(eventKey, true);
    return true;
  });
  return { deduplicated, count: preDedup - deduplicated.length };
};

const updateLastEventTimestamp = (events: OpenSeaAssetEvent[]): void => {
  if (events.length > 0) {
    const lastEvent = events.at(-1);
    if (lastEvent) {
      lastEventTimestamp = lastEvent.event_timestamp + 1;
    }
  }
};

const buildEventsUrl = (): string => {
  const eventTypes = enabledEventTypes();
  const OPENSEA_MAX_LIMIT = 200;
  const params: Record<string, string> = {
    limit: OPENSEA_MAX_LIMIT.toString(),
    after: lastEventTimestamp.toString(),
  };
  const urlParams = new URLSearchParams(params);
  // Map internal/event selection to API-supported event_type filters
  // - "burn" is derived from "transfer" so request "transfer"
  // - "mint" is first-class and can be requested directly
  const apiEventTypes = new Set<string>();
  for (const eventType of eventTypes) {
    if (eventType === 'burn') {
      apiEventTypes.add(EventType.transfer);
      continue;
    }
    apiEventTypes.add(eventType);
  }
  for (const apiType of apiEventTypes) {
    urlParams.append('event_type', apiType);
  }
  return `${opensea.getEvents()}?${urlParams}`;
};

const processEventFilters = (
  events: OpenSeaAssetEvent[]
): OpenSeaAssetEvent[] => {
  let processed = filterPrivateListings(events);

  const { filtered: afterOfferFilter, count: lowValueCount } =
    filterLowValueOffers(processed);
  processed = afterOfferFilter;

  if (lowValueCount > 0) {
    logger.info(
      `🔽 Filtered ${lowValueCount} low-value offer${lowValueCount === 1 ? '' : 's'} (< ${minOfferETH} ETH)`
    );
  }

  const { deduplicated: finalEvents, count: dupeCount } =
    deduplicateEvents(processed);
  processed = finalEvents;

  if (dupeCount > 0) {
    logger.info(`Events deduplicated: ${dupeCount}`);
  }

  if (processed.length > 0) {
    logger.info(
      `✨ Processing ${processed.length} new event${processed.length === 1 ? '' : 's'}`
    );
  }

  return processed;
};

export const fetchEvents = async (): Promise<OpenSeaAssetEvent[]> => {
  await fetchCollectionSlug(TOKEN_ADDRESS ?? '');

  const url = buildEventsUrl();
  let result = await openseaGet<OpenSeaEventsResponse>(url);

  if (!result?.asset_events) {
    logger.warn('⚠️  No asset_events found in API response');
    return [];
  }

  let allEvents = [...result.asset_events];
  logger.info(`Fetched events: ${allEvents.length}`);

  // Pagination: if there's a 'next' cursor, fetch more pages
  let pagesFollowed = 0;

  while (result?.next && pagesFollowed < MAX_PAGINATION_PAGES) {
    pagesFollowed += 1;
    const nextUrl = `${opensea.getEvents()}?${result.next}`;
    const cursorPreview = result.next.slice(0, SUBSTRING_LENGTH_FOR_CURSOR_LOG);
    logger.debug(
      `Fetching page ${pagesFollowed + 1} (cursor: ${cursorPreview}...)`
    );

    result = await openseaGet<OpenSeaEventsResponse>(nextUrl);

    if (result?.asset_events && result.asset_events.length > 0) {
      allEvents = [...allEvents, ...result.asset_events];
      logger.info(
        `Fetched events: ${result.asset_events.length} (total: ${allEvents.length})`
      );
    } else {
      break;
    }
  }

  if (pagesFollowed > 0) {
    const totalPages = pagesFollowed + 1;
    const pluralSuffix = pagesFollowed > 0 ? 's' : '';
    logger.info(
      `📄 Fetched ${totalPages} page${pluralSuffix} (${allEvents.length} total events)`
    );
  }

  const events = allEvents.reverse();
  updateLastEventTimestamp(events);

  return processEventFilters(events);
};
