import { EventType } from "../opensea";
import {
  BotEvent,
  botEventSet,
  type OpenSeaAssetEvent,
  type OpenSeaEventType,
} from "../types";
import {
  effectiveEventTypeFor,
  isListingType,
  isOfferType,
} from "./event-types";

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
  // All parts are validated to be in botEventSet, so they're BotEvent values
  return new Set(parts.filter((p): p is BotEvent => botEventSet.has(p)));
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
  const type = event.event_type;

  // Handle "order" event type - check order_type for the actual type
  if (type === "order") {
    if (isListingType(event)) {
      return selection.has(BotEvent.listing);
    }
    if (isOfferType(event)) {
      return selection.has(BotEvent.offer);
    }
    return false;
  }

  // Legacy event_type handling (for backwards compatibility)
  if (type === ("listing" satisfies OpenSeaEventType)) {
    return selection.has(BotEvent.listing);
  }
  if (
    type === ("offer" satisfies OpenSeaEventType) ||
    type === ("trait_offer" satisfies OpenSeaEventType) ||
    type === ("collection_offer" satisfies OpenSeaEventType)
  ) {
    return selection.has(BotEvent.offer);
  }
  if (type === ("mint" satisfies OpenSeaEventType)) {
    return selection.has(BotEvent.mint);
  }
  if (type === ("sale" satisfies OpenSeaEventType)) {
    return selection.has(BotEvent.sale);
  }
  if (type === ("transfer" satisfies OpenSeaEventType)) {
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
