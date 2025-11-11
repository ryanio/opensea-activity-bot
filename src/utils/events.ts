import { EventType } from '../opensea';
import { BotEvent, botEventSet, type OpenSeaAssetEvent } from '../types';
import { effectiveEventTypeFor } from './event-types';

export const parseEvents = (raw: string | undefined): Set<BotEvent> => {
  const parts = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const invalid = parts.filter((t) => !botEventSet.has(t));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid events value(s): ${invalid.join(', ')}. Allowed: ${Object.values(
        BotEvent
      ).join(', ')}`
    );
  }
  return new Set(parts as BotEvent[]);
};

export const wantsOpenSeaEventTypes = (selection: Set<BotEvent>): string[] => {
  const want = new Set<string>();
  if (selection.has(BotEvent.listing) || selection.has(BotEvent.offer)) {
    if (selection.has(BotEvent.listing)) {
      want.add('listing');
    }
    if (selection.has(BotEvent.offer)) {
      // Include all offer variants
      want.add('offer');
      want.add('trait_offer');
      want.add('collection_offer');
    }
  }
  if (selection.has(BotEvent.sale)) {
    want.add('sale');
  }
  if (selection.has(BotEvent.transfer) || selection.has(BotEvent.burn)) {
    want.add('transfer');
  }
  if (selection.has(BotEvent.mint)) {
    want.add('mint');
  }
  return [...want];
};

export const isEventWanted = (
  event: OpenSeaAssetEvent,
  selection: Set<BotEvent>
): boolean => {
  const type = event.event_type as EventType;
  if (type === 'listing') {
    return selection.has(BotEvent.listing);
  }
  if (
    type === 'offer' ||
    type === 'trait_offer' ||
    type === 'collection_offer'
  ) {
    return selection.has(BotEvent.offer);
  }
  if (type === EventType.mint) {
    return selection.has(BotEvent.mint);
  }
  if (type === EventType.sale) {
    return selection.has(BotEvent.sale);
  }
  if (type === EventType.transfer) {
    const eff = String(effectiveEventTypeFor(event));
    if (eff === BotEvent.mint) {
      return selection.has(BotEvent.mint);
    }
    if (eff === BotEvent.burn) {
      return selection.has(BotEvent.burn);
    }
    return selection.has(BotEvent.transfer);
  }
  return false;
};
