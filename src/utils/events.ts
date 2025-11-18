import { EventType } from "../opensea";
import { BotEvent, botEventSet, type OpenSeaAssetEvent } from "../types";
import { effectiveEventTypeFor } from "./event-types";

export const parseEvents = (raw: string | undefined): Set<BotEvent> => {
  const parts = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const invalid = parts.filter((t) => !botEventSet.has(t));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid events value(s): ${invalid.join(", ")}. Allowed: ${Object.values(
        BotEvent
      ).join(", ")}`
    );
  }
  return new Set(parts as BotEvent[]);
};

export const wantsOpenSeaEventTypes = (
  selection: Set<BotEvent>
): EventType[] => {
  const want = new Set<EventType>();
  if (selection.has(BotEvent.listing)) {
    want.add(EventType.listing);
  }
  if (selection.has(BotEvent.offer)) {
    want.add(EventType.offer);
    want.add(EventType.trait_offer);
    want.add(EventType.collection_offer);
  }
  if (selection.has(BotEvent.sale)) {
    want.add(EventType.sale);
  }
  const needsTransferEvents =
    selection.has(BotEvent.transfer) ||
    selection.has(BotEvent.burn) ||
    selection.has(BotEvent.mint);
  if (needsTransferEvents) {
    want.add(EventType.transfer);
  }
  if (selection.has(BotEvent.mint)) {
    want.add(EventType.mint);
  }
  return [...want];
};

export const isEventWanted = (
  event: OpenSeaAssetEvent,
  selection: Set<BotEvent>
): boolean => {
  const type = event.event_type as EventType;
  if (type === EventType.listing) {
    return selection.has(BotEvent.listing);
  }
  if (
    type === EventType.offer ||
    type === EventType.trait_offer ||
    type === EventType.collection_offer
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
