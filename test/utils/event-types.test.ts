import { EventType } from '../../src/opensea';
import { BotEvent, type OpenSeaAssetEvent } from '../../src/types';
import {
  colorForEvent,
  effectiveEventTypeFor,
} from '../../src/utils/event-types';

describe('effectiveEventTypeFor', () => {
  const base: Partial<OpenSeaAssetEvent> = {
    event_type: 'order',
    event_timestamp: 1,
    chain: 'ethereum',
    quantity: 1,
  };

  test('maps listing order to listing', () => {
    const ev = { ...base, order_type: 'listing' } as OpenSeaAssetEvent;
    expect(effectiveEventTypeFor(ev)).toBe(BotEvent.listing);
  });

  test('maps offer order to offer', () => {
    const ev = { ...base, order_type: 'item_offer' } as OpenSeaAssetEvent;
    expect(effectiveEventTypeFor(ev)).toBe(BotEvent.offer);
  });

  test('transfer remains transfer when normal', () => {
    const ev = {
      event_type: 'transfer',
      event_timestamp: 1,
      chain: 'ethereum',
      quantity: 1,
      from_address: '0x1',
      to_address: '0x2',
    } as OpenSeaAssetEvent;
    expect(effectiveEventTypeFor(ev)).toBe(EventType.transfer);
  });
});

describe('colorForEvent', () => {
  test('returns expected colors', () => {
    expect(colorForEvent(EventType.order, 'listing')).toBe('#66dcf0');
    expect(colorForEvent(EventType.order, 'item_offer')).toBe('#d63864');
    expect(colorForEvent(EventType.sale, '')).toBe('#62b778');
    expect(colorForEvent(EventType.transfer, '')).toBe('#5296d5');
    expect(colorForEvent(BotEvent.mint as unknown as EventType, '')).toBe(
      '#2ecc71'
    );
    expect(colorForEvent(BotEvent.burn as unknown as EventType, '')).toBe(
      '#e74c3c'
    );
  });
});
