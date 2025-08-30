import { TwitterApi } from 'twitter-api-v2';
import { type AggregatorEvent, SweepAggregator, txHashFor } from './aggregator';
import { logger } from './logger';
import { LRUCache } from './lru-cache';
import { EventType, opensea, username } from './opensea';
import { AsyncQueue } from './queue';
import { BotEvent, botEventSet } from './types';
import { fetchImageBuffer, formatAmount, imageForNFT } from './utils';

const logStart = '[Twitter]';

// Read env dynamically in functions to respect runtime changes (tests)

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
type SweepEvent = { kind: 'sweep'; txHash: string; events: AggregatorEvent[] };
type TweetEvent = AggregatorEvent | SweepEvent;
type TweetQueueItem = { event: TweetEvent };

type TwitterPayment = {
  quantity: string | number;
  decimals: number;
  symbol: string;
};
type TwitterEvent = AggregatorEvent & {
  payment?: TwitterPayment;
  from_address?: string;
  to_address?: string;
  order_type?: string;
  maker?: string;
  buyer?: string;
  expiration_date?: number;
};

const isSweepEvent = (e: TweetEvent): e is SweepEvent => {
  return (
    (e as { kind?: string }).kind === 'sweep' &&
    Array.isArray((e as { events?: unknown[] }).events)
  );
};

// Sweep aggregation across runs
const DEFAULT_SWEEP_SETTLE_MS = 15_000;
const DEFAULT_SWEEP_MIN_GROUP_SIZE = 5;
const SWEEP_SETTLE_MS = Number(
  process.env.TWITTER_SWEEP_SETTLE_MS ?? DEFAULT_SWEEP_SETTLE_MS
);
const SWEEP_MIN_GROUP_SIZE = Number(
  process.env.TWITTER_SWEEP_MIN_GROUP_SIZE ?? DEFAULT_SWEEP_MIN_GROUP_SIZE
);
const sweepAggregator = new SweepAggregator({
  settleMs: SWEEP_SETTLE_MS,
  minGroupSize: SWEEP_MIN_GROUP_SIZE,
});

