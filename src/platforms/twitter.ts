import { TwitterApi } from 'twitter-api-v2';
import { EventType, opensea, username } from '../opensea';
import type { BotEvent, OpenSeaAssetEvent, OpenSeaPayment } from '../types';
import { txHashFor } from '../utils/aggregator';
import {
  calculateTotalSpent,
  EventGroupManager,
  eventKeyFor,
  type GroupedEvent,
  getDefaultEventGroupConfig,
  groupKindForEvents,
  isGroupedEvent,
  primaryActorAddressForGroup,
  sortEventsByPrice,
} from '../utils/event-grouping';
import { isEventWanted, parseEvents } from '../utils/events';
import {
  openseaCollectionActivityUrl,
  openseaProfileCollectionUrl,
  openseaProfileTransferActivityUrl,
} from '../utils/links';
import { logger } from '../utils/logger';
import { LRUCache } from '../utils/lru-cache';
import { AsyncQueue } from '../utils/queue';
import {
  classifyTransfer,
  fetchImageBuffer,
  formatAmount,
  imageForNFT,
} from '../utils/utils';

const logStart = '[Twitter]';

// In-memory dedupe for tweeted events
const TWEETED_EVENTS_CACHE_CAPACITY = 2000;
const tweetedEventsCache = new LRUCache<string, boolean>(
  TWEETED_EVENTS_CACHE_CAPACITY
);

// Queue + backoff config
const DEFAULT_TWEET_DELAY_MS = 3000;
const DEFAULT_BACKOFF_BASE_MS = 15_000;
const MINUTES = 60;
const MS_PER_SECOND = 1000;
const BACKOFF_MAX_MINUTES = 15;
const DEFAULT_BACKOFF_MAX_MS = BACKOFF_MAX_MINUTES * MINUTES * MS_PER_SECOND;
const PER_TWEET_DELAY_MS = Number(
  process.env.TWITTER_QUEUE_DELAY_MS ?? DEFAULT_TWEET_DELAY_MS
);
const BACKOFF_BASE_MS = Number(
  process.env.TWITTER_BACKOFF_BASE_MS ?? DEFAULT_BACKOFF_BASE_MS
);
const BACKOFF_MAX_MS = Number(
  process.env.TWITTER_BACKOFF_MAX_MS ?? DEFAULT_BACKOFF_MAX_MS
);

type MinimalTwitterClient = {
  v1: {
    uploadMedia: (
      buffer: Buffer,
      opts: { mimeType: string }
    ) => Promise<string>;
  };
  v2: {
    tweet: (params: {
      text: string;
      media?: { media_ids: string[] };
    }) => Promise<unknown>;
  };
};

let twitterClient: MinimalTwitterClient | undefined;
type TweetEvent = OpenSeaAssetEvent | GroupedEvent;
type TweetQueueItem = { event: TweetEvent };

// Initialize event group manager for Twitter
const groupConfig = getDefaultEventGroupConfig('TWITTER');
const groupManager = new EventGroupManager(groupConfig);

// Generic async queue for tweeting
const tweetQueue = new AsyncQueue<TweetQueueItem>({
  perItemDelayMs: PER_TWEET_DELAY_MS,
  backoffBaseMs: BACKOFF_BASE_MS,
  backoffMaxMs: BACKOFF_MAX_MS,
  debug: process.env.LOG_LEVEL === 'debug',
  keyFor: (i) => keyForQueueItem(i),
  isAlreadyProcessed: (key) => tweetedEventsCache.get(key) === true,
  onProcessed: (item) => {
    // Mark the queue key as processed to prevent reprocessing the same group/solo
    const queueKey = keyForQueueItem(item);
    tweetedEventsCache.put(queueKey, true);

    const event = item?.event;
    if (isGroupedEvent(event)) {
      groupManager.markGroupProcessed(event);
    } else if (event) {
      groupManager.markProcessed(event as OpenSeaAssetEvent);
    }
  },
  process: async (item) => {
    if (!twitterClient) {
      throw new Error('twitterClient not initialized');
    }
    try {
      await tweetEvent(twitterClient, item.event);
    } catch (error) {
      const key = keyForQueueItem(item);
      logger.warn(
        `${logStart} Tweet failed for item (key: ${key}). Will classify for retry/drop:`,
        error
      );
      throw error; // let queue classify and decide
    }
  },
  classifyError: (error: unknown) => {
    const err = error as {
      code?: number;
      rateLimit?: { day?: { remaining?: number; reset?: number } };
    };
    const errCode = err?.code;
    const rateLimit = err?.rateLimit;
    const HTTP_TOO_MANY_REQUESTS = 429;
    if (errCode === HTTP_TOO_MANY_REQUESTS) {
      const dayRemaining = rateLimit?.day?.remaining;
      const dayReset = rateLimit?.day?.reset;
      if (dayRemaining === 0 && typeof dayReset === 'number') {
        return {
          type: 'rate_limit',
          pauseUntilMs: (dayReset as number) * MS_PER_SECOND,
        } as const;
      }
      return { type: 'transient' } as const;
    }
    const status =
      (error as { data?: { status?: number }; status?: number })?.data
        ?.status ?? (error as { status?: number })?.status;
    const SERVER_ERROR_MIN = 500;
    if (
      (status as number) >= SERVER_ERROR_MIN ||
      status === 0 ||
      (error as { name?: string })?.name === 'FetchError'
    ) {
      return { type: 'transient' } as const;
    }
    return { type: 'fatal' } as const;
  },
});

