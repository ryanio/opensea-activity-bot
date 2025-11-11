import { EventType } from '../../src/opensea';
import { BotEvent, type OpenSeaAssetEvent } from '../../src/types';
import {
  isEventWanted,
  parseEvents,
  wantsOpenSeaEventTypes,
} from '../../src/utils/events';

describe('parseEvents', () => {
  test('parses and trims', () => {
    expect(parseEvents(' sale, listing ,offer ').size).toBe(3);
  });
  test('empty yields empty set', () => {
    expect(parseEvents('')).toEqual(new Set());
  });
  test('throws on invalid', () => {
    expect(() => parseEvents('invalid')).toThrow();
  });
});

describe('wantsOpenSeaEventTypes', () => {
  test('maps to listing/offer/transfer', () => {
    const set = new Set([BotEvent.listing, BotEvent.offer, BotEvent.mint]);
    const want = wantsOpenSeaEventTypes(set);
    expect(want.sort()).toEqual(['listing', 'offer', 'transfer'].sort());
  });
});

describe('isEventWanted', () => {
  const base: Partial<OpenSeaAssetEvent> = {
    event_timestamp: 1,
    chain: 'ethereum',
    quantity: 1,
  };

  test('listing vs offer', () => {
    const listing = {
      ...base,
      event_type: 'listing',
    } as OpenSeaAssetEvent;
    const offer = {
      ...base,
      event_type: 'offer',
    } as OpenSeaAssetEvent;
    expect(isEventWanted(listing, new Set([BotEvent.listing]))).toBe(true);
    expect(isEventWanted(listing, new Set([BotEvent.offer]))).toBe(false);
    expect(isEventWanted(offer, new Set([BotEvent.offer]))).toBe(true);
  });

  test('transfer kinds', () => {
    const mint = {
      ...base,
      event_type: 'transfer',
      from_address: '0x0000000000000000000000000000000000000000',
      to_address: '0x1',
    } as OpenSeaAssetEvent;
    const burn = {
      ...base,
      event_type: 'transfer',
      from_address: '0x1',
      to_address: '0x000000000000000000000000000000000000dead',
    } as OpenSeaAssetEvent;
    const normal = {
      ...base,
      event_type: 'transfer',
      from_address: '0x1',
      to_address: '0x2',
    } as OpenSeaAssetEvent;
    expect(isEventWanted(mint, new Set([BotEvent.mint]))).toBe(true);
    expect(isEventWanted(burn, new Set([BotEvent.burn]))).toBe(true);
    expect(isEventWanted(normal, new Set([BotEvent.transfer]))).toBe(true);
    // transfer should include mint/burn when requested
    expect(isEventWanted(mint, new Set([BotEvent.transfer]))).toBe(true);
    expect(isEventWanted(burn, new Set([BotEvent.transfer]))).toBe(true);
  });

  test('sale selection', () => {
    const sale = { ...base, event_type: EventType.sale } as OpenSeaAssetEvent;
    expect(isEventWanted(sale, new Set([BotEvent.sale]))).toBe(true);
  });
});
