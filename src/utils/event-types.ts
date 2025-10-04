import { EventType } from '../opensea';
import { BotEvent, type OpenSeaAssetEvent } from '../types';
import { classifyTransfer } from './utils';

export const colorForEvent = (
  eventType: EventType | BotEvent,
  orderType: string
): string => {
  if (eventType === EventType.order) {
    if (orderType.includes('offer')) {
      return '#d63864';
    }
    return '#66dcf0';
  }
  if (eventType === EventType.sale) {
    return '#62b778';
  }
  if (eventType === EventType.cancel) {
    return '#9537b0';
  }
  if (eventType === EventType.transfer) {
    return '#5296d5';
  }
  if ((eventType as unknown as string) === BotEvent.mint) {
    return '#2ecc71';
  }
  if ((eventType as unknown as string) === BotEvent.burn) {
    return '#e74c3c';
  }
  return '#9537b0';
};

export const effectiveEventTypeFor = (
  event: OpenSeaAssetEvent
): EventType | BotEvent => {
  const baseType = event.event_type as EventType;
  if (baseType === EventType.order) {
    return (event.order_type ?? '').includes(BotEvent.offer)
      ? (BotEvent.offer as unknown as EventType)
      : (BotEvent.listing as unknown as EventType);
  }
  if (baseType === EventType.transfer) {
    const kind = classifyTransfer(event);
    if (kind === 'mint') {
      return BotEvent.mint as unknown as EventType;
    }
    if (kind === 'burn') {
      return BotEvent.burn as unknown as EventType;
    }
  }
  return baseType;
};
