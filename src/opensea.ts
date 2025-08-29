import { URLSearchParams } from 'node:url';
import { FixedNumber } from 'ethers';
import { channelsWithEvents } from './discord';
import { chain, minOfferETH, openseaGet, unixTimestamp } from './utils';

const {
  OPENSEA_API_TOKEN,
  TOKEN_ADDRESS,
  TWITTER_EVENTS,
  LAST_EVENT_TIMESTAMP,
  QUERY_LIMIT,
} = process.env;

let lastEventTimestamp = unixTimestamp(new Date());
if (LAST_EVENT_TIMESTAMP) {
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
  for (const [_channelId, discordEventTypes] of channelsWithEvents()) {
    for (const eventType of discordEventTypes) {
      eventTypes.add(eventType);
    }
  }
  const twitterEventTypes = TWITTER_EVENTS?.split(',') ?? [];
  if (twitterEventTypes.length > 0) {
    for (const eventType of twitterEventTypes) {
      eventTypes.add(eventType);
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
const fetchCollectionSlug = async (address: string) => {
  if (collectionSlug) {
    return collectionSlug;
  }
  const url = opensea.getContract();
  const result = await openseaGet(url);
  if (!result.collection) {
    throw new Error(`No collection found for ${address} on chain ${chain}`);
  }
  collectionSlug = result.collection;
  return result.collection;
};

export const fetchEvents = async (): Promise<Record<string, unknown>[]> => {
  await fetchCollectionSlug(TOKEN_ADDRESS ?? '');

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
  const result = await openseaGet(url);

  let events = result.asset_events;

  // Reverse so that oldest events are messaged first
  events = events.reverse();

  // Update last seen event
  if (events.length > 0) {
    lastEventTimestamp = events.at(-1).event_timestamp;
  }

  // Filter out private listings
  events = events.filter((event) => {
    if (event.order_type === EventType.listing && event.is_private_listing) {
      return false;
    }
    return true;
  });

  const eventsPreFilter = events.length;

  // Filter out low value offers
  events = events.filter((event) => {
    if (
      event.order_type?.includes('offer') &&
      event.payment.symbol === 'WETH'
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
  if (eventsFiltered > 0 && process.env.DEBUG === 'true') {
    // intentionally left for debug logging in verbose mode
  }

  return events;
};