const keyForQueueItem = (item: TweetQueueItem): string => {
  const ev = item.event;
  if (isGroupedEvent(ev)) {
    const tx = ev.txHash ?? txHashFor(ev.events?.[0]) ?? 'unknown';
    return `group:${tx}`;
  }
  return eventKeyFor(item.event as OpenSeaAssetEvent);
};

const formatNftName = (
  nft: { name?: string; identifier?: string | number } | undefined
): string => {
  if (!nft) {
    return '';
  }
  const GLYPHBOTS_CONTRACT_ADDRESS =
    '0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075';
  const specialContract =
    process.env.TOKEN_ADDRESS?.toLowerCase() === GLYPHBOTS_CONTRACT_ADDRESS;
  if (specialContract && nft.name && nft.identifier !== undefined) {
    const nameParts = String(nft.name).split(' - ');
    const suffix = nameParts.length > 1 ? nameParts[1].trim() : undefined;
    const idStr = String(nft.identifier);
    return suffix ? `${suffix} #${idStr} ` : `#${idStr} `;
  }
  // For regular NFTs, return the name if available, otherwise the identifier
  return nft.name ? `${nft.name} ` : `#${String(nft.identifier)} `;
};

const formatOrderText = async (
  payment: OpenSeaPayment,
  maker: string,
  order_type: string,
  _expiration_date: number
) => {
  const name = await username(maker);
  const price = formatAmount(
    payment.quantity,
    payment.decimals,
    payment.symbol
  );
  if (order_type === 'listing') {
    return `listed on sale for ${price} by ${name}`;
  }
  if (order_type === 'item_offer') {
    return `has a new offer for ${price} by ${name}`;
  }
  if (order_type === 'collection_offer') {
    return `has a new collection offer for ${price} by ${name}`;
  }
  if (order_type === 'trait_offer') {
    return `has a new trait offer for ${price} by ${name}`;
  }
  return '';
};

const formatSaleText = async (payment: OpenSeaPayment, buyer: string) => {
  const amount = formatAmount(
    payment.quantity,
    payment.decimals,
    payment.symbol
  );
  const name = await username(buyer);
  return `purchased for ${amount} by ${name}`;
};

const formatTransferText = async (event: OpenSeaAssetEvent) => {
  const kind = classifyTransfer(event);
  const from = event.from_address ?? '';
  const to = event.to_address ?? '';
  if (kind === 'mint') {
    const toName = await username(to);
    return `minted by ${toName}`;
  }
  if (kind === 'burn') {
    const fromName = await username(from);
    return `burned by ${fromName}`;
  }
  const fromName = await username(from);
  const toName = await username(to);
  return `transferred from ${fromName} to ${toName}`;
};

const textForOrder = async (params: {
  nft: { name?: string; identifier?: string | number } | undefined;
  payment: OpenSeaPayment;
  maker: string;
  order_type: string;
  expiration_date: number;
}): Promise<string> => {
  const { nft, payment, maker, order_type, expiration_date } = params;
  let text = '';
  if (nft) {
    text += formatNftName(nft);
  }
  text += await formatOrderText(payment, maker, order_type, expiration_date);
  return text;
};

const textForSale = async (params: {
  nft: { name?: string; identifier?: string | number } | undefined;
  payment: OpenSeaPayment;
  buyer: string;
}): Promise<string> => {
  const { nft, payment, buyer } = params;
  let text = '';
  if (nft) {
    text += formatNftName(nft);
  }
  text += await formatSaleText(payment, buyer);
  return text;
};

