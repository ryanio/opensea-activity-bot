import type { OpenSeaAssetEvent } from '../types';
import { DEFAULT_SETTLE_MS, MIN_GROUP_SIZE } from './constants';
import { LRUCache } from './lru-cache';
import { classifyTransfer } from './utils';

// Common event grouping configuration with environment variable support
export type EventGroupConfig = {
  settleMs: number;
  minGroupSize: number;
};

export const getDefaultEventGroupConfig = (
  prefix: 'TWITTER' | 'DISCORD'
): EventGroupConfig => ({
  settleMs: Number(
    process.env[`${prefix}_EVENT_GROUP_SETTLE_MS`] ?? DEFAULT_SETTLE_MS
  ),
  minGroupSize: Number(
    process.env[`${prefix}_EVENT_GROUP_MIN_GROUP_SIZE`] ?? MIN_GROUP_SIZE
  ),
});

// Common event key generation
export const eventKeyFor = (event: OpenSeaAssetEvent): string => {
  const ts = String(event?.event_timestamp ?? '');
  const nft = event?.nft ?? event?.asset;
  const tokenId = String(nft?.identifier ?? '');
  const eventType = event?.event_type ?? '';
  return `${ts}|${tokenId}|${eventType}`;
};

// Grouped event type for shared use
export type GroupedEvent = {
  kind: 'group';
  txHash: string;
  events: OpenSeaAssetEvent[];
};

export const isGroupedEvent = (
  event: OpenSeaAssetEvent | GroupedEvent
): event is GroupedEvent => {
  return (
    (event as { kind?: string }).kind === 'group' &&
    Array.isArray((event as { events?: unknown[] }).events)
  );
};

// Common event group aggregator management
export class EventGroupManager {
  private readonly processedCache: LRUCache<string, boolean>;
  // Actor-based grouping for purchases, mints, burns, and transfers
  private readonly actorAgg: Map<
    string,
    {
      events: OpenSeaAssetEvent[];
      lastAddedMs: number;
      dedupeKeys: Set<string>;
      rawCount: number;
    }
  > = new Map();
  private readonly settleMs: number;
  private readonly minGroupSize: number;
  private static readonly ACTOR_GROUP_STALE_MULTIPLIER = 5;
  private static readonly PROCESSED_CACHE_CAPACITY = 2000;

  constructor(config: EventGroupConfig) {
    this.processedCache = new LRUCache<string, boolean>(
      EventGroupManager.PROCESSED_CACHE_CAPACITY
    );
    this.settleMs = config.settleMs;
    this.minGroupSize = config.minGroupSize;
  }

  // Add events to the aggregator
  addEvents(events: OpenSeaAssetEvent[]): void {
    const now = Date.now();
    for (const ev of events) {
      const key = this.actorKeyForEvent(ev);
      if (!key) {
        continue;
      }
      let agg = this.actorAgg.get(key);
      if (!agg) {
        agg = {
          events: [],
          lastAddedMs: 0,
          dedupeKeys: new Set(),
          rawCount: 0,
        };
        this.actorAgg.set(key, agg);
      }
      // Always increment rawCount for gating decisions
      agg.rawCount += 1;
      // Dedupe by eventKey across batches
      const ekey = eventKeyFor(ev);
      if (agg.dedupeKeys.has(ekey)) {
        // Do not refresh lastAddedMs on duplicates; otherwise repeated polling
        // can starve the settle window and prevent group flush.
        continue;
      }
      agg.events.push(ev);
      agg.dedupeKeys.add(ekey);
      agg.lastAddedMs = now;
    }
  }

  // Get ready event groups
  getReadyGroups(): Array<{ tx: string; events: OpenSeaAssetEvent[] }> {
    return this.collectReadyActorGroups();
  }

  private collectReadyActorGroups(): Array<{
    tx: string;
    events: OpenSeaAssetEvent[];
  }> {
    const out: Array<{ tx: string; events: OpenSeaAssetEvent[] }> = [];
    const now = Date.now();
    this.pruneStaleActorGroups(now);
    for (const [key, agg] of this.actorAgg.entries()) {
      if (
        agg.rawCount >= this.minGroupSize &&
        now - agg.lastAddedMs >= this.settleMs
      ) {
        // Remove events that have already been processed via prior groups
        const unprocessed = (agg.events as OpenSeaAssetEvent[]).filter(
          (e) => !this.isProcessed(e)
        );
        if (unprocessed.length >= this.minGroupSize) {
          const pseudoTx = `actor:${key}`;
          out.push({ tx: pseudoTx, events: unprocessed });
        }
        this.actorAgg.delete(key);
      }
    }
    return out;
  }

