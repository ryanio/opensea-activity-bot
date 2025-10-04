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
    want.add('order');
  }
  if (selection.has(BotEvent.sale)) {
    want.add('sale');
  }
  if (
    selection.has(BotEvent.transfer) ||
    selection.has(BotEvent.mint) ||
    selection.has(BotEvent.burn)
  ) {
    want.add('transfer');
  }
  return [...want];
};

export const isEventWanted = (
  event: OpenSeaAssetEvent,
  selection: Set<BotEvent>
): boolean => {
  const type = event.event_type as EventType;
  if (type === 'order') {
    const isListing = (event.order_type ?? '') === BotEvent.listing;
    const isOffer = (event.order_type ?? '').includes(BotEvent.offer);
    return (
      (isListing && selection.has(BotEvent.listing)) ||
      (isOffer && selection.has(BotEvent.offer))
    );
  }
  if (type === EventType.sale) {
    return selection.has(BotEvent.sale);
  }
  if (type === EventType.transfer) {
    const eff = String(effectiveEventTypeFor(event));
    if (eff === BotEvent.mint) {
      return selection.has(BotEvent.mint) || selection.has(BotEvent.transfer);
    }
    if (eff === BotEvent.burn) {
      return selection.has(BotEvent.burn) || selection.has(BotEvent.transfer);
    }
    return selection.has(BotEvent.transfer);
  }
  return false;
};