const textForTransfer = async (
  nft:
    | { name?: string; identifier?: string | number; opensea_url?: string }
    | undefined,
  ev: OpenSeaAssetEvent
): Promise<string> => {
  const kind = classifyTransfer(ev);
  if (kind === 'mint' || kind === 'burn') {
    // Use formatNftName to get the properly formatted name for special collections like glyphbots
    let name = formatNftName(nft).trim();
    if (kind === 'mint') {
      const tokenStandard = (nft as { token_standard?: string } | undefined)
        ?.token_standard;
      const isErc1155 = (tokenStandard ?? '').toLowerCase() === 'erc1155';
      const editions = Number(ev.quantity ?? 0);
      if (isErc1155 && editions > 1) {
        name = `${name} (${editions} editions)`;
      }
    }
    const phrase = await formatTransferText(ev);
    return `${name} ${phrase}`;
  }
  let text = '';
  if (nft) {
    text += formatNftName(nft);
  }
  text += await formatTransferText(ev);
  return text;
};

export const textForTweet = async (event: OpenSeaAssetEvent) => {
  const ev = event;
  const {
    asset,
    event_type,
    payment,
    order_type,
    maker,
    buyer,
    expiration_date,
  } = ev;
  const nft = ev.nft ?? asset;
  let text = '';
  if (process.env.TWITTER_PREPEND_TWEET) {
    text += `${process.env.TWITTER_PREPEND_TWEET} `;
  }
  if (
    event_type === 'order' &&
    payment &&
    maker &&
    order_type &&
    typeof expiration_date === 'number'
  ) {
    text += await textForOrder({
      nft,
      payment,
      maker,
      order_type,
      expiration_date,
    });
  } else if (event_type === EventType.sale && payment && buyer) {
    text += await textForSale({ nft, payment, buyer });
  } else if (event_type === EventType.transfer) {
    text += await textForTransfer(nft, ev);
  }
  if (nft?.identifier) {
    text += ` ${nft.opensea_url}`;
  }
  if (process.env.TWITTER_APPEND_TWEET) {
    text += ` ${process.env.TWITTER_APPEND_TWEET}`;
  }
  return text;
};

// fetchImageBuffer moved to utils

const MAX_MEDIA_IMAGES = 4;

// getPurchasePrice is now imported from event-grouping

const uploadImagesForGroup = async (
  client: MinimalTwitterClient,
  group: OpenSeaAssetEvent[]
): Promise<string[]> => {
  // Sort events by purchase price in descending order before selecting images
  const sortedGroup = sortEventsByPrice(group);

  const images: string[] = [];
  for (const e of sortedGroup) {
    const url = imageForNFT(e.nft ?? e.asset);
    if (url) {
      images.push(url);
    }
    if (images.length >= MAX_MEDIA_IMAGES) {
      break;
    }
  }
  const mediaIds: string[] = [];
  for (const imageUrl of images) {
    try {
      const { buffer, mimeType } = await fetchImageBuffer(imageUrl);
      const id = await client.v1.uploadMedia(buffer, { mimeType });
      mediaIds.push(id);
    } catch (uploadError) {
      logger.warn(
        `${logStart} Group media upload failed; continuing:`,
        uploadError
      );
    }
  }
  return mediaIds;
};

// calculateTotalSpent is now imported from event-grouping

