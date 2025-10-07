export type NFTLike = {
  identifier?: string | number;
  token_id?: string | number;
  opensea_url?: string;
  image_url?: string;
  name?: string;
};

export type AggregatorEvent = {
  transaction?: string | { hash?: string };
  transaction_hash?: string;
  tx_hash?: string;
  hash?: string;
  event_timestamp?: number | string;
  nft?: NFTLike;
  asset?: NFTLike;
  event_type?: string;
  order_type?: string;
};

export const txHashFor = (event: AggregatorEvent): string | undefined => {
  return (
    (typeof event?.transaction === 'string' ? event.transaction : undefined) ||
    (typeof event?.transaction === 'object'
      ? (event.transaction?.hash as string | undefined)
      : undefined) ||
    event?.transaction_hash ||
    event?.tx_hash ||
    event?.hash ||
    undefined
  );
};

type SweepAggregatorOptions = {
  settleMs: number;
  minGroupSize: number;
};

type AggregatedTx = {
  events: AggregatorEvent[];
  lastAddedMs: number;
  dedupeKeys: Set<string>;
  rawCount: number; // counts all events added (including duplicates)
};

export class SweepAggregator {
  private readonly options: SweepAggregatorOptions;
  private readonly txToAgg: Map<string, AggregatedTx> = new Map();

  constructor(options: SweepAggregatorOptions) {
    this.options = options;
  }

  private keyForEvent(event: AggregatorEvent): string {
    const ts = String(event?.event_timestamp ?? '');
    const nft = event?.nft ?? event?.asset ?? {};
    const tokenId = String(nft?.identifier ?? nft?.token_id ?? '');
    return `${ts}|${tokenId}`;
  }

  add(events: AggregatorEvent[]) {
    const now = Date.now();
    for (const e of events) {
      const tx = txHashFor(e);
      if (!tx) {
        continue;
      }
      let agg = this.txToAgg.get(tx);
      if (!agg) {
        agg = {
          events: [],
          lastAddedMs: 0,
          dedupeKeys: new Set(),
          rawCount: 0,
        };
        this.txToAgg.set(tx, agg);
      }
      // Always increment rawCount for gating decisions
      agg.rawCount += 1;
      const key = this.keyForEvent(e);
      if (agg.dedupeKeys.has(key)) {
        continue;
      }
      agg.events.push(e);
      agg.dedupeKeys.add(key);
      agg.lastAddedMs = now;
    }
  }

  flushReady(): Array<{ tx: string; events: AggregatorEvent[] }> {
    const now = Date.now();
    const ready: Array<{ tx: string; events: AggregatorEvent[] }> = [];
    for (const [tx, agg] of this.txToAgg.entries()) {
      if (
        agg.rawCount >= this.options.minGroupSize &&
        now - agg.lastAddedMs >= this.options.settleMs
      ) {
        ready.push({ tx, events: agg.events });
        this.txToAgg.delete(tx);
      }
    }
    return ready;
  }

  pendingTxHashes(): Set<string> {
    return new Set(this.txToAgg.keys());
  }

  pendingLargeTxHashes(): Set<string> {
    const set = new Set<string>();
    for (const [tx, agg] of this.txToAgg.entries()) {
      if (agg.rawCount >= this.options.minGroupSize) {
        set.add(tx);
      }
    }
    return set;
  }
}
