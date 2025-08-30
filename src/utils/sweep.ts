import type { OpenSeaAssetEvent } from '../types';
import type { AggregatorEvent } from './aggregator';
import { SweepAggregator, txHashFor } from './aggregator';
import { LRUCache } from './lru-cache';

// Common sweep configuration with environment variable support
export type SweepConfig = {
  settleMs: number;
  minGroupSize: number;
  cacheCapacity: number;
};

export const getDefaultSweepConfig = (
  prefix: 'TWITTER' | 'DISCORD'
): SweepConfig => {
  const DEFAULT_SETTLE_MS = 15_000;
  const DEFAULT_MIN_GROUP_SIZE = 5;
  const DEFAULT_CACHE_CAPACITY = 2000;

  return {
    settleMs: Number(
      process.env[`${prefix}_SWEEP_SETTLE_MS`] ?? DEFAULT_SETTLE_MS
    ),
    minGroupSize: Number(
      process.env[`${prefix}_SWEEP_MIN_GROUP_SIZE`] ?? DEFAULT_MIN_GROUP_SIZE
    ),
    cacheCapacity: Number(
      process.env[`${prefix}_PROCESSED_CACHE_CAPACITY`] ??
        DEFAULT_CACHE_CAPACITY
    ),
  };
};

// Common event key generation
export const eventKeyFor = (event: OpenSeaAssetEvent): string => {
  const ts = String(event?.event_timestamp ?? '');
  const nft = event?.nft ?? event?.asset;
  const tokenId = String(nft?.identifier ?? '');
  return `${ts}|${tokenId}`;
};

// Sweep event type for shared use
export type SweepEvent = {
  kind: 'sweep';
  txHash: string;
  events: OpenSeaAssetEvent[];
};

export const isSweepEvent = (
  event: OpenSeaAssetEvent | SweepEvent
): event is SweepEvent => {
  return (
    (event as { kind?: string }).kind === 'sweep' &&
    Array.isArray((event as { events?: unknown[] }).events)
  );
};

// Common sweep aggregator management
export class SweepManager {
  private readonly aggregator: SweepAggregator;
  private readonly processedCache: LRUCache<string, boolean>;

  constructor(config: SweepConfig) {
    this.aggregator = new SweepAggregator({
      settleMs: config.settleMs,
      minGroupSize: config.minGroupSize,
    });
    this.processedCache = new LRUCache<string, boolean>(config.cacheCapacity);
  }

  // Add events to the aggregator
  addEvents(events: OpenSeaAssetEvent[]): void {
    this.aggregator.add(events as AggregatorEvent[]);
  }

  // Get ready sweeps
  getReadySweeps(): Array<{ tx: string; events: OpenSeaAssetEvent[] }> {
    return this.aggregator
      .flushReady()
      .map(({ tx, events }) => ({ tx, events: events as OpenSeaAssetEvent[] }));
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

  // Mark sweep events as processed
  markSweepProcessed(sweep: SweepEvent): void {
    for (const event of sweep.events) {
      this.markProcessed(event);
    }
  }

  // Get pending transaction hashes
  getPendingTxHashes(): Set<string> {
    return this.aggregator.pendingTxHashes();
  }

  // Get pending large transaction hashes
  getPendingLargeTxHashes(): Set<string> {
    return this.aggregator.pendingLargeTxHashes();
  }

  // Filter out events that are part of pending sweeps or already processed
  filterProcessableEvents(events: OpenSeaAssetEvent[]): {
    processableEvents: OpenSeaAssetEvent[];
    skippedDupes: number;
    skippedPending: number;
  } {
    const pendingLarge = this.getPendingLargeTxHashes();
    const processableEvents: OpenSeaAssetEvent[] = [];
    let skippedDupes = 0;
    let skippedPending = 0;

    for (const event of events) {
      if (this.isProcessed(event)) {
        skippedDupes += 1;
        continue;
      }

      const tx = txHashFor(event);
      if (tx && pendingLarge.has(tx)) {
        skippedPending += 1; // awaiting or covered by sweep
        continue;
      }

      processableEvents.push(event);
    }

    return { processableEvents, skippedDupes, skippedPending };
  }
}

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