const tweetGroup = async (
  client: MinimalTwitterClient,
  group: OpenSeaAssetEvent[]
) => {
  const count = group.length;
  const mediaIds = await uploadImagesForGroup(client, group);
  const kind = groupKindForEvents(group);
  const buyerAddress = group[0]?.buyer;
  const totalSpent = calculateTotalSpent(group);

  let text = '';
  if (process.env.TWITTER_PREPEND_TWEET) {
    text += `${process.env.TWITTER_PREPEND_TWEET} `;
  }

  const appendBurn = async () => {
    const burnerAddress = primaryActorAddressForGroup(group, 'burn');
    if (burnerAddress) {
      const burnerName = await username(burnerAddress);
      text += `${count} burned by @${burnerName}`;
      const activityUrl = openseaProfileTransferActivityUrl(burnerAddress);
      text += ` ${activityUrl}`;
    } else {
      text += `${count} burned`;
    }
  };

  const appendMint = async () => {
    const minterAddress = primaryActorAddressForGroup(group, 'mint');
    if (minterAddress) {
      const minterName = await username(minterAddress);
      text += `${count} minted by ${minterName}`;
      const profileUrl = openseaProfileCollectionUrl(minterAddress);
      text += ` ${profileUrl}`;
    } else {
      text += `${count} minted`;
    }
  };

  const appendPurchase = async () => {
    if (buyerAddress) {
      const buyerName = await username(buyerAddress);
      text += `${count} purchased by ${buyerName}`;
      if (totalSpent) {
        text += ` for ${totalSpent}`;
      }
      const profileUrl = openseaProfileCollectionUrl(buyerAddress);
      text += ` ${profileUrl}`;
    } else {
      text += `${count} purchased`;
      if (totalSpent) {
        text += ` for ${totalSpent}`;
      }
      const activityUrl = openseaCollectionActivityUrl(opensea.collectionURL());
      text += ` ${activityUrl}`;
    }
  };

  if (kind === 'burn') {
    await appendBurn();
  } else if (kind === 'mint') {
    await appendMint();
  } else {
    await appendPurchase();
  }

  if (process.env.TWITTER_APPEND_TWEET) {
    text += ` ${process.env.TWITTER_APPEND_TWEET}`;
  }
  const params: { text: string; media?: { media_ids: string[] } } =
    mediaIds.length > 0 ? { text, media: { media_ids: mediaIds } } : { text };
  await client.v2.tweet(params);
  for (const e of group) {
    const key = eventKeyFor(e);
    tweetedEventsCache.put(key, true);
  }
  logger.info(`${logStart} 🧹 Tweeted group: ${count} items`);
};

const tweetSingle = async (
  client: MinimalTwitterClient,
  event: OpenSeaAssetEvent
) => {
  let mediaId: string | undefined;
  const image = imageForNFT(event.nft ?? event.asset);
  if (image) {
    try {
      const { buffer, mimeType } = await fetchImageBuffer(image);
      mediaId = await client.v1.uploadMedia(buffer, { mimeType });
    } catch (uploadError) {
      logger.warn(
        `${logStart} Media upload failed, tweeting without media:`,
        uploadError
      );
    }
  }
  const status = await textForTweet(event);
  const tweetParams: { text: string; media?: { media_ids: string[] } } = mediaId
    ? { text: status, media: { media_ids: [mediaId] } }
    : { text: status };
  await client.v2.tweet(tweetParams);
  const key = eventKeyFor(event);
  const MAX_LOG_LENGTH = 80;
  const truncatedStatus = status.slice(0, MAX_LOG_LENGTH);
  const needsTruncation = status.length > MAX_LOG_LENGTH;
  logger.info(
    `${logStart} 🐦 Tweeted: ${truncatedStatus}${needsTruncation ? '...' : ''}`
  );
  logger.debug(`${logStart} Event key: ${key}`);
  tweetedEventsCache.put(key, true);
};

const tweetEvent = async (client: MinimalTwitterClient, event: TweetEvent) => {
  if (isGroupedEvent(event)) {
    await tweetGroup(client, event.events);
    return;
  }
  await tweetSingle(client, event as OpenSeaAssetEvent);
};

const hasTwitterCreds = (): boolean =>
  Boolean(
    process.env.TWITTER_CONSUMER_KEY &&
      process.env.TWITTER_CONSUMER_SECRET &&
      process.env.TWITTER_ACCESS_TOKEN &&
      process.env.TWITTER_ACCESS_TOKEN_SECRET
  );

const ensureTwitterClient = () => {
  if (!twitterClient) {
    twitterClient = new TwitterApi({
      appKey: String(process.env.TWITTER_CONSUMER_KEY),
      appSecret: String(process.env.TWITTER_CONSUMER_SECRET),
      accessToken: String(process.env.TWITTER_ACCESS_TOKEN),
      accessSecret: String(process.env.TWITTER_ACCESS_TOKEN_SECRET),
    }).readWrite as unknown as MinimalTwitterClient;
  }
};

// ---- Selection helpers (top-level to keep tweetEvents complexity low) ----
export const parseRequestedEvents = (raw: string | undefined): Set<BotEvent> =>
  parseEvents(raw);

// Order/transfer matching logic is centralized in utils/events

export const matchesSelection = (
  ev: OpenSeaAssetEvent,
  selectionSet: Set<BotEvent>
): boolean => isEventWanted(ev, selectionSet);

