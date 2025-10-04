import { jest } from '@jest/globals';

// Env setup
process.env.DISCORD_TOKEN = 'x';

// Mock discord.js runtime API minimally
const channelsMap: Record<string, { send: jest.Mock; id: string }> = {};
const setColorArgs: Record<string, string[]> = {};

jest.mock('discord.js', () => {
  const Client = jest.fn().mockImplementation(() => {
    return {
      on: (event: string, cb: () => void) => {
        if (event === 'ready') {
          setImmediate(cb);
        }
      },
      login: jest.fn(),
      destroy: jest.fn(),
      channels: {
        fetch: (id: string) => {
          if (!channelsMap[id]) {
            channelsMap[id] = { send: jest.fn(), id };
          }
          return channelsMap[id];
        },
      },
    } as unknown as object;
  });
  const EmbedBuilder = jest.fn().mockImplementation(() => {
    const obj = {
      setColor: (c: string) => {
        setColorArgs[Math.random().toString(36).slice(2)] = [c];
        return obj;
      },
      setTitle: () => obj,
      setFields: () => obj,
      setURL: () => obj,
      setImage: () => obj,
      setThumbnail: () => obj,
    };
    return obj;
  });
  return { Client, EmbedBuilder };
});

// Mock opensea username
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

import { messageEvents } from '../../src/platforms/discord';
import type { OpenSeaAssetEvent } from '../../src/types';

describe('discord routing', () => {
  beforeEach(() => {
    for (const k of Object.keys(channelsMap)) {
      delete channelsMap[k];
    }
  });

  test('routes mint to mint-configured channel', async () => {
    process.env.DISCORD_EVENTS = '123=mint';
    const ev = {
      event_type: 'transfer',
      event_timestamp: 1,
      chain: 'ethereum',
      quantity: 1,
      from_address: '0x0000000000000000000000000000000000000000',
      to_address: '0x1111110000000000000000000000000000000000',
      nft: { identifier: '1', opensea_url: 'https://x' },
    } as unknown as OpenSeaAssetEvent;
    await messageEvents([ev] as OpenSeaAssetEvent[]);
    expect(channelsMap['123'].send).toHaveBeenCalled();
  });

  test('routes burn to burn-configured channel', async () => {
    process.env.DISCORD_EVENTS = '456=burn';
    const ev = {
      event_type: 'transfer',
      event_timestamp: 1,
      chain: 'ethereum',
      quantity: 1,
      from_address: '0x1111110000000000000000000000000000000000',
      to_address: '0x000000000000000000000000000000000000dead',
      nft: { identifier: '2', opensea_url: 'https://x' },
    } as unknown as OpenSeaAssetEvent;
    await messageEvents([ev] as OpenSeaAssetEvent[]);
    expect(channelsMap['456'].send).toHaveBeenCalled();
  });

  test('routes offer/listing orders to respective channels', async () => {
    process.env.DISCORD_EVENTS = 'o1=offer&l1=listing';
    const offerEv = {
      event_type: 'order',
      event_timestamp: 1,
      chain: 'ethereum',
      quantity: 1,
      order_type: 'item_offer',
      nft: { identifier: '3', opensea_url: 'https://x' },
      payment: {
        quantity: '1',
        decimals: 18,
        symbol: 'ETH',
        token_address: '',
      },
      maker: '0x9999990000000000000000000000000000000000',
      expiration_date: Math.floor(Date.now() / 1000) + 3600,
    } as unknown as OpenSeaAssetEvent;
    const listingEv = {
      ...offerEv,
      order_type: 'listing',
    } as unknown as OpenSeaAssetEvent;
    await messageEvents([offerEv, listingEv] as OpenSeaAssetEvent[]);
    expect(channelsMap.o1.send).toHaveBeenCalled();
    expect(channelsMap.l1.send).toHaveBeenCalled();
  });
});
