import { jest } from '@jest/globals';

// Minimal env
process.env.TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

// stub username to a fixed label for deterministic assertions
jest.mock('../../src/opensea', () => {
  return {
    EventType: {
      order: 'order',
      listing: 'listing',
      offer: 'offer',
      sale: 'sale',
      cancel: 'cancel',
      transfer: 'transfer',
    },
    opensea: { collectionURL: () => '' },
    username: jest.fn(async (addr: string) => `addr:${addr.slice(0, 6)}`),
  };
});

import { EventType } from '../../src/opensea';
import type { OpenSeaAssetEvent } from '../../src/types';

describe('twitter text generation', () => {
  test('mint text includes name and "minted by"', async () => {
    const mod = await import('../../src/platforms/twitter');
    const e = {
      event_type: EventType.transfer,
      event_timestamp: 1,
      chain: 'ethereum',
      quantity: 1,
      nft: { name: 'Foo', identifier: '1', opensea_url: 'https://x' },
      from_address: '0x0000000000000000000000000000000000000000',
      to_address: '0xaaaaaa0000000000000000000000000000000000',
    } as unknown as OpenSeaAssetEvent;
    const text = await mod.textForTweet(e);
    expect(text).toContain('Foo minted by addr:0xaaaa');
  });

  test('burn text includes name and "burned by"', async () => {
    const mod = await import('../../src/platforms/twitter');
    const e = {
      event_type: EventType.transfer,
      event_timestamp: 1,
      chain: 'ethereum',
      quantity: 1,
      nft: { name: 'Bar', identifier: '2', opensea_url: 'https://x' },
      from_address: '0xbbbbbb0000000000000000000000000000000000',
      to_address: '0x000000000000000000000000000000000000dead',
    } as unknown as OpenSeaAssetEvent;
    const text = await mod.textForTweet(e);
    expect(text).toContain('Bar burned by addr:0xbbbb');
  });

  test('transfer text includes from/to usernames', async () => {
    const mod = await import('../../src/platforms/twitter');
    const e = {
      event_type: EventType.transfer,
      event_timestamp: 1,
      chain: 'ethereum',
      quantity: 1,
      nft: { identifier: '3', opensea_url: 'https://x' },
      from_address: '0x1111110000000000000000000000000000000000',
      to_address: '0x2222220000000000000000000000000000000000',
    } as unknown as OpenSeaAssetEvent;
    const text = await mod.textForTweet(e);
    expect(text).toContain('transferred from addr:0x1111 to addr:0x2222');
  });
});