// Generic async queue for tweeting
const tweetQueue = new AsyncQueue<TweetQueueItem>({
  perItemDelayMs: PER_TWEET_DELAY_MS,
  backoffBaseMs: BACKOFF_BASE_MS,
  backoffMaxMs: BACKOFF_MAX_MS,
  debug: process.env.LOG_LEVEL === 'debug',
  keyFor: (i) => keyForQueueItem(i),
  isAlreadyProcessed: (key) => tweetedEventsCache.get(key) === true,
  onProcessed: (item) => {
    // Mark the queue key as processed to prevent reprocessing the same sweep/solo
    const queueKey = keyForQueueItem(item);
    tweetedEventsCache.put(queueKey, true);

    const event = item?.event;
    if (isSweepEvent(event)) {
      for (const e of event.events) {
        tweetedEventsCache.put(eventKeyFor(e), true);
      }
    } else if (event) {
      tweetedEventsCache.put(eventKeyFor(event as AggregatorEvent), true);
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

const JITTER_FACTOR = 0.2;
const jitter = (ms: number) => {
  const delta = Math.floor(ms * JITTER_FACTOR);
  return ms + Math.floor(Math.random() * (2 * delta + 1)) - delta;
};

const _calcBackoffMs = (attempts: number) => {
  const exp = BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(jitter(exp), BACKOFF_MAX_MS);
};

const keyForQueueItem = (item: TweetQueueItem): string => {
  const ev = item.event;
  if (isSweepEvent(ev)) {
    const tx = ev.txHash ?? txHashFor(ev.events?.[0]) ?? 'unknown';
    return `sweep:${tx}`;
  }
  return eventKeyFor(item.event as AggregatorEvent);
};

const _markDeduped = (item: TweetQueueItem) => {
  const ev = item.event;
  if (isSweepEvent(ev)) {
    for (const e of ev.events) {
      const key = eventKeyFor(e);
      tweetedEventsCache.put(key, true);
    }
    return;
  }
  const key = eventKeyFor(item.event as AggregatorEvent);
  tweetedEventsCache.put(key, true);
};

const eventKeyFor = (event: AggregatorEvent): string => {
  const ts = String(event?.event_timestamp ?? '');
  const nft = event?.nft ?? event?.asset ?? {};
  const tokenId = String(nft?.identifier ?? nft?.token_id ?? '');
  return `${ts}|${tokenId}`;
};

// txHashFor provided by utils

const formatNftPrefix = (
  nft: { name?: string; identifier?: string | number } | undefined
): string => {
  if (!nft) {
    return '';
  }
  const specialContract =
    process.env.TOKEN_ADDRESS?.toLowerCase() ===
    '0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075';
  if (specialContract && nft.name && nft.identifier !== undefined) {
    const nameParts = String(nft.name).split(' - ');
    const suffix = nameParts.length > 1 ? nameParts[1].trim() : undefined;
    const idStr = String(nft.identifier);
    return suffix ? `${suffix} #${idStr} ` : `#${idStr} `;
  }
  return `#${String(nft.identifier)} `;
};

const formatOrderText = async (
  payment: TwitterPayment,
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

const formatSaleText = async (payment: TwitterPayment, buyer: string) => {
  const amount = formatAmount(
    payment.quantity,
    payment.decimals,
    payment.symbol
  );
  const name = await username(buyer);
  return `purchased for ${amount} by ${name}`;
};

const formatTransferText = async (from_address: string, to_address: string) => {
  const fromName = await username(from_address);
  const toName = await username(to_address);
  return `transferred from ${fromName} to ${toName}`;
};

const textForTweet = async (event: AggregatorEvent) => {
  const ev = event as TwitterEvent;
  const {
    asset,
    event_type,
    payment,
    from_address,
    to_address,
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
  if (nft) {
    text += formatNftPrefix(nft);
  }
  if (
    event_type === 'order' &&
    payment &&
    maker &&
    order_type &&
    typeof expiration_date === 'number'
  ) {
    text += await formatOrderText(payment, maker, order_type, expiration_date);
  } else if (event_type === EventType.sale && payment && buyer) {
    text += await formatSaleText(payment, buyer);
  } else if (event_type === EventType.transfer && from_address && to_address) {
    text += await formatTransferText(from_address, to_address);
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

const uploadImagesForGroup = async (
  client: MinimalTwitterClient,
  group: AggregatorEvent[]
): Promise<string[]> => {
  const images: string[] = [];
  for (const e of group) {
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
        `${logStart} Sweep media upload failed; continuing:`,
        uploadError
      );
    }
  }
  return mediaIds;
};

const calculateTotalSpent = (group: AggregatorEvent[]): string | null => {
  const paymentsWithETH = group
    .map((event) => (event as TwitterEvent).payment)
    .filter(
      (payment): payment is TwitterPayment =>
        payment !== undefined &&
        (payment.symbol === 'ETH' || payment.symbol === 'WETH')
    );

  if (paymentsWithETH.length === 0) {
    return null;
  }

  // Use the first payment to get decimals (should be consistent for ETH)
  const firstPayment = paymentsWithETH[0];
  const { decimals, symbol } = firstPayment;

  // Sum all quantities (as BigInt to avoid precision issues)
  const totalQuantity = paymentsWithETH.reduce((sum, payment) => {
    return sum + BigInt(payment.quantity);
  }, BigInt(0));

  return formatAmount(totalQuantity.toString(), decimals, symbol);
};

const tweetSweep = async (
  client: MinimalTwitterClient,
  group: AggregatorEvent[]
) => {
  const count = group.length;
  const media_ids = await uploadImagesForGroup(client, group);

  // Get buyer from first event (all events in sweep should have same buyer)
  const firstEvent = group[0] as TwitterEvent;
  const buyerAddress = firstEvent?.buyer;

  // Calculate total spent
  const totalSpent = calculateTotalSpent(group);

  let text = '';
  if (process.env.TWITTER_PREPEND_TWEET) {
    text += `${process.env.TWITTER_PREPEND_TWEET} `;
  }

  if (buyerAddress) {
    const buyerName = await username(buyerAddress);
    text += `${count} purchased by ${buyerName}`;
    if (totalSpent) {
      text += ` for ${totalSpent}`;
    }
    const profileUrl = `https://opensea.io/${buyerAddress}?collectionSlugs=glyphbots`;
    text += ` ${profileUrl}`;
  } else {
    // Fallback to old format if buyer info unavailable
    text += `${count} purchased`;
    if (totalSpent) {
      text += ` for ${totalSpent}`;
    }
    const activityUrl = `${opensea.collectionURL()}/activity`;
    text += ` ${activityUrl}`;
  }

  if (process.env.TWITTER_APPEND_TWEET) {
    text += ` ${process.env.TWITTER_APPEND_TWEET}`;
  }
  const params: { text: string; media?: { media_ids: string[] } } =
    media_ids.length > 0 ? { text, media: { media_ids } } : { text };
  await client.v2.tweet(params);
  for (const e of group) {
    const key = eventKeyFor(e);
    tweetedEventsCache.put(key, true);
  }
  logger.info(`${logStart} Sweep tweeted: ${count} items`);
};

const tweetSingle = async (
  client: MinimalTwitterClient,
  event: AggregatorEvent
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
  logger.info(`${logStart} Tweeted (event key: ${key}): ${status}`);
  tweetedEventsCache.put(key, true);
};

const tweetEvent = async (client: MinimalTwitterClient, event: TweetEvent) => {
  if (isSweepEvent(event)) {
    await tweetSweep(client, event.events);
    return;
  }
  await tweetSingle(client, event as AggregatorEvent);
};

// Manual processQueue removed; AsyncQueue handles processing

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
export const parseRequestedEvents = (
  raw: string | undefined
): Set<BotEvent> => {
  const parts = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const invalid = parts.filter((t) => !botEventSet.has(t));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid TWITTER_EVENTS value(s): ${invalid.join(', ')}. Allowed: ${Object.values(
        BotEvent
      ).join(', ')}`
    );
  }
  return new Set(parts as BotEvent[]);
};

const isOrderListing = (orderType: string): boolean =>
  orderType === BotEvent.listing;
const isOrderOffer = (orderType: string): boolean =>
  orderType.includes(BotEvent.offer);

export const matchesSelection = (
  ev: AggregatorEvent,
  selectionSet: Set<BotEvent>
): boolean => {
  const type = (ev as { event_type?: string }).event_type as string;
  if (type === 'order') {
    const wantsListing = selectionSet.has(BotEvent.listing);
    const wantsOffer = selectionSet.has(BotEvent.offer);
    const wantsAnyOrder = wantsListing || wantsOffer;
    if (!wantsAnyOrder) {
      return false;
    }
    const orderType = (ev as { order_type?: string }).order_type ?? '';
    if (isOrderListing(orderType)) {
      return wantsListing;
    }
    if (isOrderOffer(orderType)) {
      return wantsOffer;
    }
    return false;
  }
  if (type === EventType.sale) {
    return selectionSet.has(BotEvent.sale);
  }
  if (type === EventType.transfer) {
    return selectionSet.has(BotEvent.transfer);
  }
  return false;
};

export const tweetEvents = (events: AggregatorEvent[]) => {
  if (!process.env.TWITTER_EVENTS) {
    return;
  }
  if (!hasTwitterCreds()) {
    return;
  }
  ensureTwitterClient();

  const requestedSet = parseRequestedEvents(process.env.TWITTER_EVENTS);
  const filteredEvents = events.filter((event) =>
    matchesSelection(event, requestedSet)
  );

  logger.info(`${logStart} Relevant events: ${filteredEvents.length}`);

  if (filteredEvents.length === 0) {
    return;
  }

  // Add to sweep aggregator; this supports >50 event sweeps across batches
  sweepAggregator.add(filteredEvents);
  const pendingLarge = sweepAggregator.pendingLargeTxHashes();
  const pendingAll = sweepAggregator.pendingTxHashes();
  logger.debug(
    `${logStart} Aggregator state: pendingTxs=${pendingAll.size} pendingLargeTxs=${pendingLarge.size}`
  );

  // Flush any sweeps that have settled
  const readySweeps = sweepAggregator.flushReady();
  for (const { tx, events: evts } of readySweeps) {
    tweetQueue.enqueue({ event: { kind: 'sweep', txHash: tx, events: evts } });
  }
  if (readySweeps.length > 0) {
    const counts = readySweeps.map((r) => r.events.length).join(',');
    logger.debug(
      `${logStart} Enqueued ${readySweeps.length} sweep(s) [sizes=${counts}] queue=${tweetQueue.size()}`
    );
  }

  // Enqueue remaining individual events when not part of a pending/ready sweep
  let queuedSingles = 0;
  let skippedDupes = 0;
  let skippedPending = 0;
  for (const event of filteredEvents) {
    const key = eventKeyFor(event);
    if (tweetedEventsCache.get(key)) {
      logger.debug(`${logStart} Skipping duplicate (event key: ${key})`);
      skippedDupes += 1;
      continue;
    }
    const tx = txHashFor(event);
    if (tx && pendingLarge.has(tx)) {
      skippedPending += 1; // awaiting or covered by sweep tweet
      continue;
    }
    tweetQueue.enqueue({ event });
    queuedSingles += 1;
  }
  logger.debug(
    `${logStart} Enqueue summary: singles=${queuedSingles} skippedDupes=${skippedDupes} skippedPendingSweep=${skippedPending} queue=${tweetQueue.size()}`
  );

  // Fire and forget
  tweetQueue.start();
};
