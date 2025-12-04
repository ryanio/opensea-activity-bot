import { EventType } from "../opensea";
import {
  BotEvent,
  type OpenSeaAssetEvent,
  OpenSeaEventType,
  OpenSeaOrderType,
} from "../types";
import { classifyTransfer } from "./utils";

/**
 * Determines the effective event type for an OpenSea event.
 * Handles the API quirk where order events have event_type="order"
 * with the actual type in order_type.
 */
export const getEffectiveOrderType = (
  event: OpenSeaAssetEvent
): OpenSeaOrderType | OpenSeaEventType => {
  // If event_type is "order", use order_type for the actual type
  if (event.event_type === OpenSeaEventType.order) {
    return event.order_type ?? OpenSeaOrderType.listing;
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
    effectiveType === OpenSeaOrderType.item_offer ||
    effectiveType === OpenSeaOrderType.trait_offer ||
    effectiveType === OpenSeaOrderType.collection_offer ||
    effectiveType === OpenSeaEventType.offer || // Legacy value
    effectiveType === OpenSeaOrderType.criteria_offer // Legacy value
  );
};

/**
 * Checks if an event is a listing type
 */
export const isListingType = (event: OpenSeaAssetEvent): boolean => {
  const effectiveType = getEffectiveOrderType(event);
  return effectiveType === OpenSeaOrderType.listing;
};

const isOfferOrderType = (orderType: OpenSeaOrderType): boolean =>
  orderType === OpenSeaOrderType.item_offer ||
  orderType === OpenSeaOrderType.trait_offer ||
  orderType === OpenSeaOrderType.collection_offer ||
  orderType === OpenSeaOrderType.criteria_offer;

const isOfferEventType = (
  eventType: EventType | BotEvent | OpenSeaEventType
): boolean => {
  // Convert to string first to avoid type narrowing issues with union types
  const eventTypeStr = String(eventType);
  // Compare against enum values using string comparison
  return (
    eventTypeStr === BotEvent.offer ||
    eventTypeStr === EventType.offer ||
    eventTypeStr === EventType.trait_offer ||
    eventTypeStr === EventType.collection_offer ||
    eventTypeStr === OpenSeaEventType.offer ||
    eventTypeStr === OpenSeaEventType.trait_offer ||
    eventTypeStr === OpenSeaEventType.collection_offer
  );
};

const isListingEventType = (
  eventType: EventType | BotEvent | OpenSeaEventType
): boolean => {
  // Convert to string first to avoid type narrowing issues with union types
  const eventTypeStr = String(eventType);
  // Compare against enum values using string comparison
  return (
    eventTypeStr === BotEvent.listing ||
    eventTypeStr === EventType.listing ||
    eventTypeStr === OpenSeaEventType.listing
  );
};

export const colorForEvent = (
  eventType: EventType | BotEvent | OpenSeaEventType,
  orderType: OpenSeaOrderType | undefined
): string => {
  // Handle order type for "order" events
  if (orderType) {
    if (isOfferOrderType(orderType)) {
      return "#d63864";
    }
    if (orderType === OpenSeaOrderType.listing) {
      return "#66dcf0";
    }
  }
  // Handle event type directly
  if (isOfferEventType(eventType)) {
    return "#d63864";
  }
  if (isListingEventType(eventType)) {
    return "#66dcf0";
  }
  if (eventType === EventType.sale) {
    return "#62b778";
  }
  if (eventType === BotEvent.mint) {
    return "#2ecc71";
  }
  if (eventType === BotEvent.burn) {
    return "#e74c3c";
  }
  if (eventType === EventType.transfer) {
    return "#5296d5";
  }
  return "#9537b0";
};

// Helper sets for offer and listing order types
const OFFER_ORDER_TYPES = new Set<OpenSeaOrderType>([
  OpenSeaOrderType.item_offer,
  OpenSeaOrderType.trait_offer,
  OpenSeaOrderType.collection_offer,
  OpenSeaOrderType.criteria_offer,
]);

const LISTING_ORDER_TYPES = new Set<OpenSeaOrderType>([
  OpenSeaOrderType.listing,
]);

// Helper set for legacy offer event types
const LEGACY_OFFER_TYPES = new Set<OpenSeaEventType>([
  OpenSeaEventType.trait_offer,
  OpenSeaEventType.collection_offer,
  OpenSeaEventType.offer,
]);

const handleOrderEventType = (
  orderType: OpenSeaOrderType | undefined
): EventType | BotEvent | undefined => {
  if (orderType && OFFER_ORDER_TYPES.has(orderType)) {
    return BotEvent.offer;
  }
  if (orderType && LISTING_ORDER_TYPES.has(orderType)) {
    return BotEvent.listing;
  }
  return;
};

const handleTransferEventType = (
  event: OpenSeaAssetEvent
): EventType | BotEvent => {
  const kind = classifyTransfer(event);
  if (kind === "mint") {
    return BotEvent.mint;
  }
  if (kind === "burn") {
    return BotEvent.burn;
  }
  return EventType.transfer;
};

export const effectiveEventTypeFor = (
  event: OpenSeaAssetEvent
): EventType | BotEvent => {
  const baseType = event.event_type;

  // Handle "order" event type - use order_type to determine actual type
  if (baseType === OpenSeaEventType.order) {
    const result = handleOrderEventType(event.order_type);
    if (result) {
      return result;
    }
  }

  // Handle legacy event_type values (for backwards compatibility)
  if (LEGACY_OFFER_TYPES.has(baseType)) {
    return BotEvent.offer;
  }
  if (baseType === OpenSeaEventType.listing) {
    return BotEvent.listing;
  }
  if (baseType === OpenSeaEventType.transfer) {
    return handleTransferEventType(event);
  }
  if (baseType === OpenSeaEventType.mint) {
    return BotEvent.mint;
  }
  if (baseType === OpenSeaEventType.sale) {
    return EventType.sale;
  }

  // baseType should be one of: sale, transfer, mint, order (already handled)
  // If it's something else, cast it (shouldn't happen in practice)
  return baseType as EventType | BotEvent;
};