  private actorKeyForEvent(event: OpenSeaAssetEvent): string | undefined {
    if (event.event_type === 'sale') {
      return this.actorKeyForSale(event);
    }
    if (event.event_type === 'transfer') {
      return this.actorKeyForTransfer(event);
    }
    if (event.event_type === 'order') {
      return this.actorKeyForOrder(event);
    }
    return;
  }

  private actorKeyForSale(event: OpenSeaAssetEvent): string | undefined {
    const buyer = (event.buyer ?? '').toLowerCase();
    return buyer ? `purchase:${buyer}` : undefined;
  }

  private actorKeyForTransfer(event: OpenSeaAssetEvent): string | undefined {
    const kind = classifyTransfer(event);
    if (kind === 'mint') {
      const to = (event.to_address ?? '').toLowerCase();
      return to ? `mint:${to}` : undefined;
    }
    if (kind === 'burn') {
      const from = (event.from_address ?? '').toLowerCase();
      return from ? `burn:${from}` : undefined;
    }
    const from = (event.from_address ?? '').toLowerCase();
    return from ? `transfer:${from}` : undefined;
  }

  private actorKeyForOrder(event: OpenSeaAssetEvent): string | undefined {
    const maker = (event.maker ?? '').toLowerCase();
    if (!maker) {
      return;
    }
    const isOffer = (event.order_type ?? '').includes('offer');
    const prefix = isOffer ? 'offer' : 'listing';
    return `${prefix}:${maker}`;
  }

  // Check if an event was already processed
  isProcessed(event: OpenSeaAssetEvent): boolean {
    const key = eventKeyFor(event);
    return this.processedCache.get(key) === true;
  }

  // Mark event as processed
  markProcessed(event: OpenSeaAssetEvent): void {
    const key = eventKeyFor(event);
    this.processedCache.put(key, true);
  }

  // Mark grouped events as processed
  markGroupProcessed(group: GroupedEvent): void {
    for (const event of group.events) {
      this.markProcessed(event);
    }
  }

  // Get pending transaction hashes (actor pseudo-tx keys)
  getPendingTxHashes(): Set<string> {
    const set = new Set<string>();
    for (const key of this.actorAgg.keys()) {
      set.add(`actor:${key}`);
    }
    return set;
  }

  // Get pending large transaction hashes (actor pseudo-tx keys)
  getPendingLargeTxHashes(): Set<string> {
    const set = new Set<string>();
    const now = Date.now();
    this.pruneStaleActorGroups(now);
    for (const [key, agg] of this.actorAgg.entries()) {
      if (agg.rawCount >= this.minGroupSize) {
        set.add(`actor:${key}`);
      }
    }
    return set;
  }

  // Filter out events that are part of pending groups or already processed
  filterProcessableEvents(events: OpenSeaAssetEvent[]): {
    processableEvents: OpenSeaAssetEvent[];
    skippedDupes: number;
    skippedPending: number;
  } {
    const pendingLarge = this.getPendingLargeTxHashes();
    const processableEvents: OpenSeaAssetEvent[] = [];
    let skippedDupes = 0;
    let skippedPending = 0;

    const isPendingActorGroup = (event: OpenSeaAssetEvent): boolean => {
      const key = this.actorKeyForEvent(event);
      if (!key) {
        return false;
      }
      const actorKey = `actor:${key}`;
      return pendingLarge.has(actorKey);
    };

    for (const event of events) {
      if (this.isProcessed(event)) {
        skippedDupes += 1;
        continue;
      }
      if (isPendingActorGroup(event)) {
        skippedPending += 1;
        continue;
      }
      processableEvents.push(event);
    }

    return { processableEvents, skippedDupes, skippedPending };
  }

  private pruneStaleActorGroups(now: number): void {
    const ttl = this.settleMs * EventGroupManager.ACTOR_GROUP_STALE_MULTIPLIER;
    for (const [key, agg] of this.actorAgg.entries()) {
      if (now - agg.lastAddedMs >= ttl && agg.rawCount < this.minGroupSize) {
        this.actorAgg.delete(key);
      }
    }
  }
}

// ---- Generic group helpers ----

export type GroupKind = 'purchase' | 'burn' | 'mint' | 'offer' | 'listing';

