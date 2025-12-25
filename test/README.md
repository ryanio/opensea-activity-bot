# Test Suite

This directory contains the test suite for the OpenSea Activity Bot, organized by domain.

## Structure

```
test/
├── fixtures/           # JSON fixtures from real API responses
│   ├── bayc-live/      # Live BAYC collection fixtures
│   └── opensea/        # OpenSea API response fixtures
├── opensea/            # OpenSea API integration tests
│   ├── deduplication.test.ts
│   ├── events-fetch.test.ts
│   ├── fetch-nft.test.ts
│   ├── integration.test.ts
│   └── live-event-types.test.ts
├── platforms/          # Platform output tests (Discord, Twitter)
│   ├── discord.test.ts
│   ├── platform-event-selection.test.ts
│   ├── twitter-text.test.ts
│   └── twitter.test.ts
├── utils/              # Utility function tests
│   ├── aggregator.test.ts
│   ├── cache-separation.test.ts
│   ├── classify-transfer.test.ts
│   ├── event-grouping.test.ts
│   ├── event-types.test.ts
│   ├── events-utils.test.ts
│   ├── formatters.test.ts
│   ├── logger.test.ts
│   ├── queue.test.ts
│   └── unicode-svg.test.ts
├── helpers.ts          # Shared test helpers and event builders
├── setup.ts            # Jest setup configuration
└── README.md           # This file
```

## Test Helpers (`helpers.ts`)

The `helpers.ts` file provides reusable event builders and fixtures to make tests more consistent and maintainable.

## Test Helpers (`helpers.ts`)

The `helpers.ts` file provides reusable event builders and fixtures to make tests more consistent and maintainable.

### Event Builders

These functions create mock OpenSea events for testing:

#### `createMintEvent(identifier, toAddress, timestamp)`

Creates a mint transfer event (from null address).

```typescript
import { createMintEvent } from './helpers';

const mintEvent = createMintEvent('123', '0xminter', 1234567890);
```

#### `createBurnEvent(identifier, fromAddress, timestamp)`

Creates a burn transfer event (to dead address).

```typescript
import { createBurnEvent } from './helpers';

const burnEvent = createBurnEvent('456', '0xburner', 1234567890);
```

#### `createTransferEvent(identifier, fromAddress, toAddress, timestamp)`

Creates a regular transfer event (not mint or burn).

```typescript
import { createTransferEvent } from './helpers';

const transferEvent = createTransferEvent('789', '0xfrom', '0xto', 1234567890);
```

#### `createSaleEvent(identifier, buyer, seller, priceWei)`

Creates a sale event.

```typescript
import { createSaleEvent } from './helpers';

const saleEvent = createSaleEvent('101', '0xbuyer', '0xseller', '1000000000000000');
```

#### `createERC1155SaleEvent(identifier, buyer, seller, priceWei)`

Creates an ERC1155 sale event.

```typescript
import { createERC1155SaleEvent } from './helpers';

const erc1155Event = createERC1155SaleEvent('202', '0xbuyer', '0xseller', '2000000000000000');
```

### Batch Helpers

Create multiple events at once:

#### `createMintBatch(count, toAddress, baseTimestamp)`

Creates multiple mint events to the same recipient.

```typescript
import { createMintBatch } from './helpers';

const mints = createMintBatch(5, '0xminter', 1234567890);
// Returns array of 5 mint events
```

#### `createBurnBatch(count, fromAddress, baseTimestamp)`

Creates multiple burn events from the same burner.

```typescript
import { createBurnBatch } from './helpers';

const burns = createBurnBatch(3, '0xburner', 1234567890);
// Returns array of 3 burn events
```

#### `createSaleBatch(count, buyer, transaction)`

Creates multiple sale events in the same transaction to the same buyer.

```typescript
import { createSaleBatch } from './helpers';

const sales = createSaleBatch(10, '0xbuyer', '0xtx123');
// Returns array of 10 sale events
```

### Test Constants

Commonly used addresses:

```typescript
import { NULL_ADDRESS, DEAD_ADDRESS, TEST_BUYER_1, TEST_SELLER_1 } from './helpers';

// NULL_ADDRESS = '0x0000000000000000000000000000000000000000'
// DEAD_ADDRESS = '0x000000000000000000000000000000000000dead'
// TEST_BUYER_1 = '0x6b5566150d8671adfcf6304a4190f176f65188e9'
// TEST_SELLER_1 = '0xfebb9ead7c0ea188822731887d078dc9d560c748'
```