const getTransferKind = (event: OpenSeaAssetEvent): string => {
  const kind = classifyTransfer(event);
  if (kind === 'burn') {
    return 'burn';
  }
  if (kind === 'mint') {
    return 'mint';
  }
  return 'transfer';
};

const logEventBreakdown = (filteredEvents: OpenSeaAssetEvent[]): void => {
  const eventTypeBreakdown = new Map<string, number>();
  for (const event of filteredEvents) {
    const key =
      event.event_type === 'transfer'
        ? getTransferKind(event)
        : event.event_type;
    eventTypeBreakdown.set(key, (eventTypeBreakdown.get(key) ?? 0) + 1);
  }
  const breakdown = Array.from(eventTypeBreakdown.entries())
    .map(([type, count]) => `${type}=${count}`)
    .join(', ');
  logger.debug(`${logStart} Event breakdown: ${breakdown}`);
};

const enqueueGroups = (
  readyGroups: Array<{ tx: string; events: OpenSeaAssetEvent[] }>
): void => {
  for (const { tx, events: evts } of readyGroups) {
    tweetQueue.enqueue({
      event: { kind: 'group', txHash: tx, events: evts },
    });
  }
  if (readyGroups.length > 0) {
    const counts = readyGroups.map((r) => r.events.length).join(',');
    logger.info(
      `${logStart} Group tweeted: ${readyGroups.map((r) => r.events.length).join(', ')} items`
    );
    logger.debug(
      `${logStart} Enqueued ${readyGroups.length} group(s) [sizes=${counts}] queue=${tweetQueue.size()}`
    );
  }
};

const enqueueIndividualEvents = (
  processableEvents: OpenSeaAssetEvent[]
): void => {
  for (const event of processableEvents) {
    tweetQueue.enqueue({ event });
  }
};

const logProcessingSummary = (
  skippedPending: number,
  processableEvents: OpenSeaAssetEvent[],
  skippedDupes: number
): void => {
  if (skippedPending > 0) {
    const pluralSuffix = skippedPending === 1 ? '' : 's';
    logger.info(
      `${logStart} Holding ${skippedPending} event${pluralSuffix} in aggregator (pending group detection)`
    );
  }

  if (processableEvents.length > 0) {
    const pluralSuffix = processableEvents.length === 1 ? '' : 's';
    logger.info(
      `${logStart} Queued ${processableEvents.length} individual event${pluralSuffix} for tweeting`
    );
  }

  logger.debug(
    `${logStart} Enqueue summary: singles=${processableEvents.length} skippedDupes=${skippedDupes} skippedPendingGroup=${skippedPending} queue=${tweetQueue.size()}`
  );
};

export const tweetEvents = (events: OpenSeaAssetEvent[]) => {
  if (!process.env.TWITTER_EVENTS) {
    return;
  }
  if (!hasTwitterCreds()) {
    return;
  }
  ensureTwitterClient();

  const requestedSet = parseRequestedEvents(process.env.TWITTER_EVENTS);

  logger.debug(
    `${logStart} Twitter events configured: ${Array.from(requestedSet).join(', ')}`
  );

  const filteredEvents = events.filter((event) =>
    matchesSelection(event, requestedSet)
  );

  if (filteredEvents.length > 0) {
    logger.info(`${logStart} Relevant events: ${filteredEvents.length}`);
    logEventBreakdown(filteredEvents);
  }

  if (filteredEvents.length === 0) {
    return;
  }

  // Add to event group aggregator; this supports >50 event groups across batches
  groupManager.addEvents(filteredEvents);
  const pendingLarge = groupManager.getPendingLargeTxHashes();
  const pendingAll = groupManager.getPendingTxHashes();
  logger.debug(
    `${logStart} Aggregator state: pendingTxs=${pendingAll.size} pendingLargeTxs=${pendingLarge.size}`
  );

  // Flush any groups that have settled
  const readyGroups = groupManager.getReadyGroups();
  enqueueGroups(readyGroups);

  // Use group manager to filter processable events
  const { processableEvents, skippedDupes, skippedPending } =
    groupManager.filterProcessableEvents(filteredEvents);

  // Enqueue remaining individual events
  enqueueIndividualEvents(processableEvents);

  // Better diagnostics for what happened to the events
  logProcessingSummary(skippedPending, processableEvents, skippedDupes);

  // Fire and forget
  tweetQueue.start();
};