export const groupKindForEvents = (events: OpenSeaAssetEvent[]): GroupKind => {
  if (events.length === 0) {
    // Empty groups shouldn't happen, but default to purchase
    return 'purchase';
  }
  const allSales = events.every((e) => e.event_type === 'sale');
  if (allSales) {
    return 'purchase';
  }
  const allOffers = events.every(
    (e) => e.event_type === 'order' && (e.order_type ?? '').includes('offer')
  );
  if (allOffers) {
    return 'offer';
  }
  const allListings = events.every(
    (e) => e.event_type === 'order' && e.order_type === 'listing'
  );
  if (allListings) {
    return 'listing';
  }
  const allMintTransfers = events.every(
    (e) => e.event_type === 'transfer' && classifyTransfer(e) === 'mint'
  );
  if (allMintTransfers) {
    return 'mint';
  }
  const allBurnTransfers = events.every(
    (e) => e.event_type === 'transfer' && classifyTransfer(e) === 'burn'
  );
  if (allBurnTransfers) {
    return 'burn';
  }
  // Mixed groups shouldn't happen due to actor-based grouping keys,
  // but if they do, treat the first event's type as canonical
  const firstEvent = events[0];
  if (!firstEvent) {
    return 'purchase';
  }
  if (firstEvent.event_type === 'sale') {
    return 'purchase';
  }
  if (firstEvent.event_type === 'order') {
    if ((firstEvent.order_type ?? '').includes('offer')) {
      return 'offer';
    }
    return 'listing';
  }
  const transferKind = classifyTransfer(firstEvent);
  if (transferKind === 'mint') {
    return 'mint';
  }
  if (transferKind === 'burn') {
    return 'burn';
  }
  return 'purchase';
};

export const primaryActorAddressForGroup = (
  events: OpenSeaAssetEvent[],
  kind: GroupKind
): string | undefined => {
  const first = events[0];
  if (!first) {
    return;
  }
  if (kind === 'purchase') {
    return first.buyer;
  }
  if (kind === 'mint') {
    return first.to_address;
  }
  if (kind === 'burn') {
    return first.from_address;
  }
  if (kind === 'offer' || kind === 'listing') {
    return first.maker;
  }
  return;
};

// Helper function to extract numeric price from payment.quantity for sorting
export const getPurchasePrice = (event: OpenSeaAssetEvent): bigint => {
  const payment = event.payment;
  if (!payment?.quantity) {
    return 0n;
  }

  // Convert string quantity to BigInt for proper precision
  try {
    return BigInt(payment.quantity);
  } catch {
    return 0n;
  }
};

// Sort events by purchase price in descending order (highest first)
export const sortEventsByPrice = (
  events: OpenSeaAssetEvent[]
): OpenSeaAssetEvent[] => {
  return [...events].sort((a, b) => {
    const priceA = getPurchasePrice(a);
    const priceB = getPurchasePrice(b);
    if (priceA > priceB) {
      return -1;
    }
    if (priceA < priceB) {
      return 1;
    }
    return 0;
  });
};

// Get top N most expensive events with their details
export const getTopExpensiveEvents = (
  events: OpenSeaAssetEvent[],
  limit = 4
): Array<{
  event: OpenSeaAssetEvent;
  price: string | null;
  nft: { identifier?: string; name?: string; opensea_url?: string } | undefined;
}> => {
  const sortedEvents = sortEventsByPrice(events);
  const { formatAmount } = require('./utils');

  return sortedEvents.slice(0, limit).map((event) => {
    const payment = event.payment;
    const price = payment
      ? formatAmount(payment.quantity, payment.decimals, payment.symbol)
      : null;
    const nft = event.nft ?? event.asset;

    return {
      event,
      price,
      nft,
    };
  });
};

// Format group title based on count and kind
export const formatGroupTitle = (count: number, kind: GroupKind): string => {
  if (kind === 'burn') {
    return `${count} burned`;
  }
  if (kind === 'mint') {
    return `${count} minted`;
  }
  if (kind === 'offer') {
    return `${count} offers`;
  }
  if (kind === 'listing') {
    return `${count} listings`;
  }
  return `${count} purchased`;
};