### Fixture Data

Real OpenSea API response data for realistic testing:

```typescript
import { GLYPHBOT_NFT, FIXTURE_SALE_EVENT, FIXTURE_TRANSFER_EVENT } from './helpers';

// Use real NFT metadata from actual OpenSea responses
const event = {
  ...FIXTURE_SALE_EVENT,
  buyer: '0xnewbuyer',
};
```

## Fixtures Directory

The `fixtures/` directory contains JSON files with real OpenSea API responses:

### `fixtures/opensea/`

- `events-sales.json` - Single sale event response
- `events-sales-batch.json` - Multiple sale events in one response
- `events-sales-group.json` - Grouped sale events
- `events-transfers-batch.json` - Multiple transfer events
- `events-orders-batch.json` - Order events
- `get-events-by-account.json` - Events filtered by account
- `get-events-by-collection.json` - Events filtered by collection
- `get-events-by-nft.json` - Events for a specific NFT
- Other OpenSea API response fixtures

### `fixtures/bayc-live/`

Live API fixtures from the Bored Ape Yacht Club collection:

- `listing-events.json` - Listing order events
- `offer-events.json` - Item offer events
- `trait_offer-events.json` - Trait offer events
- `collection_offer-events.json` - Collection offer events
- `sale-events.json` - Sale events
- `transfer-events.json` - Transfer events
- `all-events.json` - All event types combined

### Other Fixtures

- `unicode-svg.json` - NFT with Unicode SVG image
- `svg-image.json` - NFT with SVG image

## Test Directories

### `opensea/`

Tests for OpenSea API integration:

- **deduplication.test.ts** - Event deduplication and caching
- **events-fetch.test.ts** - Event fetching with lag windows
- **fetch-nft.test.ts** - NFT metadata fetching
- **integration.test.ts** - End-to-end fetching integration
- **live-event-types.test.ts** - Event type detection with live fixtures

### `platforms/`

Tests for platform outputs (Discord and Twitter):

- **discord.test.ts** - Discord embed building
- **twitter.test.ts** - Twitter tweet posting
- **twitter-text.test.ts** - Tweet text formatting
- **platform-event-selection.test.ts** - Event filtering for platforms

### `utils/`

Tests for utility functions:

- **aggregator.test.ts** - Event group aggregation
- **queue.test.ts** - Async queue processing
- **event-grouping.test.ts** - Event grouping logic
- **event-types.test.ts** - Event type classification
- **events-utils.test.ts** - Event utility functions
- **cache-separation.test.ts** - Cache architecture validation
- **classify-transfer.test.ts** - Mint/burn/transfer classification
- **formatters.test.ts** - Amount and text formatting
- **logger.test.ts** - Logging utilities
- **unicode-svg.test.ts** - Unicode SVG rendering

## Usage Example

Here's a complete example of using the helpers in a test:

```typescript
import {
  createMintEvent,
  createBurnEvent,
  createSaleBatch,
  TEST_BUYER_1,
  FIXTURE_SALE_EVENT,
} from './helpers';
import { EventGroupManager } from '../src/utils/event-grouping';

describe('Event Grouping', () => {
  it('should group multiple mints to the same address', () => {
    const groupManager = new EventGroupManager({ settleMs: 100, minGroupSize: 2 });

    const mint1 = createMintEvent('1', TEST_BUYER_1, 1234567890);
    const mint2 = createMintEvent('2', TEST_BUYER_1, 1234567890);

    groupManager.addEvents([mint1, mint2]);

    // ... test logic
  });

  it('should handle sale batches', () => {
    const sales = createSaleBatch(5, TEST_BUYER_1, '0xtx123');

    expect(sales).toHaveLength(5);
    expect(sales.every((s) => s.buyer === TEST_BUYER_1)).toBe(true);
  });
});
```

## Benefits

Using these helpers provides:

1. **Consistency** - All tests use the same event structure
2. **Maintainability** - Update event structure in one place
3. **Readability** - Clear, self-documenting test code
4. **DRY** - Don't Repeat Yourself across test files
5. **Realistic Data** - Fixtures based on actual OpenSea API responses

## Adding New Helpers

When adding new test helpers:

1. Keep functions simple with ≤4 parameters (linter rule)
2. Use realistic data from actual OpenSea responses
3. Document the helper function with JSDoc comments
4. Export from `helpers.ts` for use across test files
5. Update this README with the new helper

