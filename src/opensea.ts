import { URLSearchParams } from 'node:url';
import { FixedNumber } from 'ethers';
import { channelsWithEvents } from './discord';
import { logger } from './logger';
import { LRUCache } from './lru-cache';
import {
  BotEvent,
  botEventSet,
  type OpenSeaAccount,
  type OpenSeaAssetEvent,
  type OpenSeaContractResponse,
  type OpenSeaEventsResponse,
} from './types';
import { chain, minOfferETH, shortAddr, unixTimestamp } from './utils';

const {
  OPENSEA_API_TOKEN,
  TOKEN_ADDRESS,
  TWITTER_EVENTS,
  LAST_EVENT_TIMESTAMP,
  QUERY_LIMIT,
} = process.env;

let lastEventTimestamp = unixTimestamp(new Date());
if (LAST_EVENT_TIMESTAMP) {
  logger.info(`Using LAST_EVENT_TIMESTAMP: ${LAST_EVENT_TIMESTAMP}`);
  lastEventTimestamp = Number.parseInt(LAST_EVENT_TIMESTAMP, 10);
}

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

export const EventType = {
  order: 'order',
  listing: 'listing',
  offer: 'offer',
  sale: 'sale',
  cancel: 'cancel',
  transfer: 'transfer',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

const enabledEventTypes = (): string[] => {
  const eventTypes = new Set<string>();
  // Include any Discord-declared event types verbatim (Discord supports 'order')
  for (const [_channelId, discordEventTypes] of channelsWithEvents()) {
    for (const eventType of discordEventTypes) {
      eventTypes.add(eventType);
    }
  }

  // Parse and validate TWITTER_EVENTS: only allow listing|offer|sale|transfer
  const rawTwitter = (TWITTER_EVENTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (rawTwitter.length > 0) {
    const invalid = rawTwitter.filter((t) => !botEventSet.has(t));
    if (invalid.length > 0) {
      throw new Error(
        `Invalid TWITTER_EVENTS value(s): ${invalid.join(
          ', '
        )}. Allowed: ${Object.values(BotEvent).join(', ')}`
      );
    }
    // Map listing/offer into OpenSea 'order' event_type
    if (
      rawTwitter.includes(BotEvent.listing) ||
      rawTwitter.includes(BotEvent.offer)
    ) {
      eventTypes.add('order');
    }
    if (rawTwitter.includes(BotEvent.sale)) {
      eventTypes.add('sale');
    }
    if (rawTwitter.includes(BotEvent.transfer)) {
      eventTypes.add('transfer');
    }
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
  logger.info(`Getting collection slug for ${address} on chain ${chain}…`);
  const url = opensea.getContract();
  const result = await openseaGet<OpenSeaContractResponse>(url);
  if (!result?.collection) {
    throw new Error(`No collection found for ${address} on chain ${chain}`);
  }
  logger.info(`Got collection slug: ${result.collection}`);
  collectionSlug = result.collection;
  return result.collection;
};

export const fetchEvents = async (): Promise<OpenSeaAssetEvent[]> => {
  await fetchCollectionSlug(TOKEN_ADDRESS ?? '');

  logger.info('Fetching events');

  const eventTypes = enabledEventTypes();
  const DEFAULT_QUERY_LIMIT = 50;
  const params: Record<string, string> = {
    limit: (QUERY_LIMIT ?? DEFAULT_QUERY_LIMIT).toString(),
    after: lastEventTimestamp.toString(),
  };
  const urlParams = new URLSearchParams(params);
  for (const eventType of eventTypes) {
    urlParams.append('event_type', eventType);
  }

  const url = `${opensea.getEvents()}?${urlParams}`;
  const result = await openseaGet<OpenSeaEventsResponse>(url);

  if (!result?.asset_events) {
    logger.warn('No asset_events found in response');
    return [];
  }

  let events = result.asset_events;

  // Reverse so that oldest events are messaged first
  events = events.reverse();

  // Update last seen event
  if (events.length > 0) {
    const lastEvent = events.at(-1);
    if (lastEvent) {
      lastEventTimestamp = lastEvent.event_timestamp;
    }
  }

  // Filter out private listings
  events = events.filter((event) => {
    if (event.order_type === EventType.listing && event.is_private_listing) {
      return false;
    }
    return true;
  });

  const eventsPreFilter = events.length;
  logger.info(`Fetched events: ${eventsPreFilter}`);

  // Filter out low value offers
  events = events.filter((event) => {
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

  const eventsPostFilter = events.length;
  const eventsFiltered = eventsPreFilter - eventsPostFilter;
  if (eventsFiltered > 0) {
    logger.info(
      `Offers under ${minOfferETH} ETH filtered out: ${eventsFiltered}`
    );
  }

  return events;
};
