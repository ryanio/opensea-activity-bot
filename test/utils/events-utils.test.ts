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
  test('maps to listing/offer variants/mint', () => {
    const set = new Set([BotEvent.listing, BotEvent.offer, BotEvent.mint]);
    const want = wantsOpenSeaEventTypes(set).sort();
    expect(want).toEqual(
      [
        EventType.collection_offer,
        EventType.listing,
        EventType.mint,
        EventType.offer,
        EventType.trait_offer,
        EventType.transfer,
      ].sort()
    );
  });

  test('includes transfer when mint requested', () => {
    const want = wantsOpenSeaEventTypes(new Set([BotEvent.mint])).sort();
    expect(want).toEqual([EventType.mint, EventType.transfer].sort());
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
    // transfer no longer implies mint/burn unless explicitly selected
    expect(isEventWanted(mint, new Set([BotEvent.transfer]))).toBe(false);
    expect(isEventWanted(burn, new Set([BotEvent.transfer]))).toBe(false);
  });

  test('sale selection', () => {
    const sale = { ...base, event_type: EventType.sale } as OpenSeaAssetEvent;
    expect(isEventWanted(sale, new Set([BotEvent.sale]))).toBe(true);
  });
});
