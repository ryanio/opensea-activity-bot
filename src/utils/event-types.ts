import { EventType } from "../opensea";
import {
  BotEvent,
  type OpenSeaAssetEvent,
  type OpenSeaEventType,
} from "../types";
import { classifyTransfer } from "./utils";

/**
 * Determines the effective event type for an OpenSea event.
 * Handles the API quirk where order events have event_type="order"
 * with the actual type in order_type.
 */
export const getEffectiveOrderType = (event: OpenSeaAssetEvent): string => {
  // If event_type is "order", use order_type for the actual type
  if (event.event_type === "order") {
    return event.order_type ?? "listing";
  }
  // Otherwise use event_type directly (for sale, transfer, mint, etc.)
  return event.event_type;
};

/**
 * Checks if an event is an offer type (item_offer, trait_offer, collection_offer)
 */
export const isOfferType = (event: OpenSeaAssetEvent): boolean => {
  const effectiveType = getEffectiveOrderType(event);
  return (
    effectiveType === "item_offer" ||
    effectiveType === "trait_offer" ||
    effectiveType === "collection_offer" ||
    effectiveType === "offer" || // Legacy value
    effectiveType === "criteria_offer" // Legacy value
  );
};

/**
 * Checks if an event is a listing type
 */
export const isListingType = (event: OpenSeaAssetEvent): boolean => {
  const effectiveType = getEffectiveOrderType(event);
  return effectiveType === "listing";
};

export const colorForEvent = (
  eventType: EventType | BotEvent | OpenSeaEventType,
  orderType: string
): string => {
  // Handle order type for "order" events
  if (
    orderType === "item_offer" ||
    orderType === "trait_offer" ||
    orderType === "collection_offer" ||
    orderType === "criteria_offer"
  ) {
    return "#d63864";
  }
  if (orderType === "listing") {
    return "#66dcf0";
  }
  // Handle event type directly
  if (
    (eventType as unknown as string) === BotEvent.offer ||
    eventType === "offer" ||
    eventType === "trait_offer" ||
    eventType === "collection_offer"
  ) {
    return "#d63864";
  }
  if (
    (eventType as unknown as string) === BotEvent.listing ||
    eventType === "listing"
  ) {
    return "#66dcf0";
  }
  if (eventType === EventType.sale) {
    return "#62b778";
  }
  if (eventType === EventType.transfer) {
    return "#5296d5";
  }
  if ((eventType as unknown as string) === BotEvent.mint) {
    return "#2ecc71";
  }
  if ((eventType as unknown as string) === BotEvent.burn) {
    return "#e74c3c";
  }
  return "#9537b0";
};

// Helper sets for offer and listing order types
const OFFER_ORDER_TYPES = new Set([
  "item_offer",
  "trait_offer",
  "collection_offer",
  "criteria_offer",
]);

const LISTING_ORDER_TYPES = new Set(["listing"]);

// Helper set for legacy offer event types
const LEGACY_OFFER_TYPES = new Set([
  "trait_offer",
  "collection_offer",
  "offer",
]);

const handleOrderEventType = (
  orderType: string | undefined
): EventType | BotEvent | undefined => {
  if (orderType && OFFER_ORDER_TYPES.has(orderType)) {
    return BotEvent.offer as unknown as EventType;
  }
  if (orderType && LISTING_ORDER_TYPES.has(orderType)) {
    return BotEvent.listing as unknown as EventType;
  }
  return;
};

const handleTransferEventType = (
  event: OpenSeaAssetEvent
): EventType | BotEvent => {
  const kind = classifyTransfer(event);
  if (kind === "mint") {
    return BotEvent.mint as unknown as EventType;
  }
  if (kind === "burn") {
    return BotEvent.burn as unknown as EventType;
  }
  return EventType.transfer as EventType;
};

export const effectiveEventTypeFor = (
  event: OpenSeaAssetEvent
): EventType | BotEvent => {
  const baseType = event.event_type;

  // Handle "order" event type - use order_type to determine actual type
  if (baseType === "order") {
    const result = handleOrderEventType(event.order_type);
    if (result) {
      return result;
    }
  }

  // Handle legacy event_type values (for backwards compatibility)
  if (LEGACY_OFFER_TYPES.has(baseType)) {
    return BotEvent.offer as unknown as EventType;
  }
  if (baseType === "listing") {
    return BotEvent.listing as unknown as EventType;
  }
  if (baseType === "transfer") {
    return handleTransferEventType(event);
  }
  if (baseType === "mint") {
    return BotEvent.mint as unknown as EventType;
  }

  return baseType as EventType;
};