// Format group actor text (username and URLs)
export const formatGroupActorInfo = async (
  actorAddress: string | undefined,
  kind: GroupKind,
  collectionUrl: string,
  collectionSlug: string
): Promise<{
  actorName?: string;
  actorLabel: string;
  actorUrl: string;
}> => {
  const { username } = require('../opensea');
  const {
    openseaProfileCollectionUrl,
    openseaProfileActivityUrl,
    openseaCollectionActivityUrl,
  } = require('./links');

  let actorLabel: string;
  let activityType: string | undefined;

  if (kind === 'burn') {
    actorLabel = 'By';
    activityType = 'transfer';
  } else if (kind === 'mint') {
    actorLabel = 'Minter';
    activityType = 'mint';
  } else if (kind === 'offer') {
    actorLabel = 'Offerer';
    activityType = 'offer';
  } else if (kind === 'listing') {
    actorLabel = 'Lister';
    activityType = 'listing';
  } else {
    actorLabel = 'Buyer';
    activityType = 'sale';
  }

  if (actorAddress) {
    const actorName = await username(actorAddress);
    let actorUrl: string;
    if (kind === 'mint' || kind === 'purchase') {
      // For mints and purchases, show profile filtered by collection
      actorUrl = openseaProfileCollectionUrl(actorAddress, collectionSlug);
    } else if (kind === 'offer') {
      actorUrl = openseaProfileActivityUrl(actorAddress, 'offer');
    } else if (kind === 'listing') {
      actorUrl = openseaProfileActivityUrl(actorAddress, 'listing');
    } else {
      // For burns and other transfers
      actorUrl = openseaProfileActivityUrl(actorAddress, 'transfer');
    }
    return { actorName, actorLabel, actorUrl };
  }

  // Fallback to collection activity URL with activity type filter
  return {
    actorLabel,
    actorUrl: openseaCollectionActivityUrl(collectionUrl, activityType),
  };
};

// Format complete group text with actor info for Twitter
export const formatGroupText = async (options: {
  group: OpenSeaAssetEvent[];
  count: number;
  kind: GroupKind;
  collectionUrl: string;
  collectionSlug: string;
  totalSpent?: string | null;
}): Promise<string> => {
  const { group, count, kind, collectionUrl, collectionSlug, totalSpent } =
    options;
  const actorAddress = primaryActorAddressForGroup(group, kind);
  const title = formatGroupTitle(count, kind);

  let text = '';

  if (actorAddress) {
    const actorInfo = await formatGroupActorInfo(
      actorAddress,
      kind,
      collectionUrl,
      collectionSlug
    );
    // Twitter-specific formatting with @ for usernames
    const formattedName =
      kind === 'burn' ? `@${actorInfo.actorName}` : actorInfo.actorName;
    text += `${title} by ${formattedName}`;
    if (kind === 'purchase' && totalSpent) {
      text += ` for ${totalSpent}`;
    }
    text += ` ${actorInfo.actorUrl}`;
  } else {
    text += title;
    if (kind === 'purchase' && totalSpent) {
      text += ` for ${totalSpent}`;
    }
    const fallbackInfo = await formatGroupActorInfo(
      undefined,
      kind,
      collectionUrl,
      collectionSlug
    );
    text += ` ${fallbackInfo.actorUrl}`;
  }

  return text;
};

// Utility to calculate total spent across events (ETH/WETH only)
export const calculateTotalSpent = (
  events: OpenSeaAssetEvent[]
): string | null => {
  const paymentsWithETH = events
    .map((event) => event.payment)
    .filter(
      (payment) =>
        payment !== undefined &&
        (payment.symbol === 'ETH' || payment.symbol === 'WETH')
    );

  if (paymentsWithETH.length === 0) {
    return null;
  }

  // Use the first payment to get decimals (should be consistent for ETH)
  const firstPayment = paymentsWithETH[0];
  if (!firstPayment) {
    return null;
  }
  const { decimals, symbol } = firstPayment;

  // Sum all quantities (as BigInt to avoid precision issues)
  const totalQuantity = paymentsWithETH.reduce((sum, payment) => {
    return sum + BigInt(payment?.quantity ?? '0');
  }, BigInt(0));

  // Import formatAmount from utils when needed
  const { formatAmount } = require('./utils');
  return formatAmount(totalQuantity.toString(), decimals, symbol);
};

// Shared function to process events with aggregator flushing
// This ensures both Discord and Twitter flush pending groups consistently
export type ProcessEventsResult = {
  readyGroups: Array<{ tx: string; events: OpenSeaAssetEvent[] }>;
  processableEvents: OpenSeaAssetEvent[];
  skippedDupes: number;
  skippedPending: number;
};

export const processEventsWithAggregator = (
  groupManager: EventGroupManager,
  events: OpenSeaAssetEvent[]
): ProcessEventsResult => {
  // Add new events to aggregator if any
  if (events.length > 0) {
    groupManager.addEvents(events);
  }

  // Always flush ready groups (even if no new events)
  const readyGroups = groupManager.getReadyGroups();

  // Filter processable events (only if we have new events)
  const { processableEvents, skippedDupes, skippedPending } =
    events.length > 0
      ? groupManager.filterProcessableEvents(events)
      : { processableEvents: [], skippedDupes: 0, skippedPending: 0 };

  return {
    readyGroups,
    processableEvents,
    skippedDupes,
    skippedPending,
  };
};
