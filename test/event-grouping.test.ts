import type { OpenSeaAssetEvent } from '../src/types';
import {
  calculateTotalSpent,
  EventGroupManager,
  eventKeyFor,
  type GroupedEvent,
  getDefaultEventGroupConfig,
  getPurchasePrice,
  getTopExpensiveEvents,
  isGroupedEvent,
  sortEventsByPrice,
} from '../src/utils/event-grouping';

// Mock the utils module
function mockFormatAmount(quantity: string, decimals: number, symbol: string) {
  const value = Number(quantity) / 10 ** decimals;
  return `${value} ${symbol}`;
}

jest.mock('../src/utils/utils', () => ({
  formatAmount: jest.fn(mockFormatAmount),
}));

describe('eventGrouping-utils', () => {
  const mockEvent1: OpenSeaAssetEvent = {
    event_type: 'sale',
    event_timestamp: 1_234_567_890,
    chain: 'ethereum',
    quantity: 1,
    transaction: '0xabc123',
    nft: {
      identifier: '1',
      collection: 'test-collection',
      contract: '0x123',
      token_standard: 'erc721',
      name: 'Test NFT #1',
      description: 'Test NFT',
      image_url: 'https://example.com/1.png',
      display_image_url: 'https://example.com/1.png',
      display_animation_url: null,
      metadata_url: null,
      opensea_url: 'https://opensea.io/assets/ethereum/0x123/1',
      updated_at: '2023-01-01T00:00:00Z',
      is_disabled: false,
      is_nsfw: false,
    },
    payment: {
      quantity: '1000000000000000000', // 1 ETH
      token_address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      symbol: 'ETH',
    },
    buyer: '0xbuyer1',
  };

  const mockEvent2: OpenSeaAssetEvent = {
    event_type: 'sale',
    event_timestamp: 1_234_567_890,
    chain: 'ethereum',
    quantity: 1,
    transaction: '0xabc123',
    nft: {
      identifier: '2',
      collection: 'test-collection',
      contract: '0x123',
      token_standard: 'erc721',
      name: 'Test NFT #2',
      description: 'Test NFT',
      image_url: 'https://example.com/2.png',
      display_image_url: 'https://example.com/2.png',
      display_animation_url: null,
      metadata_url: null,
      opensea_url: 'https://opensea.io/assets/ethereum/0x123/2',
      updated_at: '2023-01-01T00:00:00Z',
      is_disabled: false,
      is_nsfw: false,
    },
    payment: {
      quantity: '500000000000000000', // 0.5 ETH
      token_address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      symbol: 'ETH',
    },
    buyer: '0xbuyer1',
  };

  const mockEvent3: OpenSeaAssetEvent = {
    event_type: 'sale',
    event_timestamp: 1_234_567_891,
    chain: 'ethereum',
    quantity: 1,
    transaction: '0xdef456',
    nft: {
      identifier: '3',
      collection: 'test-collection',
      contract: '0x123',
      token_standard: 'erc721',
      name: 'Test NFT #3',
      description: 'Test NFT',
      image_url: 'https://example.com/3.png',
      display_image_url: 'https://example.com/3.png',
      display_animation_url: null,
      metadata_url: null,
      opensea_url: 'https://opensea.io/assets/ethereum/0x123/3',
      updated_at: '2023-01-01T00:00:00Z',
      is_disabled: false,
      is_nsfw: false,
    },
    payment: {
      quantity: '2000000000000000000', // 2 ETH
      token_address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      symbol: 'ETH',
    },
    buyer: '0xbuyer2',
  };

  const mockGroupedEvent: GroupedEvent = {
    kind: 'group',
    txHash: '0xabc123',
    events: [mockEvent1, mockEvent2],
  };

  describe('getDefaultEventGroupConfig', () => {
    it('should return default config for TWITTER', () => {
      const config = getDefaultEventGroupConfig('TWITTER');
      expect(config).toEqual({
        settleMs: 15_000,
        minGroupSize: 2,
      });
    });

    it('should return default config for DISCORD', () => {
      const config = getDefaultEventGroupConfig('DISCORD');
      expect(config).toEqual({
        settleMs: 15_000,
        minGroupSize: 2,
      });
    });

    it('should use environment variables when set', () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        TWITTER_EVENT_GROUP_SETTLE_MS: '30000',
        TWITTER_EVENT_GROUP_MIN_GROUP_SIZE: '10',
      };

      const config = getDefaultEventGroupConfig('TWITTER');
      expect(config).toEqual({
        settleMs: 30_000,
        minGroupSize: 10,
      });

      process.env = originalEnv;
    });
  });

  describe('eventKeyFor', () => {
    it('should generate unique key for event', () => {
      const key = eventKeyFor(mockEvent1);
      expect(key).toBe('1234567890|1');
    });

    it('should handle missing fields gracefully', () => {
      const eventWithoutNft = { ...mockEvent1, nft: undefined };
      const key = eventKeyFor(eventWithoutNft);
      expect(key).toBe('1234567890|');
    });
  });

  describe('isGroupedEvent', () => {
    it('should identify grouped events correctly', () => {
      expect(isGroupedEvent(mockGroupedEvent)).toBe(true);
      expect(isGroupedEvent(mockEvent1)).toBe(false);
    });
  });

  describe('getPurchasePrice', () => {
    it('should extract price correctly', () => {
      const price = getPurchasePrice(mockEvent1);
      expect(price).toBe(BigInt('1000000000000000000'));
    });

    it('should handle missing payment', () => {
      const eventWithoutPayment = { ...mockEvent1, payment: undefined };
      const price = getPurchasePrice(eventWithoutPayment);
      expect(price).toBe(0n);
    });

    it('should handle invalid quantity', () => {
      const payment = mockEvent1.payment;
      if (!payment) {
        throw new Error('Payment is required for test');
      }

      const eventWithInvalidPayment = {
        ...mockEvent1,
        payment: { ...payment, quantity: 'invalid' },
      };
      const price = getPurchasePrice(eventWithInvalidPayment);
      expect(price).toBe(0n);
    });
  });

  describe('sortEventsByPrice', () => {
    it('should sort events by price descending', () => {
      const events = [mockEvent2, mockEvent3, mockEvent1]; // 0.5, 2, 1 ETH
      const sorted = sortEventsByPrice(events);

      expect(sorted[0]).toBe(mockEvent3); // 2 ETH
      expect(sorted[1]).toBe(mockEvent1); // 1 ETH
      expect(sorted[2]).toBe(mockEvent2); // 0.5 ETH
    });

    it('should not mutate original array', () => {
      const events = [mockEvent2, mockEvent3, mockEvent1];
      const originalOrder = [...events];
      sortEventsByPrice(events);

      expect(events).toEqual(originalOrder);
    });
  });

  describe('getTopExpensiveEvents', () => {
    it('should return top N events with details', () => {
      const events = [mockEvent2, mockEvent3, mockEvent1]; // 0.5, 2, 1 ETH
      const topEvents = getTopExpensiveEvents(events, 2);

      expect(topEvents).toHaveLength(2);
      expect(topEvents[0].event).toBe(mockEvent3); // 2 ETH
      expect(topEvents[0].price).toBe('2 ETH');
      expect(topEvents[0].nft?.identifier).toBe('3');

      expect(topEvents[1].event).toBe(mockEvent1); // 1 ETH
      expect(topEvents[1].price).toBe('1 ETH');
      expect(topEvents[1].nft?.identifier).toBe('1');
    });

    it('should use default limit of 4', () => {
      const nft = mockEvent1.nft;
      if (!nft) {
        throw new Error('NFT is required for test');
      }

      const DEFAULT_LIMIT = 4;
      const TEST_EVENTS_COUNT = 10;
      const events = new Array(TEST_EVENTS_COUNT).fill(0).map((_, i) => ({
        ...mockEvent1,
        nft: { ...nft, identifier: i.toString() },
      }));
      const topEvents = getTopExpensiveEvents(events);

      expect(topEvents).toHaveLength(DEFAULT_LIMIT);
    });

    it('should handle events without payment', () => {
      const eventWithoutPayment = { ...mockEvent1, payment: undefined };
      const topEvents = getTopExpensiveEvents([eventWithoutPayment]);

      expect(topEvents).toHaveLength(1);
      expect(topEvents[0].price).toBeNull();
    });
  });

  describe('calculateTotalSpent', () => {
    it('should calculate total for ETH payments', () => {
      const events = [mockEvent1, mockEvent2]; // 1 + 0.5 = 1.5 ETH
      const total = calculateTotalSpent(events);

      expect(total).toBe('1.5 ETH');
    });

    it('should handle WETH payments', () => {
      const payment = mockEvent1.payment;
      if (!payment) {
        throw new Error('Payment is required for test');
      }

      const wethEvent = {
        ...mockEvent1,
        payment: { ...payment, symbol: 'WETH' },
      };
      const total = calculateTotalSpent([wethEvent]);

      expect(total).toBe('1 WETH');
    });

    it('should ignore non-ETH/WETH payments', () => {
      const payment = mockEvent1.payment;
      if (!payment) {
        throw new Error('Payment is required for test');
      }

      const usdcEvent = {
        ...mockEvent1,
        payment: { ...payment, symbol: 'USDC' },
      };
      const total = calculateTotalSpent([usdcEvent]);

      expect(total).toBeNull();
    });

    it('should return null when no ETH payments', () => {
      const eventsWithoutPayment = [{ ...mockEvent1, payment: undefined }];
      const total = calculateTotalSpent(eventsWithoutPayment);

      expect(total).toBeNull();
    });
  });

  describe('EventGroupManager', () => {
    let groupManager: EventGroupManager;

    beforeEach(() => {
      const config = {
        settleMs: 1000,
        minGroupSize: 2,
      };
      groupManager = new EventGroupManager(config);
    });

    it('should add events and track them', () => {
      groupManager.addEvents([mockEvent1, mockEvent2]);

      const pendingTxs = groupManager.getPendingTxHashes();
      expect(pendingTxs.has('actor:purchase:0xbuyer1')).toBe(true);
    });

    it('should identify large pending transactions', () => {
      groupManager.addEvents([mockEvent1, mockEvent2]);

      const pendingLarge = groupManager.getPendingLargeTxHashes();
      expect(pendingLarge.has('actor:purchase:0xbuyer1')).toBe(true);
    });

    it('should filter processable events', () => {
      // Add events to create a pending group
      groupManager.addEvents([mockEvent1, mockEvent2]);

      // Try to process the same events again
      const result = groupManager.filterProcessableEvents([
        mockEvent1,
        mockEvent2,
        mockEvent3,
      ]);

      expect(result.skippedPending).toBe(2); // mockEvent1 and mockEvent2 are pending
      expect(result.processableEvents).toEqual([mockEvent3]);
      expect(result.skippedDupes).toBe(0);
    });

    it('should mark events as processed', () => {
      groupManager.markProcessed(mockEvent1);

      expect(groupManager.isProcessed(mockEvent1)).toBe(true);
      expect(groupManager.isProcessed(mockEvent2)).toBe(false);
    });

    it('should mark group as processed', () => {
      groupManager.markGroupProcessed(mockGroupedEvent);

      expect(groupManager.isProcessed(mockEvent1)).toBe(true);
      expect(groupManager.isProcessed(mockEvent2)).toBe(true);
    });

    it('should get ready groups after settle time', async () => {
      groupManager.addEvents([mockEvent1, mockEvent2]);

      // Initially no ready groups
      let readyGroups = groupManager.getReadyGroups();
      expect(readyGroups).toHaveLength(0);

      // Wait for settle time (config.settleMs is 1000, so wait 1100 to be safe)
      const SETTLE_BUFFER_MS = 1100;
      await new Promise((resolve) => setTimeout(resolve, SETTLE_BUFFER_MS));

      readyGroups = groupManager.getReadyGroups();
      expect(readyGroups).toHaveLength(1);
      expect(readyGroups[0].tx).toBe('actor:purchase:0xbuyer1');
      expect(readyGroups[0].events).toHaveLength(2);
    });

    it('does not flush a group if duplicates reduce below min size', async () => {
      // Add the same event twice (deduped to unique size 1)
      groupManager.addEvents([mockEvent1, mockEvent1]);

      const pendingTxs = groupManager.getPendingTxHashes();
      expect(pendingTxs.size).toBe(1);

      const SETTLE_BUFFER_MS = 1100;
      await new Promise((resolve) => setTimeout(resolve, SETTLE_BUFFER_MS));
      const readyGroups = groupManager.getReadyGroups();
      expect(readyGroups.length).toBe(0);
    });
  });
});
